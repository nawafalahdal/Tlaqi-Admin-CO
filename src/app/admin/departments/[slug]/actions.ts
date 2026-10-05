"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { issueWarning, resetMemberCredentials, markMemberExited, issueCertificate } from "@/lib/workflow";
import { respondToTicket } from "@/lib/tickets";
import { getTrackForTarget, ROLE_LABELS } from "@/lib/testTracks";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

/** حوكمة صارمة: إصدار دعوة عضو داخل قسم معيّن هو حصراً من صلاحية أدمن ذلك
 *  القسم — حتى الفاونڈر نفسه لا يملك هذا الإجراء مباشرة */
export async function createMemberInviteAction(
  _prevState: { error: string | null; success: boolean; inviteUrl?: string },
  formData: FormData
): Promise<{ error: string | null; success: boolean; inviteUrl?: string }> {
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
    if (!fullName || !email) return { error: "الاسم والبريد مطلوبان", success: false };

    const department = await prisma.department.findUniqueOrThrow({ where: { id: departmentId } });
    const track = await getTrackForTarget("member", departmentId);

    const invite = await prisma.invite.create({
      data: {
        fullName,
        email,
        targetRole: "member",
        departmentId,
        testTrackId: track.id,
        invitedById: session.user.id,
      },
    });

    const inviteUrl = `${process.env.APP_BASE_URL || "http://localhost:3000"}/invite/${invite.token}`;
    await sendInviteEmail({
      to: email,
      fullName,
      roleLabel: `${ROLE_LABELS.member} — ${department.name}${jobTitle ? ` (${jobTitle})` : ""}`,
      inviteUrl,
    });

    revalidatePath(`/admin/departments`);
    return { error: null, success: true, inviteUrl };
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
 *  نسيانه أو أي إشكالية — متاح لأدمن القسم المعني أو الفاونڈر/التنفيذي */
export async function resetMemberCredentialsAction(
  memberId: string,
  newEmail: string
): Promise<{ error: string | null; tempPassword?: string; email?: string }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  const allowed =
    session.user.role === "super_admin" ||
    session.user.role === "executive" ||
    (session.user.role === "department_admin" && session.user.departmentId === member.departmentId);
  if (!allowed) return { error: "غير مصرح لك بهذا الإجراء" };

  const trimmedEmail = newEmail.trim().toLowerCase();
  try {
    const { tempPassword, member: updated } = await resetMemberCredentials(
      memberId,
      trimmedEmail && trimmedEmail !== member.email ? trimmedEmail : undefined
    );
    revalidatePath(`/admin/departments`);
    return { error: null, tempPassword, email: updated.email };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** إنهاء عضوية يدوي (استقالة أو قرار إداري) بسبب يكتبه الأدمن — متاح لأدمن
 *  القسم المعني أو الفاونڈر/التنفيذي، بخلاف الاستبعاد التلقائي بـ3 تنبيهات */
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

/** إصدار شهادة إتمام لعضو — قرار يدوي من أدمن القسم أو الفاونڈر/التنفيذي */
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
 *  الفاونڈر/التنفيذي مصرَّح لهما دائماً */
export async function respondToTicketAction(
  ticketId: string,
  status: "in_progress" | "resolved",
  resolutionNote: string
) {
  const session = await auth();
  if (!session) throw new Error("يجب تسجيل الدخول");

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { member: true },
  });

  const allowed =
    session.user.role === "super_admin" ||
    session.user.role === "executive" ||
    (session.user.role === "department_admin" &&
      (session.user.departmentId === ticket.targetDepartmentId ||
        session.user.departmentId === ticket.member.departmentId));
  if (!allowed) throw new Error("غير مصرح لك بهذا الإجراء");

  await respondToTicket({ ticketId, status, resolutionNote });
  revalidatePath("/admin/departments");
  revalidatePath("/admin");
}
