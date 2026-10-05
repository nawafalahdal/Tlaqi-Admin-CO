"use server";

import { auth } from "@/auth";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { approveMember, rejectMember, reopenInviteForMember } from "@/lib/workflow";
import { getTrackForTarget, ROLE_LABELS } from "@/lib/testTracks";
import { revalidatePath } from "next/cache";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("يجب تسجيل الدخول");
  return session;
}

/** يتحقق أن الجلسة الحالية تملك صلاحية إدارة قسم معيّن (الإدارة العليا والتنفيذي
 *  يديران كل الأقسام، أدمن القسم يدير قسمه فقط) */
function canManageDepartment(session: Session, departmentId: string | null) {
  if (session.user.role === "super_admin" || session.user.role === "executive") return true;
  return session.user.role === "department_admin" && session.user.departmentId === departmentId;
}

/** الفاونڈر فقط يُصدر دعوة لحساب تنفيذي (CEO) جديد */
export async function createExecutiveInviteAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await requireSession();
    if (session.user.role !== "super_admin") {
      return { error: "هذا الإجراء خاص بالفاونڈر فقط", success: false };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!fullName || !email) return { error: "جميع الحقول مطلوبة", success: false };

    const track = await getTrackForTarget("executive", null);
    const invite = await prisma.invite.create({
      data: {
        fullName,
        email,
        targetRole: "executive",
        testTrackId: track.id,
        invitedById: session.user.id,
      },
    });

    await sendInviteEmail({
      to: email,
      fullName,
      roleLabel: ROLE_LABELS.executive,
      inviteUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/invite/${invite.token}`,
    });

    revalidatePath("/admin");
    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "حدث خطأ غير متوقع", success: false };
  }
}

/** الفاونڈر أو التنفيذي يُصدر دعوة لحساب قائد قسم جديد — لا يمكن إضافة عضو داخل
 *  القسم مباشرة من هنا، فقط حساب قيادي (حوكمة صارمة بالتسلسل) */
export async function createDeptAdminInviteAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await requireSession();
    if (session.user.role !== "super_admin" && session.user.role !== "executive") {
      return { error: "هذا الإجراء خاص بالفاونڈر أو التنفيذي فقط", success: false };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const departmentId = String(formData.get("departmentId") ?? "");
    if (!fullName || !email || !departmentId) return { error: "جميع الحقول مطلوبة", success: false };

    const track = await getTrackForTarget("department_admin", null);
    const invite = await prisma.invite.create({
      data: {
        fullName,
        email,
        targetRole: "department_admin",
        departmentId,
        testTrackId: track.id,
        invitedById: session.user.id,
      },
    });

    await sendInviteEmail({
      to: email,
      fullName,
      roleLabel: ROLE_LABELS.department_admin,
      inviteUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/invite/${invite.token}`,
    });

    revalidatePath("/admin");
    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "حدث خطأ غير متوقع", success: false };
  }
}

export async function approveMemberAction(memberId: string) {
  const session = await requireSession();
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (!canManageDepartment(session, member.departmentId)) throw new Error("غير مصرح لك بهذا الإجراء");
  await approveMember(memberId);
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}

export async function rejectMemberAction(memberId: string) {
  const session = await requireSession();
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (!canManageDepartment(session, member.departmentId)) throw new Error("غير مصرح لك بهذا الإجراء");
  await rejectMember(memberId);
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}

export async function reopenInviteAction(memberId: string) {
  const session = await requireSession();
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (!canManageDepartment(session, member.departmentId)) throw new Error("غير مصرح لك بهذا الإجراء");
  await reopenInviteForMember(memberId);
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}

export async function updateRequestStatusAction(
  requestId: string,
  status: "new" | "in_progress" | "done"
) {
  const session = await requireSession();
  const request = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
  if (!canManageDepartment(session, request.targetDepartmentId)) {
    throw new Error("غير مصرح لك بهذا الإجراء");
  }
  await prisma.request.update({ where: { id: requestId }, data: { status } });
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}
