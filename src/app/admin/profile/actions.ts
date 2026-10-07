"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncAdminAccountRow } from "@/lib/workflow";
import { appendMemberEvent } from "@/lib/googleSheets";
import { ROLE_LABELS, accountRoleLabel } from "@/lib/testTracks";
import { safeErrorMessage } from "@/lib/safeError";

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

  if (!fullName || !phone || !jobTitle || !specialization) {
    return { error: "الاسم ورقم الجوال والمسمى الوظيفي والتخصص مطلوبة", saved: false };
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
