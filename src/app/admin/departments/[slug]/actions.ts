"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { issueWarning } from "@/lib/workflow";
import { getTrackForTarget, ROLE_LABELS } from "@/lib/testTracks";
import { revalidatePath } from "next/cache";

/** حوكمة صارمة: إصدار دعوة عضو داخل قسم معيّن هو حصراً من صلاحية أدمن ذلك
 *  القسم — حتى الفاونڈر نفسه لا يملك هذا الإجراء مباشرة */
export async function createMemberInviteAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
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

    await sendInviteEmail({
      to: email,
      fullName,
      roleLabel: `${ROLE_LABELS.member} — ${department.name}${jobTitle ? ` (${jobTitle})` : ""}`,
      inviteUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/invite/${invite.token}`,
    });

    revalidatePath(`/admin/departments`);
    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "حدث خطأ غير متوقع", success: false };
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
    return { error: err instanceof Error ? err.message : "حدث خطأ غير متوقع", success: false };
  }
}
