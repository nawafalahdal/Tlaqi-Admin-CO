"use server";

import { auth } from "@/auth";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import {
  approveMember,
  createCandidateAccount,
  rejectMember,
  reopenInviteForMember,
  syncMemberLifecycleRow,
} from "@/lib/workflow";
import { getTrackForTarget } from "@/lib/testTracks";
import { safeErrorMessage } from "@/lib/safeError";
import { correctMemberDate, sendWelcomeToMember } from "@/lib/founderActions";
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

/** المؤسس فقط يُصدر دعوة لحساب تنفيذي (CEO) جديد */
export async function createExecutiveInviteAction(
  _prevState: { error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } },
  formData: FormData
): Promise<{ error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } }> {
  try {
    const session = await requireSession();
    if (session.user.role !== "super_admin") {
      return { error: "هذا الإجراء خاص بالمؤسس فقط", success: false };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    // المسمى الوظيفي تحدّده الإدارة الداعية لا المرشّح: هي من تعرف
    // لماذا دعته وبأي صفة، وتركه له يجعل كل واحد يسمّي نفسه بما يشاء
    const jobTitle = String(formData.get("jobTitle") ?? "").trim();
    if (!fullName || !email || !jobTitle) return { error: "جميع الحقول مطلوبة", success: false };

    const track = await getTrackForTarget("executive", null);
    const { tempPassword } = await createCandidateAccount({
      fullName,
      email,
      jobTitle,
      targetRole: "executive",
      departmentId: null,
      testTrackId: track.id,
      invitedById: session.user.id,
    });

    revalidatePath("/admin");
    return { error: null, success: true, credentials: { email, tempPassword } };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** المؤسس أو التنفيذي يُصدر دعوة لحساب قائد قسم جديد — لا يمكن إضافة عضو داخل
 *  القسم مباشرة من هنا، فقط حساب قيادي (حوكمة صارمة بالتسلسل) */
export async function createDeptAdminInviteAction(
  _prevState: { error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } },
  formData: FormData
): Promise<{ error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } }> {
  try {
    const session = await requireSession();
    if (session.user.role !== "super_admin" && session.user.role !== "executive") {
      return { error: "هذا الإجراء خاص بالمؤسس أو التنفيذي فقط", success: false };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    // المسمى الوظيفي تحدّده الإدارة الداعية لا المرشّح: هي من تعرف
    // لماذا دعته وبأي صفة، وتركه له يجعل كل واحد يسمّي نفسه بما يشاء
    const jobTitle = String(formData.get("jobTitle") ?? "").trim();
    const departmentId = String(formData.get("departmentId") ?? "");
    if (!fullName || !email || !departmentId || !jobTitle) {
      return { error: "جميع الحقول مطلوبة", success: false };
    }

    const track = await getTrackForTarget("department_admin", null);
    const { tempPassword } = await createCandidateAccount({
      fullName,
      email,
      jobTitle,
      targetRole: "department_admin",
      departmentId: departmentId,
      testTrackId: track.id,
      invitedById: session.user.id,
    });

    revalidatePath("/admin");
    return { error: null, success: true, credentials: { email, tempPassword } };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** المدير التنفيذي يُصدر دعوة حساب مسؤول التشغيل — اطّلاع على كل التذاكر
 *  والطلبات عبر كل الأقسام وإرسال تذكيرات، بدون صلاحية حل التذاكر.
 *
 *  ودعوته للتنفيذي وحده كما أن بنك أسئلته له: مسؤول التشغيل ذراع التنفيذي
 *  في التشغيل اليومي، ومن يملك اختياره يجب أن يملك محاسبته. ودعوةُ المؤسس
 *  له تجعل التنفيذي مسؤولاً عمّن لم يَختَره.
 */
export async function createOperationsOfficerInviteAction(
  _prevState: { error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } },
  formData: FormData
): Promise<{ error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } }> {
  try {
    const session = await requireSession();
    if (session.user.role !== "executive") {
      return { error: "دعوة مسؤول التشغيل خاصة بالمدير التنفيذي", success: false };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    // المسمى الوظيفي تحدّده الإدارة الداعية لا المرشّح: هي من تعرف
    // لماذا دعته وبأي صفة، وتركه له يجعل كل واحد يسمّي نفسه بما يشاء
    const jobTitle = String(formData.get("jobTitle") ?? "").trim();
    if (!fullName || !email || !jobTitle) return { error: "جميع الحقول مطلوبة", success: false };

    const track = await getTrackForTarget("operations_officer", null);
    const { tempPassword } = await createCandidateAccount({
      fullName,
      email,
      jobTitle,
      targetRole: "operations_officer",
      departmentId: null,
      testTrackId: track.id,
      invitedById: session.user.id,
    });

    revalidatePath("/admin");
    return { error: null, success: true, credentials: { email, tempPassword } };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function approveMemberAction(memberId: string) {
  const session = await requireSession();
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (!canManageDepartment(session, member.departmentId)) throw new Error("غير مصرح لك بهذا الإجراء");
  const { tempPassword } = await approveMember(memberId);
  revalidatePath("/admin");
  revalidatePath("/admin/departments");
  return { tempPassword, email: member.email };
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

  if (request.type === "welcome_banner" && status === "done" && request.linkedMemberId) {
    await syncMemberLifecycleRow(request.linkedMemberId);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/departments");
}

/** تصحيح تاريخ الانضمام التنظيمي — للمؤسس وحده.
 *
 *  التحقّق في `correderMemberDate` نفسها لا هنا فقط: لو نُوديت من مسارٍ
 *  آخر بقي الحرس. وهنا يُقرأ الدور من الجلسة لا من الواجهة. */
export async function correctOrgJoinDateAction(
  memberId: string,
  isoDate: string | null,
  note?: string
): Promise<{ error: string | null }> {
  const session = await requireSession();
  try {
    // تاريخٌ فارغ يُفرِغ الحقل؛ ونصٌّ غير صالح يُرفض قبل أن يصل القاعدة
    let value: Date | null = null;
    if (isoDate && isoDate.trim()) {
      const d = new Date(isoDate);
      if (Number.isNaN(d.getTime())) return { error: "تاريخ غير صالح" };
      value = d;
    }
    const res = await correctMemberDate({
      memberId,
      field: "orgJoinDate",
      value,
      note,
      actorRole: session.user.role,
      actorId: session.user.id,
      actorName: session.user.name ?? "—",
    });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/members");
    revalidatePath("/admin/departments");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** إرسال بطاقة الانضمام لعضوٍ بعينه — للمؤسس وحده.
 *
 *  تُرجع نتيجة التسليم لتُعرَض: «تمّ» بلا تأكيدٍ من المُرسِل وعدٌ لا
 *  يُتحقَّق منه، ومن لم تصله يُعاد له بلا إنشاء شيء. */
export async function sendWelcomeToMemberAction(
  memberId: string
): Promise<{ error: string | null; to: string | null }> {
  const session = await requireSession();
  try {
    const res = await sendWelcomeToMember({
      memberId,
      actorRole: session.user.role,
      actorName: session.user.name ?? "—",
    });
    if (!res.ok) return { error: res.reason, to: null };
    revalidatePath("/admin/members");
    return { error: null, to: res.to };
  } catch (err) {
    return { error: safeErrorMessage(err), to: null };
  }
}
