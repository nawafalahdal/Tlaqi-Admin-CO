"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  removeLeadershipUser,
  resetUserCredentials,
  reopenCandidateTest,
  purgeCandidate,
} from "@/lib/workflow";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

/** إعادة تعيين بيانات دخول حساب إداري (قائد قسم / تنفيذي) — المؤسس يملك هذا
 *  لأي حساب، والتنفيذي يملكه فقط لحسابات قادة الأقسام (لا لحساب تنفيذي آخر ولا لنفسه) */
export async function resetUserCredentialsAction(
  userId: string,
  newEmail: string
): Promise<{ error: string | null; tempPassword?: string; email?: string }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // صار لكل شخص أن يستعيد كلمته بنفسه عبر بريده، فلم يعد تعيينُها يدوياً
  // صلاحيةً تشغيلية بل شبكة أمان أخيرة: تبقى للفاوندر وحده. حصرُها يقلّل
  // عدد من يستطيع انتحال حساب غيره من أربعة أدوار إلى واحد.
  if (session.user.role !== "super_admin") {
    return { error: "استعادة كلمة المرور صارت ذاتية عبر البريد — وتعيينها يدوياً خاص بالمؤسس" };
  }

  const trimmedEmail = newEmail.trim().toLowerCase();
  try {
    const { tempPassword, user } = await resetUserCredentials(
      userId,
      trimmedEmail && trimmedEmail !== target.email ? trimmedEmail : undefined,
      session.user.name ?? undefined
    );
    revalidatePath("/admin/accounts");
    return { error: null, tempPassword, email: user.email };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** تنحية حساب قيادي — المؤسس وحده. هذه هي الطريقة الوحيدة لتفريغ منصب
 *  فردي (تنفيذي / مسؤول تشغيل / قائد قسم) قبل تعيين بديل، لأن المنصب
 *  لا يقبل شاغلَين. */
export async function removeLeadershipUserAction(
  userId: string,
  reason: string
): Promise<{ error: string | null; success: boolean }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول", success: false };
  if (session.user.role !== "super_admin") {
    return { error: "تنحية الحسابات القيادية خاصة بالمؤسس فقط", success: false };
  }

  const trimmed = reason.trim();
  if (!trimmed) return { error: "اكتب سبب التنحية — يُحفظ في السجل", success: false };

  try {
    await removeLeadershipUser({
      userId,
      reason: trimmed,
      performedById: session.user.id,
      performedByName: session.user.name ?? "المؤسس",
    });
    revalidatePath("/admin/accounts");
    revalidatePath("/admin/invites");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** إعادة فتح اختبار مرشّح لم يجتزه.
 *
 *  الفاوندر والتنفيذي لأي مرشّح، وقائد القسم لمرشّحي قسمه وحدهم — هذا هو
 *  معنى "ولكلٍّ بصلاحياته": من يملك اعتماد الشخص يملك إعادة اختباره. */
export async function reopenCandidateTestAction(
  memberId: string,
  meetingHeld: boolean,
  note: string
): Promise<{ error: string | null; done?: boolean }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });

  const allowed =
    session.user.role === "super_admin" ||
    session.user.role === "executive" ||
    (session.user.role === "department_admin" &&
      session.user.departmentId === member.departmentId);
  if (!allowed) return { error: "غير مصرح لك بإعادة فتح هذا الاختبار" };

  try {
    await reopenCandidateTest({
      memberId,
      meetingHeld,
      note,
      performedByName: session.user.name ?? "—",
    });
    revalidatePath("/admin/accounts");
    revalidatePath("/admin/members");
    revalidatePath("/admin");
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** حذف نهائي لمرشّح عالق — الفاوندر وحده، وبكتابة البريد كاملاً.
 *  يُستدعى حين يحجز مرشّح راسب أو عالق منصباً أو بريداً، فلا تمكن دعوة
 *  غيره ولا دعوته هو من جديد. */
export async function purgeCandidateAction(
  memberId: string,
  confirmEmail: string,
  reason: string
): Promise<{ error: string | null; done?: boolean; email?: string }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
  if (session.user.role !== "super_admin") {
    return { error: "الحذف النهائي خاص بالفاوندر" };
  }
  if (!reason.trim()) return { error: "اكتب سبب الحذف — يُسجَّل في السجل" };

  try {
    const result = await purgeCandidate({
      memberId,
      confirmEmail,
      reason: reason.trim(),
      performedByName: session.user.name ?? "—",
    });
    revalidatePath("/admin/accounts");
    revalidatePath("/admin/members");
    revalidatePath("/admin");
    return { error: null, done: true, email: result.email };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
