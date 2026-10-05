import { prisma } from "@/lib/prisma";
import { appendApprovedMember } from "@/lib/googleSheets";
import { sendMeetingReminderEmail } from "@/lib/email";

export const PASS_THRESHOLD = 80;
export const WELCOME_BANNER_DUE_DAYS = 2;

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** يرفّع أي طلب تجاوز مهلته الزمنية ولم يُنجز إلى حالة "متأخر" — تُستدعى عند كل قراءة للوحة */
export async function sweepOverdueRequests(targetDepartmentId?: string) {
  await prisma.request.updateMany({
    where: {
      status: { in: ["new", "in_progress"] },
      dueDate: { lt: new Date() },
      ...(targetDepartmentId ? { targetDepartmentId } : {}),
    },
    data: { status: "overdue" },
  });
}

/** يُسجّل محاولة اختبار المرشح ويطبّق مسار القبول: ≥80% بانتظار الاعتماد، أقل من ذلك يطلب اجتماع شرح */
export async function submitTestAttempt(opts: {
  memberId: string;
  answers: Record<string, string>;
  score: number;
}) {
  const passed = opts.score >= PASS_THRESHOLD;

  await prisma.testAttempt.create({
    data: { memberId: opts.memberId, answers: opts.answers, score: opts.score, passed },
  });

  const member = await prisma.member.update({
    where: { id: opts.memberId },
    data: {
      testScore: opts.score,
      testStatus: passed ? "passed" : "failed",
      approvalStatus: "pending_review",
    },
    include: { department: true },
  });

  if (!passed) {
    const dueDate = addDays(new Date(), 3);
    await prisma.request.create({
      data: {
        type: "meeting",
        targetDepartmentId: member.departmentId,
        linkedMemberId: member.id,
        status: "new",
        dueDate,
        note: `جدولة اجتماع شرح لـ ${member.fullName} (النتيجة: ${opts.score}%)`,
      },
    });
    await sendMeetingReminderEmail({
      to: member.email,
      candidateName: member.fullName,
      dueDate,
    });
  }

  return member;
}

/** اعتماد نهائي من Department Admin أو الإدارة العليا — يكتب في Google Sheet وينشئ طلب بانر ترحيبي للتسويق */
export async function approveMember(memberId: string) {
  const member = await prisma.member.update({
    where: { id: memberId },
    data: { approvalStatus: "approved", decidedAt: new Date() },
    include: { department: true },
  });

  await appendApprovedMember({
    fullName: member.fullName,
    email: member.email,
    departmentName: member.department.name,
    jobTitle: member.jobTitle,
    approvedAt: member.decidedAt ?? new Date(),
  });

  const marketing = await prisma.department.findUnique({ where: { slug: "marketing" } });
  if (marketing) {
    await prisma.request.create({
      data: {
        type: "welcome_banner",
        targetDepartmentId: marketing.id,
        linkedMemberId: member.id,
        status: "new",
        dueDate: addDays(new Date(), WELCOME_BANNER_DUE_DAYS),
        note: `بانر ترحيبي للعضو الجديد: ${member.fullName}`,
      },
    });
  }

  return member;
}

export async function rejectMember(memberId: string) {
  return prisma.member.update({
    where: { id: memberId },
    data: { approvalStatus: "rejected", decidedAt: new Date() },
  });
}

/** يعيد فتح الدعوة لنفس الشخص بعد اجتماع الشرح إذا رآه أدمن القسم مناسباً */
export async function reopenInviteForMember(memberId: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  return prisma.invite.update({
    where: { id: member.inviteId },
    data: { status: "open" },
  });
}
