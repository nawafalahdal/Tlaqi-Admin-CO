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
import { respondToTicket, withdrawTicket, canRespondToTicket } from "@/lib/tickets";
import { getTrackForTarget } from "@/lib/testTracks";
import type { Session } from "next-auth";
import { safeErrorMessage } from "@/lib/safeError";
import {
  stepDownMember,
  markCertificateShared,
  markFarewellDesigned,
  closeOffboarding,
} from "@/lib/offboarding";
import {
  requestCommittee,
  withdrawCommittee,
  canRequestCommitteeIn,
  committeeLeadTitle,
} from "@/lib/committees";
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
    const res = await issueCertificate(memberId);
    revalidatePath(`/admin/departments`);
    // صدرت الشهادة وتعذّر بريدها: يُقال صريحاً ليُعاد الضغط، لا يُقال «تمّ»
    return { error: res.ok ? null : res.reason };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** يرد أدمن القسم (المستهدف أصلاً أو قائد قسم العضو بعد التصعيد) على تذكرة —
 *  المؤسس/التنفيذي مصرَّح لهما دائماً */
/** ويُعيد الرفضَ نصّاً لا يرميه استثناءً.
 *
 *  كان يرمي، فكان منعُ التصريح — وهو حكمُ حوكمةٍ مفهوم — يصل إلى صاحبه
 *  صفحةَ انهيارٍ بيضاء ورقمَ هضمٍ لا يقرؤه أحد. والرفض المفهوم يُقال، لا
 *  يُسقِط الصفحة. */
export async function respondToTicketAction(
  ticketId: string,
  status: "in_progress" | "resolved",
  resolutionNote: string
): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { member: true, raisedByUser: true, targetMember: true },
  });
  if (!ticket) return { error: "التذكرة غير موجودة" };

  // قاعدة واحدة تحكم الردّ في كل الشاشات — ومنها أن صاحب التذكرة لا يُغلقها
  if (!canRespondToTicket(ticket, session)) {
    return {
      error:
        ticket.raisedByUserId === session.user.id
          ? "هذه تذكرة رفعتَها أنت — وإغلاقها إقرارٌ بأن الطرف الآخر أجاب. إن لم تعد تحتاجها فاسحبها."
          : "الردّ على هذه التذكرة لصاحب مرحلتها الحالية",
    };
  }

  const res = await respondToTicket({
    ticketId,
    status,
    resolutionNote,
    actorUserId: session.user.id,
  });
  if (!res.ok) return { error: res.reason };
  revalidatePath("/admin/departments");
  revalidatePath("/admin/tickets");
  revalidatePath("/admin");
  return { error: null };
}

/** يسحب صاحبُ التذكرة تذكرتَه — والتصريح يُفرض في `withdrawTicket` نفسها
 *  بشرطٍ في `where`، لا بفحصٍ هنا يسبق الكتابة. */
export async function withdrawTicketAction(
  ticketId: string,
  reason: string
): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const res = await withdrawTicket({
    ticketId,
    actorUserId: session.user.id,
    reason,
  });
  if (!res.ok) return { error: res.reason };
  revalidatePath("/admin/departments");
  revalidatePath("/admin/tickets");
  revalidatePath("/admin");
  revalidatePath("/member");
  return { error: null };
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
    // جوابُ الإصدار يُعاد لصاحب الزرّ — كان يُهمَل فيبدو الرفضُ نجاحاً
    if (step === "certificate") {
      const res = await markCertificateShared(memberId, byName);
      if (!res.ok) return { error: res.reason };
    } else await markFarewellDesigned(memberId, byName);
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

/** اقتراحُ لجنةٍ داخل قسم — من لوحة قائده.
 *
 *  والتصريحُ يُفرَض في `requestCommittee` نفسها لا هنا: الإجراء بابٌ
 *  يُنادى من أي مكان، والحرسُ عند الحقيقة لا عند الواجهة. */
export async function requestCommitteeAction(
  _prevState: { error: string | null; success: boolean; message?: string },
  formData: FormData
): Promise<{ error: string | null; success: boolean; message?: string }> {
  try {
    const session = await auth();
    if (!session) return { error: "يجب تسجيل الدخول", success: false };

    const res = await requestCommittee({
      parentId: String(formData.get("parentId") ?? ""),
      name: String(formData.get("name") ?? ""),
      leadTitle: String(formData.get("leadTitle") ?? ""),
      session,
    });
    if (!res.ok) return { error: res.reason, success: false };

    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    revalidatePath("/structure");
    return {
      error: null,
      success: true,
      message: res.approverName
        ? `أُرسل اقتراح «${res.name}» إلى ${res.approverName} — لا تُفتح حتى يُعتمد`
        : `سُجِّل اقتراح «${res.name}» — ولم يُوجَد معتمِدٌ نشطٌ ليُخبَر`,
    };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** سحبُ اقتراحٍ أو إزالةُ لجنةٍ مردودة — للساكن وحده */
export async function withdrawCommitteeAction(
  committeeId: string
): Promise<{ error: string | null; done?: boolean; name?: string }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
  try {
    const res = await withdrawCommittee({ committeeId, session });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null, done: true, name: res.name };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** دعوةُ قائدٍ للجنةٍ معتمدة — بيد قائد القسم الأب.
 *
 *  **وهذا هو ما يُدير الدائرة:** المدعوُّ يصير `department_admin` قسمُه
 *  اللجنة، فله لوحةٌ ودعواتٌ وبنكُ أسئلةٍ وتذاكرُ كقائد القسم — لكن في
 *  نطاق لجنته وحدها. والمسمّى مسمّاها الذي أُقرَّ عند اعتمادها.
 *
 *  ولا تُدعى قيادةٌ للجنةٍ لم تُعتمد: ذاك اقتراحٌ لا منصب. */
export async function inviteCommitteeLeadAction(
  _prevState: { error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } },
  formData: FormData
): Promise<{ error: string | null; success: boolean; credentials?: { email: string; tempPassword: string } }> {
  try {
    const session = await auth();
    if (!session) return { error: "يجب تسجيل الدخول", success: false };

    const committeeId = String(formData.get("committeeId") ?? "");
    const committee = await prisma.department.findUnique({
      where: { id: committeeId },
      select: { id: true, name: true, leadTitle: true, parentId: true, committeeStatus: true },
    });
    if (!committee || !committee.parentId) {
      return { error: "اللجنة غير موجودة", success: false };
    }
    if (committee.committeeStatus !== "approved") {
      return { error: "هذه اللجنة لم تُعتمد بعد — لا تُدعى لها قيادة قبل فتحها", success: false };
    }
    if (!canRequestCommitteeIn(session, committee.parentId)) {
      return { error: "دعوة قيادة اللجنة لقائد القسم نفسه — ومن يعلوه", success: false };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!fullName || !email) return { error: "الاسم والبريد مطلوبان", success: false };

    // المسمّى مسمّى اللجنة المُقَرّ، لا ما يكتبه الداعي لحظتها: أُقِرَّ
    // مع اعتمادها فلا يُغيَّر بعده من نموذجٍ عابر
    const jobTitle = committeeLeadTitle(committee.name, committee.leadTitle);
    // واختبارُه اختبارُ القادة نفسُه: قائدُ اللجنة قائدٌ بمسؤوليةٍ أصغر
    // لا صفةٌ أخرى — ولو أُعفي منه لصار باباً خلفياً إلى القيادة.
    const track = await getTrackForTarget("department_admin", null);

    const { tempPassword } = await createCandidateAccount({
      fullName,
      email,
      jobTitle,
      targetRole: "department_admin",
      departmentId: committee.id,
      testTrackId: track.id,
      invitedById: session.user.id,
    });

    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null, success: true, credentials: { email, tempPassword } };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
