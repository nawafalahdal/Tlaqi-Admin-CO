"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncAdminAccountRow } from "@/lib/workflow";
import { appendMemberEvent } from "@/lib/googleSheets";
import { ROLE_LABELS, accountRoleLabel } from "@/lib/testTracks";
import { safeErrorMessage } from "@/lib/safeError";
import { sendWelcomePack } from "@/lib/welcome";
import { parseGender } from "@/lib/gender";

/** يحفظ بيانات صاحب الحساب الإداري.
 *
 *  كلٌّ يملأ بياناته هو ولا أحد سواه: البيانات الشخصية ليست حقلاً إدارياً
 *  يُعدّله غير صاحبه.
 *
 *  والاسم منها. كان يُعدَّل من مسار الحسابات وحده — وذلك المسار لا يشمل
 *  المؤسس، فبقي اسمه ما زرعه سكربت التهيئة ولا سبيل لتغييره. أما البريد
 *  فهو هوية الدخول نفسها، وتغييره يفصل الحساب عن صاحبه، فيبقى خارج هذا
 *  النموذج. وكل تغيير للاسم يُسجَّل في السجل الحي بقيمته قبله وبعده. */
export async function saveAdminProfileAction(
  _prev: { error: string | null; saved: boolean },
  formData: FormData
): Promise<{ error: string | null; saved: boolean }> {
  const session = await auth();
  if (!session || session.user.role === "member") {
    return { error: "غير مصرح", saved: false };
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();
  const specialization = String(formData.get("specialization") ?? "").trim();
  const section = String(formData.get("section") ?? "").trim();
  const gender = parseGender(formData.get("gender"));

  if (!fullName || !phone || !jobTitle || !specialization || !gender) {
    return { error: "الاسم والمخاطبة ورقم الجوال والمسمى الوظيفي والتخصص مطلوبة", saved: false };
  }
  if (fullName.length < 3) return { error: "اكتب اسمك الكامل", saved: false };

  try {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        fullName,
        phone,
        jobTitle,
        specialization,
        gender,
        section: section || null,
        profileCompletedAt: before.profileCompletedAt ?? new Date(),
      },
      include: { department: true },
    });

    await appendMemberEvent({
      fullName: user.fullName,
      email: user.email,
      roleOrDepartment:
        user.department?.name ?? (accountRoleLabel(user.role)),
      event: before.profileCompletedAt ? "تحديث بيانات حساب إداري" : "استكمال بيانات حساب إداري",
      details:
        (before.fullName !== fullName ? `الاسم: ${before.fullName} ← ${fullName} — ` : "") +
        `التخصص: ${specialization} — المسمى: ${jobTitle}${section ? ` — Section: ${section}` : ""}`,
      at: new Date(),
    });

    await syncAdminAccountRow(user.id);
    revalidatePath("/admin/profile");
    revalidatePath("/admin");
    return { error: null, saved: true };
  } catch (err) {
    return { error: safeErrorMessage(err), saved: false };
  }
}

/** يُعيد إرسال البريد الترحيبي لصاحب الجلسة نفسه.
 *
 *  لا يأخذ معرّفاً من الواجهة: الزرّ لمن لم تصله رسالته، لا ليُرسلها
 *  أحدٌ لأحد. وكل إرسال يُحسب ويُسجَّل في الشيت بتاريخه ومرّته. */
export async function resendWelcomeAction(): Promise<{ error: string | null; sent: boolean }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول", sent: false };

  // بطاقة الانضمام تصل مرة واحدة: لحظة الاعتماد. وهذا الزرّ شبكة أمان
  // لمن لم تصله أصلاً، لا وسيلة لإعادة إرسالها متى شاء — فإن كانت وصلت
  // رُفض الطلب هنا أيضاً، لا في الواجهة وحدها.
  const already =
    session.user.role === "member"
      ? await prisma.member.findUnique({
          where: { id: session.user.id },
          select: { welcomeEmailSentAt: true },
        })
      : await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { welcomeEmailSentAt: true },
        });
  if (already?.welcomeEmailSentAt) {
    return { error: "بطاقة الانضمام وصلتك بالفعل — تُرسل مرة واحدة فقط", sent: false };
  }

  const result =
    session.user.role === "member"
      ? await sendWelcomePack({ kind: "member", id: session.user.id })
      : await sendWelcomePack({ kind: "user", id: session.user.id });

  if (!result.ok) return { error: result.reason, sent: false };
  revalidatePath("/admin/profile");
  revalidatePath("/member");
  return { error: null, sent: true };
}

/** المؤسس يُسجّل قسمَه — «الإدارة العليا» أو غيرها.
 *
 *  حسابُه أُنشئ مع المنصة لا بدعوةٍ، فلم يُسأل عن قسمه ولا مرّ على
 *  مسارٍ يُسجّله: كان حقل القسم في بطاقته شَرطةً، وهو في الهيكل بلا
 *  انتماءٍ مكتوب. وتصنيفُ الأعضاء يصنّف غيره لا نفسه.
 *
 *  والقاعدة التي اختارها لأعضائه تُطبَّق عليه: **غير المصنّف يُصنَّف،
 *  والمصنّف لا يُعاد تصنيفه.** والحرس في `where` لا قبله، فضغطتان
 *  متزامنتان لا تمرّان معاً.
 *
 *  ولا يُنشئ هذا قيادةً لقسم: قائد القسم من له `department_admin`،
 *  وهذا انتماءٌ يُكتب في بطاقته ويُقرأ في الهيكل — لا منصبٌ يُمنَح.
 */
export async function setMyDepartmentAction(
  departmentId: string
): Promise<{ error: string | null; departmentName?: string }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
  if (session.user.role !== "super_admin") {
    return { error: "تسجيل القسم الذاتي للمؤسس وحده" };
  }
  if (!departmentId) return { error: "اختر قسماً" };

  try {
    const dept = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true, name: true },
    });
    if (!dept) return { error: "القسم غير موجود" };

    const written = await prisma.user.updateMany({
      where: { id: session.user.id, departmentId: null },
      data: { departmentId: dept.id },
    });
    if (written.count === 0) {
      const mine = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { department: { select: { name: true } } },
      });
      return {
        error: `أنت مُسجَّلٌ في ${mine?.department?.name ?? "قسمٍ بالفعل"} — ولا يُعاد التسجيل.`,
      };
    }

    await appendMemberEvent({
      fullName: session.user.name ?? "—",
      email: session.user.email ?? "—",
      roleOrDepartment: dept.name,
      event: "تسجيل قسم المؤسس",
      details: `كان بلا قسم — سجّل نفسه في ${dept.name}`,
      at: new Date(),
    });
    await syncAdminAccountRow(session.user.id);

    revalidatePath("/admin/profile");
    revalidatePath("/structure");
    revalidatePath("/admin");
    return { error: null, departmentName: dept.name };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
