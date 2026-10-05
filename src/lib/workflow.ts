import { prisma } from "@/lib/prisma";
import { appendApprovedMember, appendMemberEvent, appendTestResult, upsertMemberLifecycleRow } from "@/lib/googleSheets";
import {
  sendMeetingReminderEmail,
  sendCredentialsEmail,
  sendWarningEmail,
  sendExitEmail,
  sendCertificateEmail,
} from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { generateTempPassword, hashPassword } from "@/lib/credentials";
import { scoreAnswers } from "@/lib/testTracks";

export const PASS_THRESHOLD = 80;
export const WELCOME_BANNER_DUE_DAYS = 2;
export const MAX_WARNINGS = 3;

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function baseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

function reachedThreeMonths(decidedAt: Date, terminatedAt: Date | null): "نعم" | "لا بعد" | "توقف قبل إكمالها" {
  const endDate = terminatedAt ?? new Date();
  const reached = endDate.getTime() - decidedAt.getTime() >= THREE_MONTHS_MS;
  if (terminatedAt) return reached ? "نعم" : "توقف قبل إكمالها";
  return reached ? "نعم" : "لا بعد";
}

/** يكتب/يحدّث الصف الثابت الخاص بعضو واحد في تبويب دورة الحياة — يُستدعى عند
 *  أي تغيّر بحالته: الاعتماد، تسليم البانر، تنبيه، توقف، أو إصدار شهادة */
export async function syncMemberLifecycleRow(memberId: string) {
  const member = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    include: { department: true },
  });
  if (!member.decidedAt) return;

  const bannerRequest = await prisma.request.findFirst({
    where: { type: "welcome_banner", linkedMemberId: memberId },
  });

  const result = await upsertMemberLifecycleRow({
    sheetRow: member.sheetRow,
    fullName: member.fullName,
    email: member.email,
    departmentName: member.department?.name ?? "—",
    decidedAt: member.decidedAt,
    bannerDelivered: bannerRequest ? bannerRequest.status === "done" : null,
    bannerDeliveredAt: bannerRequest?.status === "done" ? bannerRequest.updatedAt : null,
    reachedThreeMonths: reachedThreeMonths(member.decidedAt, member.terminatedAt),
    certificateIssuedAt: member.certificateIssuedAt,
    isActive: member.isActive,
    terminatedAt: member.terminatedAt,
    exitReason: member.exitReason,
    warningsCount: member.warningsCount,
  });

  if (!member.sheetRow && result.sheetRow) {
    await prisma.member.update({ where: { id: member.id }, data: { sheetRow: result.sheetRow } });
  }
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

/** يُسجّل محاولة اختبار المرشح (لأي مستوى) من بنك أسئلة الدعوة نفسها، ويطبّق
 *  مسار القبول: ≥80% بانتظار الاعتماد، أقل من ذلك رسوب (ولعضو القسم فقط يُنشأ
 *  طلب اجتماع شرح تلقائي لأن القيادة ليس لها قسم مالك بعد) */
export async function submitTestAttempt(opts: { memberId: string; answers: Record<string, number> }) {
  const member = await prisma.member.findUniqueOrThrow({
    where: { id: opts.memberId },
    include: { invite: { include: { testTrack: { include: { questions: true } } } }, department: true },
  });

  const score = scoreAnswers(member.invite.testTrack.questions, opts.answers);
  const passed = score >= PASS_THRESHOLD;

  await prisma.testAttempt.create({
    data: { memberId: opts.memberId, answers: opts.answers, score, passed },
  });

  const updated = await prisma.member.update({
    where: { id: opts.memberId },
    data: {
      testScore: score,
      testStatus: passed ? "passed" : "failed",
      approvalStatus: "pending_review",
    },
    include: { department: true, invite: true },
  });

  await appendTestResult({
    fullName: updated.fullName,
    email: updated.email,
    track: updated.department?.name ?? (updated.invite.targetRole === "executive" ? "الإدارة التنفيذية" : "قيادة قسم"),
    score,
    passed,
    at: new Date(),
  });

  if (!passed && updated.invite.targetRole === "member" && updated.departmentId) {
    const dueDate = addDays(new Date(), 3);
    await prisma.request.create({
      data: {
        type: "meeting",
        targetDepartmentId: updated.departmentId,
        linkedMemberId: updated.id,
        status: "new",
        dueDate,
        note: `جدولة اجتماع شرح لـ ${updated.fullName} (النتيجة: ${score}%)`,
      },
    });
    await sendMeetingReminderEmail({ to: updated.email, candidateName: updated.fullName, dueDate });
  }

  return { member: updated, score, passed };
}

/** اعتماد نهائي: لعضو قسم يُسجَّل في Google Sheet وينشئ طلب بانر ترحيبي للتسويق؛
 *  لمرشح قيادي (قائد قسم/تنفيذي) يُنشئ حساب دخول إداري (User) بدلاً من ذلك.
 *  في الحالتين تُولَّد كلمة مرور مؤقتة ويُجبر المستخدم على تغييرها عند أول دخول. */
export async function approveMember(memberId: string) {
  const member = await prisma.member.update({
    where: { id: memberId },
    data: { approvalStatus: "approved", decidedAt: new Date() },
    include: { department: true, invite: true },
  });

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  if (member.invite.targetRole === "member") {
    await prisma.member.update({
      where: { id: member.id },
      data: { passwordHash, mustChangePassword: true },
    });

    await appendApprovedMember({
      fullName: member.fullName,
      email: member.email,
      departmentName: member.department?.name ?? "—",
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

    await syncMemberLifecycleRow(member.id);
  } else {
    const role = member.invite.targetRole === "executive" ? "executive" : "department_admin";
    await prisma.user.create({
      data: {
        fullName: member.fullName,
        email: member.email,
        passwordHash,
        mustChangePassword: true,
        role,
        departmentId: role === "department_admin" ? member.departmentId : null,
      },
    });

    await appendApprovedMember({
      fullName: member.fullName,
      email: member.email,
      departmentName: member.department?.name ?? "الإدارة التنفيذية",
      jobTitle: member.jobTitle,
      approvedAt: member.decidedAt ?? new Date(),
    });
  }

  await sendCredentialsEmail({
    to: member.email,
    fullName: member.fullName,
    tempPassword,
    loginUrl: `${baseUrl()}/login`,
  });

  return { member, tempPassword };
}

export async function rejectMember(memberId: string) {
  const member = await prisma.member.update({
    where: { id: memberId },
    data: { approvalStatus: "rejected", decidedAt: new Date() },
  });
  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "رفض",
    details: "تم رفض الطلب بعد المراجعة",
    at: new Date(),
  });
  return member;
}

/** يعيد فتح الدعوة لنفس الشخص بعد اجتماع الشرح إذا رآه أدمن القسم مناسباً */
export async function reopenInviteForMember(memberId: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  return prisma.invite.update({
    where: { id: member.inviteId },
    data: { status: "open" },
  });
}

/** يصدر تنبيهاً لعضو معتمد — عند بلوغ 3 تنبيهات يُستبعد تلقائياً */
export async function issueWarning(opts: { memberId: string; issuedByUserId: string; reason: string }) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: opts.memberId } });

  await prisma.memberWarning.create({
    data: { memberId: member.id, issuedByUserId: opts.issuedByUserId, reason: opts.reason },
  });

  const warningsCount = member.warningsCount + 1;
  const terminated = warningsCount >= MAX_WARNINGS;

  await prisma.member.update({
    where: { id: member.id },
    data: {
      warningsCount,
      isActive: !terminated,
      ...(terminated ? { terminatedAt: new Date(), exitReason: "تجاوز 3 تنبيهات" } : {}),
    },
  });

  await sendWarningEmail({
    to: member.email,
    fullName: member.fullName,
    reason: opts.reason,
    warningsCount,
    loginUrl: `${baseUrl()}/login`,
  });

  if (member.phone) {
    await sendWhatsAppMessage({
      to: member.phone,
      text: terminated
        ? `عذراً ${member.fullName}، تم إنهاء عضويتك في تَـــلاقِ بعد تجاوز 3 تنبيهات.`
        : `تنبيه (${warningsCount}/3) من تَـــلاقِ: ${opts.reason}. يرجى الدخول للمنصة للاطلاع.`,
    });
  }

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: terminated ? "استبعاد" : `تنبيه ${warningsCount}/3`,
    details: opts.reason,
    at: new Date(),
  });

  await syncMemberLifecycleRow(member.id);

  return { warningsCount, terminated };
}

/** إنهاء عضوية يدوي (استقالة أو قرار إداري) — بخلاف الاستبعاد التلقائي بتجاوز
 *  التنبيهات. يُسجَّل السبب كما كتبه الأدمن ويُرسل إشعاراً للعضو */
export async function markMemberExited(memberId: string, reason: string) {
  const member = await prisma.member.update({
    where: { id: memberId },
    data: { isActive: false, terminatedAt: new Date(), exitReason: reason },
  });

  await sendExitEmail({ to: member.email, fullName: member.fullName, reason });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "إنهاء عضوية",
    details: reason,
    at: new Date(),
  });

  await syncMemberLifecycleRow(member.id);

  return member;
}

/** إصدار شهادة إتمام لعضو — عملية يدوية يقررها الأدمن، غير مربوطة بالضرورة
 *  بإكمال 3 أشهر (تظهر كتوصية بالعمود المجاور بالشيت لكن القرار للأدمن) */
export async function issueCertificate(memberId: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (member.certificateIssuedAt) return member;

  const updated = await prisma.member.update({
    where: { id: memberId },
    data: { certificateIssuedAt: new Date() },
  });

  await sendCertificateEmail({ to: member.email, fullName: member.fullName });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "إصدار شهادة",
    details: "شهادة إتمام",
    at: new Date(),
  });

  await syncMemberLifecycleRow(member.id);

  return updated;
}

export async function acknowledgeWarning(warningId: string, memberId: string) {
  const warning = await prisma.memberWarning.findUniqueOrThrow({ where: { id: warningId } });
  if (warning.memberId !== memberId) throw new Error("غير مصرح");
  return prisma.memberWarning.update({
    where: { id: warningId },
    data: { acknowledgedAt: new Date() },
  });
}

/** يعيد تعيين كلمة مرور عضو (ويحدّث بريده اختيارياً) عند نسيانه أو أي إشكالية —
 *  يولّد كلمة مرور مؤقتة جديدة، يجبر تغييرها عند الدخول التالي، ويرسلها بالبريد */
export async function resetMemberCredentials(memberId: string, newEmail?: string) {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const member = await prisma.member.update({
    where: { id: memberId },
    data: {
      passwordHash,
      mustChangePassword: true,
      ...(newEmail ? { email: newEmail } : {}),
    },
  });

  await sendCredentialsEmail({
    to: member.email,
    fullName: member.fullName,
    tempPassword,
    loginUrl: `${baseUrl()}/login`,
  });

  return { member, tempPassword };
}

/** نفس الفكرة لحساب إداري (قائد قسم / تنفيذي) */
export async function resetUserCredentials(userId: string, newEmail?: string) {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: true,
      ...(newEmail ? { email: newEmail } : {}),
    },
  });

  await sendCredentialsEmail({
    to: user.email,
    fullName: user.fullName,
    tempPassword,
    loginUrl: `${baseUrl()}/login`,
  });

  return { user, tempPassword };
}
