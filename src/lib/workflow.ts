import { prisma } from "@/lib/prisma";
import { appendApprovedMember, appendMemberEvent } from "@/lib/googleSheets";
import { sendMeetingReminderEmail, sendCredentialsEmail, sendWarningEmail } from "@/lib/email";
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
    data: { warningsCount, isActive: !terminated },
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

  return { warningsCount, terminated };
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
