"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  createCandidateAccount,
  issueWarning,
  resetMemberCredentials,
  markMemberExited,
  issueCertificate,
} from "@/lib/workflow";
import { respondToTicket, canRespondToTicket } from "@/lib/tickets";
import { getTrackForTarget } from "@/lib/testTracks";
import type { Session } from "next-auth";
import { safeErrorMessage } from "@/lib/safeError";
import {
  stepDownMember,
  markCertificateShared,
  markFarewellDesigned,
  closeOffboarding,
} from "@/lib/offboarding";
import { revalidatePath } from "next/cache";

/** حوكمة صارمة: إصدار دعوة عضو داخل قسم معيّن هو حصراً من صلاحية أدمن ذلك
 *  القسم — حتى المؤسس نفسه لا يملك هذا الإجراء مباشرة */
export async function createMemberInviteAction(
  _prevState: { error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } },
  formData: FormData
): Promise<{ error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } }> {
  try {
    const session = await auth();
    const departmentId = String(formData.get("departmentId") ?? "");

    if (
      !session ||
      session.user.role !== "department_admin" ||
      session.user.departmentId !== departmentId
    ) {
      return { error: "هذا الإجراء خاص بأدمن هذا القسم فقط", success: false };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const jobTitle = String(formData.get("jobTitle") ?? "").trim();
    // المسمى تحدّده الإدارة الداعية لا المرشّح: هي من تعرف لماذا دعته
    if (!fullName || !email || !jobTitle) {
      return { error: "الاسم والبريد والمسمى الوظيفي مطلوبة", success: false };
    }

    const track = await getTrackForTarget("member", departmentId);

    const { tempPassword } = await createCandidateAccount({
      fullName,
      email,
      jobTitle,
      targetRole: "member",
      departmentId,
      testTrackId: track.id,
      invitedById: session.user.id,
    });

    revalidatePath(`/admin/departments`);
    return { error: null, success: true, credentials: { email, tempPassword } };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function issueWarningAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await auth();
    const memberId = String(formData.get("memberId") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!session) return { error: "يجب تسجيل الدخول", success: false };
    if (!reason) return { error: "يجب كتابة سبب التنبيه", success: false };

    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    const allowed =
      session.user.role === "super_admin" ||
      session.user.role === "executive" ||
      (session.user.role === "department_admin" && session.user.departmentId === member.departmentId);
    if (!allowed) return { error: "غير مصرح لك بهذا الإجراء", success: false };

    await issueWarning({ memberId, issuedByUserId: session.user.id, reason });
    revalidatePath(`/admin/departments`);
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** إعادة تعيين بيانات دخول عضو (كلمة مرور جديدة، وبريد جديد اختيارياً) عند
 *  نسيانه أو أي إشكالية — متاح لأدمن القسم المعني أو المؤسس/التنفيذي */
export async function resetMemberCredentialsAction(
  memberId: string,
  newEmail: string
): Promise<{ error: string | null; tempPassword?: string; email?: string }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  // الاستعادة صارت ذاتية عبر البريد؛ وتعيينها يدوياً شبكة أمان للفاوندر وحده
  if (session.user.role !== "super_admin") {
    return { error: "استعادة كلمة المرور صارت ذاتية عبر البريد — وتعيينها يدوياً خاص بالمؤسس" };
  }

  const trimmedEmail = newEmail.trim().toLowerCase();
  try {
    const { tempPassword, member: updated } = await resetMemberCredentials(
      memberId,
      trimmedEmail && trimmedEmail !== member.email ? trimmedEmail : undefined,
      session.user.name ?? undefined
    );
    revalidatePath(`/admin/departments`);
    return { error: null, tempPassword, email: updated.email };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** إنهاء عضوية يدوي (استقالة أو قرار إداري) بسبب يكتبه الأدمن — متاح لأدمن
 *  القسم المعني أو المؤسس/التنفيذي، بخلاف الاستبعاد التلقائي بـ3 تنبيهات */
export async function markMemberExitedAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await auth();
    const memberId = String(formData.get("memberId") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!session) return { error: "يجب تسجيل الدخول", success: false };
    if (!reason) return { error: "يجب كتابة سبب إنهاء العضوية", success: false };

    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    const allowed =
      session.user.role === "super_admin" ||
      session.user.role === "executive" ||
      (session.user.role === "department_admin" && session.user.departmentId === member.departmentId);
    if (!allowed) return { error: "غير مصرح لك بهذا الإجراء", success: false };

    await markMemberExited(memberId, reason);
    revalidatePath(`/admin/departments`);
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** إصدار شهادة إتمام لعضو — قرار يدوي من أدمن القسم أو المؤسس/التنفيذي */
export async function issueCertificateAction(memberId: string): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  const allowed =
    session.user.role === "super_admin" ||
    session.user.role === "executive" ||
    (session.user.role === "department_admin" && session.user.departmentId === member.departmentId);
  if (!allowed) return { error: "غير مصرح لك بهذا الإجراء" };

  try {
    await issueCertificate(memberId);
    revalidatePath(`/admin/departments`);
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** يرد أدمن القسم (المستهدف أصلاً أو قائد قسم العضو بعد التصعيد) على تذكرة —
 *  المؤسس/التنفيذي مصرَّح لهما دائماً */
export async function respondToTicketAction(
  ticketId: string,
  status: "in_progress" | "resolved",
  resolutionNote: string
) {
  const session = await auth();
  if (!session) throw new Error("يجب تسجيل الدخول");

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { member: true, raisedByUser: true, targetMember: true },
  });

  // قاعدة واحدة تحكم الردّ في كل الشاشات — ومنها أن صاحب التذكرة لا يُغلقها
  if (!canRespondToTicket(ticket, session)) throw new Error("غير مصرح لك بهذا الإجراء");

  await respondToTicket({ ticketId, status, resolutionNote });
  revalidatePath("/admin/departments");
  revalidatePath("/admin");
}

/** من يملك إجراءات الخروج على عضو: قائد قسمه، أو الإدارة العليا.
 *  القاعدة نفسها المستعملة في التنبيه وإنهاء العضوية — تُكتب مرة. */
async function canManageMemberExit(
  session: Session | null,
  memberId: string
): Promise<boolean> {
  if (!session) return false;
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { departmentId: true },
  });
  if (!member) return false;
  return (
    session.user.role === "super_admin" ||
    session.user.role === "executive" ||
    (session.user.role === "department_admin" &&
      session.user.departmentId === member.departmentId)
  );
}

/** تنحية عضو عن منصبه: يتوقّف عمله ويُحدَّد تاريخ انتهائه.
 *  التجربة لا تُغلق هنا — تبقى مفتوحة حتى الشهادة والوداع. */
export async function stepDownMemberAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await auth();
    if (!session) return { error: "يجب تسجيل الدخول", success: false };

    const memberId = String(formData.get("memberId") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    const endDateRaw = String(formData.get("endDate") ?? "").trim();

    if (!(await canManageMemberExit(session, memberId))) {
      return { error: "غير مصرح لك بهذا الإجراء", success: false };
    }
    if (!reason) return { error: "اكتب سبب التنحي — يُسجَّل في السجل الحي", success: false };
    if (!endDateRaw) return { error: "حدّد تاريخ الانتهاء", success: false };

    const endDate = new Date(`${endDateRaw}T00:00:00`);
    if (Number.isNaN(endDate.getTime())) return { error: "تاريخ غير صالح", success: false };

    const res = await stepDownMember({
      memberId,
      byName: session.user.name ?? "—",
      reason,
      endDate,
    });
    if (!res.ok) return { error: res.reason, success: false };

    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** تعليم خطوة من خطوتَي الختام: الشهادة أو تصميم الوداع */
export async function markOffboardingStepAction(
  memberId: string,
  step: "certificate" | "farewell"
): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
  if (!(await canManageMemberExit(session, memberId))) {
    return { error: "غير مصرح لك بهذا الإجراء" };
  }
  try {
    const byName = session.user.name ?? "—";
    if (step === "certificate") await markCertificateShared(memberId, byName);
    else await markFarewellDesigned(memberId, byName);
    revalidatePath("/admin/departments");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** إغلاق التجربة نهائياً — بعد الشهادة والوداع معاً.
 *  تُرسل رسالة الشكر ولا يصل صاحبها بريد من المنصة بعدها أبداً. */
export async function closeOffboardingAction(
  memberId: string
): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
  if (!(await canManageMemberExit(session, memberId))) {
    return { error: "غير مصرح لك بهذا الإجراء" };
  }
  const res = await closeOffboarding(memberId, session.user.name ?? "—");
  if (!res.ok) return { error: res.reason };
  revalidatePath("/admin/departments");
  revalidatePath("/admin");
  return { error: null };
}
