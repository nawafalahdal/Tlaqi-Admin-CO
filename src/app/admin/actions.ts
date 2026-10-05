"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { approveMember, rejectMember, reopenInviteForMember } from "@/lib/workflow";
import { revalidatePath } from "next/cache";

async function requireSuperAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "super_admin") {
    throw new Error("غير مصرح لك بهذا الإجراء");
  }
  return session;
}

async function requireAdmin() {
  const session = await auth();
  if (!session) throw new Error("يجب تسجيل الدخول");
  return session;
}

export async function createInviteAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await requireSuperAdmin();
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const departmentId = String(formData.get("departmentId") ?? "");

    if (!fullName || !email || !departmentId) {
      return { error: "جميع الحقول مطلوبة", success: false };
    }

    const department = await prisma.department.findUniqueOrThrow({ where: { id: departmentId } });

    const invite = await prisma.invite.create({
      data: { fullName, email, departmentId, invitedById: session.user.id },
    });

    const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
    await sendInviteEmail({
      to: email,
      fullName,
      departmentName: department.name,
      inviteUrl: `${baseUrl}/invite/${invite.token}`,
    });

    revalidatePath("/admin");
    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "حدث خطأ غير متوقع", success: false };
  }
}

export async function approveMemberAction(memberId: string) {
  await requireAdmin();
  await approveMember(memberId);
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}

export async function rejectMemberAction(memberId: string) {
  await requireAdmin();
  await rejectMember(memberId);
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}

export async function reopenInviteAction(memberId: string) {
  await requireAdmin();
  await reopenInviteForMember(memberId);
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}

export async function updateRequestStatusAction(requestId: string, status: "new" | "in_progress" | "done") {
  await requireAdmin();
  await prisma.request.update({ where: { id: requestId }, data: { status } });
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}
