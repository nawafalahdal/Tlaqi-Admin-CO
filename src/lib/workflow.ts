import { prisma } from "@/lib/prisma";
import { clearFailedAttempts } from "@/lib/loginAttempts";
import { appendApprovedMember, appendMemberEvent, appendTestResult, upsertMemberLifecycleRow, upsertAdminAccountRow } from "@/lib/googleSheets";
import {
  sendCredentialsEmail,
  sendTestPassedEmail,
  sendTestFailedEmail,
  sendMeetingOwnerEmail,
  sendApprovedEmail,
  sendWindowReminderEmail,
  sendWarningEmail,
  sendExitEmail,
  sendCertificateEmail,
  sendRequestReminderEmail,
} from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { generateTempPassword, hashPassword } from "@/lib/credentials";
import { scoreAnswers, ROLE_LABELS } from "@/lib/testTracks";


/** تسمية القسم أو الصفة كما تظهر في عمود "القسم / الصفة" بالسجل الحي.
 *  تقبل العضو سواء جُلب معه قسمه أو لا — وتستعلم عنه عند الحاجة فقط. */
async function memberScope(member: {
  departmentId?: string | null;
  department?: { name: string } | null;
  invite?: { targetRole: string } | null;
}): Promise<string> {
  if (member.department?.name) return member.department.name;
  if (member.departmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: member.departmentId },
      select: { name: true },
    });
    if (dept) return dept.name;
  }
  const role = member.invite?.targetRole;
  return role ? (ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role) : "—";
}

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

function reachedThreeMonths(
  decidedAt: Date | null,
  terminatedAt: Date | null
): "نعم" | "لا بعد" | "توقف قبل إكمالها" | "لم يُعتمد بعد" {
  // المدة تُحسب من الاعتماد: من لم يُعتمد بعد لم تبدأ أشهره أصلاً
  if (!decidedAt) return "لم يُعتمد بعد";
  const endDate = terminatedAt ?? new Date();
  const reached = endDate.getTime() - decidedAt.getTime() >= THREE_MONTHS_MS;
  if (terminatedAt) return reached ? "نعم" : "توقف قبل إكمالها";
  return reached ? "نعم" : "لا بعد";
}

/** المرحلة التي يقف عندها العضو الآن، بعبارة واحدة مقروءة — هي العمود الذي
 *  يُغني عن قراءة بقية الأعمدة لمعرفة أين وصل كل شخص */
function memberStage(member: {
  isActive: boolean;
  exitReason: string | null;
  approvalStatus: string;
  testStatus: string;
  firstLoginAt: Date | null;
}): string {
  if (!member.isActive) {
    if (member.exitReason === CANDIDATE_EXPIRY_REASON) return "سقطت مهلته قبل الدخول";
    return "متوقف";
  }
  if (member.approvalStatus === "rejected") return "مرفوض";
  if (member.approvalStatus === "approved") return "عضو معتمد";
  if (member.testStatus === "passed") return "اجتاز — بانتظار الاعتماد";
  if (member.testStatus === "failed") return "لم يجتز الاختبار";
  if (!member.firstLoginAt) return "مرشّح — لم يدخل بعد";
  return "مرشّح — لم يُسلّم الاختبار";
}

/** يكتب/يحدّث الصف الثابت الخاص بعضو واحد في تبويب دورة الحياة.
 *
 *  يُستدعى منذ لحظة إنشاء الحساب، لا عند الاعتماد فقط: كان الشرط السابق
 *  (decidedAt) يعني أن المرشّح لا يظهر في تبويب الأعضاء إطلاقاً حتى يُعتمد،
 *  فيبقى أثره الوحيد سطراً في السجل الحي — وهذا سبب امتلاء السجل الحي
 *  وحده وبقاء بقية التبويبات فارغة. */
export async function syncMemberLifecycleRow(memberId: string) {
  const member = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    include: { department: true, invite: true },
  });

  const bannerRequest = await prisma.request.findFirst({
    where: { type: "welcome_banner", linkedMemberId: memberId },
  });

  const result = await upsertMemberLifecycleRow({
    sheetRow: member.sheetRow,
    fullName: member.fullName,
    email: member.email,
    departmentName: member.department?.name ?? "—",
    roleLabel: ROLE_LABELS[member.invite.targetRole] ?? member.invite.targetRole,
    stage: memberStage(member),
    phone: member.phone,
    jobTitle: member.jobTitle,
    createdAt: member.createdAt,
    credentialsIssuedAt: member.credentialsIssuedAt,
    firstLoginAt: member.firstLoginAt,
    testScore: member.testScore,
    testStatus: member.testStatus,
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

/** نظير دالة الأعضاء للحسابات الإدارية — صف ثابت واحد لكل حساب، يُحدَّث عند
 *  إنشائه، أو تغيير كلمة مروره، أو تفعيل التحقق بخطوتين، أو تنحيته */
export async function syncAdminAccountRow(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { department: true },
  });

  const result = await upsertAdminAccountRow({
    sheetRow: user.sheetRow,
    fullName: user.fullName,
    email: user.email,
    roleLabel: ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role,
    departmentName: user.department?.name ?? null,
    totpEnabled: user.totpEnabled,
    isActive: user.isActive,
    createdAt: user.createdAt,
    passwordChangedAt: user.passwordChangedAt,
    removedAt: user.removedAt,
    removalReason: user.removalReason,
  });

  if (!user.sheetRow && result.sheetRow) {
    await prisma.user.update({ where: { id: user.id }, data: { sheetRow: result.sheetRow } });
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

  // المطالبة الذرّية: شرط not_started يضمن أن إرسالين متزامنين لا يسجّلان
  // نتيجتين — الفائز الوحيد هو من ينجح بهذا التحديث
  const claimed = await prisma.member.updateMany({
    where: { id: opts.memberId, testStatus: "not_started" },
    data: {
      testScore: score,
      testStatus: passed ? "passed" : "failed",
      approvalStatus: "pending_review",
    },
  });
  if (claimed.count === 0) return null;

  await prisma.testAttempt.create({
    data: { memberId: opts.memberId, answers: opts.answers, score, passed },
  });

  const updated = await prisma.member.findUniqueOrThrow({
    where: { id: opts.memberId },
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

  const roleLabel = ROLE_LABELS[updated.invite.targetRole] ?? updated.invite.targetRole;

  if (passed) {
    await sendTestPassedEmail({
      to: updated.email,
      fullName: updated.fullName,
      score,
      roleLabel: updated.department?.name ?? roleLabel,
    });
  } else if (updated.departmentId) {
    // الرسوب ليس نهاية الطريق: يُفتح طلب اجتماع شرح للقسم، ويُبلَّغ الطرفان
    // — المرشّح ليعرف خطوته التالية، والقسم لأنه من ينفّذ الاجتماع
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

    const departmentName = updated.department?.name ?? "قسمك";
    await sendTestFailedEmail({
      to: updated.email,
      fullName: updated.fullName,
      score,
      departmentName,
      dueDate,
    });

    const owners = await prisma.user.findMany({
      where: { isActive: true, departmentId: updated.departmentId, role: "department_admin" },
      select: { email: true },
    });
    if (owners.length > 0) {
      await sendMeetingOwnerEmail({
        to: owners.map((o) => o.email),
        candidateName: updated.fullName,
        candidateEmail: updated.email,
        score,
        departmentName,
        dueDate,
      });
    }
  }

  await syncMemberLifecycleRow(updated.id);
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

  // لا تُولَّد كلمة مرور جديدة عند الاعتماد: المرشّح استلم رمزاً مؤقتاً لحظة
  // إنشاء حسابه وغيّره بنفسه قبل الاختبار، فيدخل بعد الاعتماد بنفس كلمته.
  // توليد رمز ثانٍ هنا كان يعني بيانات دخول مزدوجة لشخص واحد، وإرباكاً في
  // تسليمها يدوياً.
  if (member.invite.targetRole === "member") {
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
    const role =
      member.invite.targetRole === "executive"
        ? "executive"
        : member.invite.targetRole === "operations_officer"
          ? "operations_officer"
          : "department_admin";

    // فحص ثانٍ لحظة الإنشاء الفعلي للحساب: قد يكون المنصب شُغل بين لحظة
    // إنشاء المرشّح ولحظة اعتماده (مرشّحان قديمان، أو تنحية ثم تعيين)
    await assertRoleSeatAvailable(member.invite.targetRole, member.departmentId);

    // تُنقل كلمة المرور التي اختارها بنفسه إلى الحساب الإداري الجديد، ثم
    // يُفرَّغ hash حساب المرشّح حتى لا يبقى لشخص واحد مَدخلان
    const createdUser = await prisma.user.create({
      data: {
        fullName: member.fullName,
        email: member.email,
        passwordHash: member.passwordHash ?? (await hashPassword(generateTempPassword())),
        mustChangePassword: member.mustChangePassword,
        role,
        departmentId: role === "department_admin" ? member.departmentId : null,
      },
    });
    await prisma.member.update({
      where: { id: member.id },
      data: { passwordHash: null },
    });

    await appendApprovedMember({
      fullName: member.fullName,
      email: member.email,
      departmentName: member.department?.name ?? ROLE_LABELS[member.invite.targetRole],
      jobTitle: member.jobTitle,
      approvedAt: member.decidedAt ?? new Date(),
    });

    // الحساب الإداري الجديد يفتح صفه في تبويب الحسابات الإدارية فوراً،
    // وصف المرشّح في تبويب الأعضاء يُغلق على حالته الأخيرة
    await syncAdminAccountRow(createdUser.id);
    await syncMemberLifecycleRow(member.id);
  }

  await sendApprovedEmail({
    to: member.email,
    fullName: member.fullName,
    roleLabel: member.department?.name ?? (ROLE_LABELS[member.invite.targetRole] ?? ""),
    loginUrl: `${baseUrl()}/login`,
  });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "اعتماد نهائي",
    roleOrDepartment: await memberScope(member),
    details: "يدخل بنفس كلمة المرور التي اختارها — لم يُصدر رمز جديد",
    at: new Date(),
  });

  return { member, tempPassword: null as string | null };
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
    roleOrDepartment: await memberScope(member),
    details: "تم رفض الطلب بعد المراجعة",
    at: new Date(),
  });
  await syncMemberLifecycleRow(member.id);
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
    roleOrDepartment: await memberScope(member),
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
    roleOrDepartment: await memberScope(member),
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
    roleOrDepartment: await memberScope(member),
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
 *  يولّد كلمة مرور مؤقتة جديدة، يجبر تغييرها عند الدخول التالي، ويرسلها بالبريد،
 *  ويُسجَّل الإجراء ومن نفّذه في السجل الحي لوضوح كامل المجريات لاحقاً */
export async function resetMemberCredentials(
  memberId: string,
  newEmail?: string,
  performedByName?: string
) {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // إعادة التعيين إجراء إداري متعمّد، فهي الطريق الشرعي لإحياء حساب سقطت
  // مهلته: تُعاد المهلة من الصفر فقط لمن سقط بهذا السبب تحديداً — لا لمن
  // أُنهيت عضويته بقرار إداري.
  const current = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  const lapsedByWindow = !current.isActive && current.exitReason === CANDIDATE_EXPIRY_REASON;

  const member = await prisma.member.update({
    where: { id: memberId },
    data: {
      passwordHash,
      mustChangePassword: true,
      credentialsIssuedAt: new Date(),
      ...(newEmail ? { email: newEmail } : {}),
      ...(lapsedByWindow
        ? { isActive: true, terminatedAt: null, exitReason: null, firstLoginAt: null }
        : {}),
    },
  });

  if (lapsedByWindow) {
    await prisma.invite.update({
      where: { id: member.inviteId },
      data: { status: "used" },
    });
  }

  // الرمز المؤقت الجديد يُبطل كل محاولة فاشلة سابقة — على البريد القديم
  // والجديد معاً — وإلا سلّمنا صاحب الحساب رمزاً صحيحاً وباباً مقفلاً
  await clearFailedAttempts(current.email);
  if (member.email !== current.email) await clearFailedAttempts(member.email);

  await sendCredentialsEmail({
    to: member.email,
    fullName: member.fullName,
    tempPassword,
    loginUrl: `${baseUrl()}/login`,
  });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: lapsedByWindow ? "إعادة إصدار حساب سقطت مهلته" : "إعادة تعيين كلمة المرور",
    roleOrDepartment: await memberScope(member),
    details: performedByName ? `نفّذه: ${performedByName}` : "",
    at: new Date(),
  });

  await syncMemberLifecycleRow(member.id);

  return { member, tempPassword };
}

/** نفس الفكرة لحساب إداري (قائد قسم / تنفيذي / مسؤول تشغيل) */
export async function resetUserCredentials(
  userId: string,
  newEmail?: string,
  performedByName?: string
) {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const previous = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      ...(newEmail ? { email: newEmail } : {}),
    },
  });

  // كما في حساب العضو: لا رمز مؤقت جديد مع قفل قديم
  await clearFailedAttempts(previous.email);
  if (user.email !== previous.email) await clearFailedAttempts(user.email);

  await sendCredentialsEmail({
    to: user.email,
    fullName: user.fullName,
    tempPassword,
    loginUrl: `${baseUrl()}/login`,
  });

  await appendMemberEvent({
    fullName: user.fullName,
    email: user.email,
    event: "إعادة تعيين كلمة المرور",
    roleOrDepartment: ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role,
    details: performedByName ? `نفّذه: ${performedByName}` : "",
    at: new Date(),
  });

  await syncAdminAccountRow(user.id);

  return { user, tempPassword };
}

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  welcome_banner: "بانر ترحيبي",
  custom_design: "تصميم مخصص",
  dept_contact: "تواصل قسم",
  meeting: "اجتماع شرح",
};

/** يرسل مسؤول التشغيل تذكيراً يدوياً لأدمن القسم المستهدف بطلب لم يُنجز بعد */
export async function remindRequest(requestId: string, fromName: string) {
  const request = await prisma.request.findUniqueOrThrow({
    where: { id: requestId },
    include: { linkedMember: true },
  });
  if (request.status === "done") return;

  const admins = await prisma.user.findMany({
    where: { role: "department_admin", departmentId: request.targetDepartmentId },
  });

  await sendRequestReminderEmail({
    to: admins.map((a) => a.email),
    typeLabel: REQUEST_TYPE_LABELS[request.type] ?? request.type,
    memberName: request.linkedMember?.fullName ?? null,
    note: request.note,
    dueDate: request.dueDate,
    fromName,
  });
}

/** ينشئ حساب مرشّح كامل لحظة الدعوة: سجل الدعوة + سجل العضو + كلمة مرور
 *  مؤقتة جاهزة للتسليم. هذا عكس الترتيب القديم الذي كان يؤجل بيانات الدخول
 *  إلى ما بعد اجتياز الاختبار — فيبقى المرشّح بلا طريقة دخول، ويضطر من
 *  أنشأ الحساب لتمرير رابط مجهول بدل بريد وكلمة مرور واضحين.
 *
 *  الرمز المؤقت يُعاد مرة واحدة فقط هنا؛ لا يُخزَّن إلا مُجزّأً (hash)، فإن
 *  ضاع فالطريق الوحيد هو إعادة التعيين من صفحة إدارة الحسابات. */
export async function createCandidateAccount(opts: {
  fullName: string;
  email: string;
  phone?: string | null;
  jobTitle?: string | null;
  targetRole: "member" | "department_admin" | "operations_officer" | "executive";
  departmentId: string | null;
  testTrackId: string;
  invitedById: string;
}) {
  await assertRoleSeatAvailable(opts.targetRole, opts.departmentId);

  const existingUser = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existingUser) throw new Error("هذا البريد مستخدم بالفعل في حساب قائم");
  const existingMember = await prisma.member.findUnique({ where: { email: opts.email } });
  if (existingMember) throw new Error("هذا البريد مستخدم بالفعل في حساب قائم");

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const invite = await prisma.invite.create({
    data: {
      fullName: opts.fullName,
      email: opts.email,
      targetRole: opts.targetRole,
      departmentId: opts.departmentId,
      testTrackId: opts.testTrackId,
      invitedById: opts.invitedById,
      // لا يوجد رابط يُفتح بعد الآن — الحساب موجود منذ هذه اللحظة
      status: "used",
    },
  });

  const member = await prisma.member.create({
    data: {
      fullName: opts.fullName,
      email: opts.email,
      phone: opts.phone ?? null,
      jobTitle: opts.jobTitle ?? null,
      departmentId: opts.departmentId,
      inviteId: invite.id,
      passwordHash,
      mustChangePassword: true,
      credentialsIssuedAt: new Date(),
    },
  });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "إنشاء حساب مرشّح",
    roleOrDepartment: ROLE_LABELS[opts.targetRole],
    details: "سُلِّم رمز مؤقت — مهلة 24 ساعة لأول دخول",
    at: new Date(),
  });

  await sendCredentialsEmail({
    to: member.email,
    fullName: member.fullName,
    tempPassword,
    loginUrl: `${baseUrl()}/login`,
  });

  // الصف يُفتح في تبويب الأعضاء من هذه اللحظة، لا عند الاعتماد: المرشّح
  // الذي لم يُعتمد بعد يجب أن يكون مرئياً هو أيضاً
  await syncMemberLifecycleRow(member.id);

  return { invite, member, tempPassword };
}

/** يسجّل أول دخول فعلي للمرشّح — يتيح لمن أنشأ الحساب أن يرى هل وصل الرمز
 *  واستُخدم فعلاً أم لا، فيكتشف ضياعه أو استخدامه من غير صاحبه */
export async function markFirstLogin(memberId: string) {
  const marked = await prisma.member.updateMany({
    where: { id: memberId, firstLoginAt: null },
    data: { firstLoginAt: new Date() },
  });
  // أول دخول فقط يُحدِّث الصف — الدخول اليومي بعده لا يكتب شيئاً
  if (marked.count > 0) await syncMemberLifecycleRow(memberId);
}

/** مهلة الحساب الجديد: إن لم يدخل صاحبه خلالها يسقط الحساب نهائياً.
 *  رمز مؤقت يبقى صالحاً أسابيع هو رمز ضائع — مكتوب في محادثة أو ورقة
 *  ويصلح للاستخدام من أي أحد وصله. */
export const CANDIDATE_WINDOW_HOURS = 24;

export const CANDIDATE_EXPIRY_REASON = `انتهت مهلة ${CANDIDATE_WINDOW_HOURS} ساعة دون أول دخول`;

/** هل سقط هذا الحساب بانقضاء المهلة؟ تُحسب لحظياً من التاريخ لا من حقل
 *  محفوظ، فلا تعتمد الحماية على تشغيل أي كنس مجدول. */
export function candidateWindowExpired(member: {
  firstLoginAt: Date | null;
  credentialsIssuedAt: Date | null;
  approvalStatus: string;
}) {
  if (member.firstLoginAt) return false;
  if (member.approvalStatus === "approved") return false;
  if (!member.credentialsIssuedAt) return false;
  return Date.now() - member.credentialsIssuedAt.getTime() >= CANDIDATE_WINDOW_HOURS * 3600_000;
}

/** الوقت المتبقي بالساعات قبل سقوط الحساب (سالب = سقط) */
export function candidateHoursLeft(credentialsIssuedAt: Date) {
  const msLeft = credentialsIssuedAt.getTime() + CANDIDATE_WINDOW_HOURS * 3600_000 - Date.now();
  return Math.ceil(msLeft / 3600_000);
}

/** يُسقط كل حساب مرشّح انقضت مهلته دون أول دخول.
 *
 *  لا يُحذف الصف: الحوكمة تعني القدرة على إثبات أن حساباً صدر ولمن ومتى
 *  وأنه انتهى دون استخدام — وحذف السجل يمحو هذا الإثبات. فيُعطَّل الحساب
 *  نهائياً (لا يقبل دخولاً)، وتُعلَّم دعوته "منتهية"، ويخرج من القوائم
 *  العاملة، ويُسجَّل الحدث في السجل الحي. */
export async function sweepExpiredCandidateAccounts() {
  const cutoff = new Date(Date.now() - CANDIDATE_WINDOW_HOURS * 3600_000);

  const expired = await prisma.member.findMany({
    where: {
      firstLoginAt: null,
      isActive: true,
      approvalStatus: { not: "approved" },
      credentialsIssuedAt: { not: null, lte: cutoff },
    },
    select: { id: true, fullName: true, email: true, inviteId: true },
  });
  if (expired.length === 0) return 0;

  await prisma.member.updateMany({
    where: { id: { in: expired.map((m) => m.id) } },
    data: { isActive: false, terminatedAt: new Date(), exitReason: CANDIDATE_EXPIRY_REASON },
  });
  await prisma.invite.updateMany({
    where: { id: { in: expired.map((m) => m.inviteId) } },
    data: { status: "expired" },
  });

  for (const m of expired) {
    await appendMemberEvent({
      fullName: m.fullName,
      email: m.email,
      event: "إسقاط حساب مرشّح",
      details: CANDIDATE_EXPIRY_REASON,
      at: new Date(),
    });
  }

  return expired.length;
}

/** المناصب الفردية: لا يصح أن يوجد مديران تنفيذيان، ولا مسؤولا تشغيل،
 *  ولا قائدان لقسم واحد. الصلاحية في هذه المناصب تعني قراراً نهائياً،
 *  وازدواجها يعني تضارب قرارات وغموضاً في المسؤولية. */
const SINGLETON_ROLES = ["executive", "operations_officer", "department_admin"] as const;

type SingletonRole = (typeof SINGLETON_ROLES)[number];

export function isSingletonRole(role: string): role is SingletonRole {
  return (SINGLETON_ROLES as readonly string[]).includes(role);
}

/** من يشغل المنصب الآن — سواء حساب قائم فعلاً، أو مرشّح لم يُحسم أمره بعد.
 *  المرشّح المعلّق يُحتسب شاغلاً: لو سُمح بمرشّح ثانٍ لاجتاز كلاهما الاختبار
 *  ثم تعذّر اعتماد أحدهما، وهذا إهدار لوقت شخص حقيقي. */
export async function findRoleSeatHolder(
  targetRole: string,
  departmentId: string | null
): Promise<{ fullName: string; email: string; kind: "active" | "candidate" } | null> {
  if (!isSingletonRole(targetRole)) return null;

  const user = await prisma.user.findFirst({
    where: {
      role: targetRole,
      isActive: true,
      ...(targetRole === "department_admin" ? { departmentId } : {}),
    },
    select: { fullName: true, email: true },
  });
  if (user) return { ...user, kind: "active" };

  const candidate = await prisma.member.findFirst({
    where: {
      isActive: true,
      approvalStatus: "pending_review",
      invite: {
        targetRole,
        ...(targetRole === "department_admin" ? { departmentId } : {}),
      },
    },
    select: { fullName: true, email: true },
  });
  if (candidate) return { ...candidate, kind: "candidate" };

  return null;
}

/** يرفض إنشاء أو اعتماد حساب لمنصب مشغول، برسالة تسمّي شاغله وتدل على
 *  طريق التفريغ — فلا يقف المستخدم أمام رفض بلا مخرج. */
export async function assertRoleSeatAvailable(targetRole: string, departmentId: string | null) {
  const holder = await findRoleSeatHolder(targetRole, departmentId);
  if (!holder) return;

  const label = ROLE_LABELS[targetRole as keyof typeof ROLE_LABELS] ?? targetRole;
  throw new Error(
    holder.kind === "active"
      ? `منصب ${label} مشغول حالياً بـ${holder.fullName}. نحِّ الحساب القائم أولاً من إدارة الحسابات، ثم أنشئ البديل.`
      : `يوجد مرشّح لمنصب ${label} لم يُحسم أمره بعد (${holder.fullName}). اعتمده أو ارفضه أولاً.`
  );
}

/** تنحية حساب قيادي: تُعطّله وتُفرِغ منصبه لمن بعده، دون حذف سجله.
 *  الفاونڈر وحده يملكها، ولا تطال حساب فاونڈر آخر ولا حسابه هو. */
export async function removeLeadershipUser(opts: {
  userId: string;
  reason: string;
  performedById: string;
  performedByName: string;
}) {
  const target = await prisma.user.findUniqueOrThrow({ where: { id: opts.userId } });
  if (target.id === opts.performedById) throw new Error("لا يمكنك تنحية حسابك أنت");
  if (target.role === "super_admin") throw new Error("لا يمكن تنحية حساب الفاونڈر");
  if (!target.isActive) throw new Error("هذا الحساب مُنحّى بالفعل");

  const user = await prisma.user.update({
    where: { id: opts.userId },
    data: { isActive: false, removedAt: new Date(), removalReason: opts.reason },
  });

  await appendMemberEvent({
    fullName: user.fullName,
    email: user.email,
    event: "تنحية حساب قيادي",
    roleOrDepartment: ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role,
    details: `السبب: ${opts.reason} — نفّذه: ${opts.performedByName}`,
    at: new Date(),
  });

  await syncAdminAccountRow(user.id);

  return user;
}


/** يُذكّر من أُنشئ له حساب ولم يدخل بعد، قبل سقوط مهلته.
 *
 *  يُستدعى من الكنس اليومي. العلامة أن التذكير أُرسل هي firstLoginAt الفارغ
 *  مع اقتراب المهلة — ولتفادي تكرار التذكير في اليوم نفسه، يُرسَل فقط لمن
 *  بقي له 12 ساعة أو أقل، وهي نافذة لا يمرّ بها الحساب إلا مرة واحدة ما
 *  دام الكنس يومياً. */
export async function remindExpiringCandidates() {
  const now = Date.now();
  const windowMs = CANDIDATE_WINDOW_HOURS * 3600_000;

  const pending = await prisma.member.findMany({
    where: {
      firstLoginAt: null,
      isActive: true,
      approvalStatus: { not: "approved" },
      credentialsIssuedAt: { not: null },
    },
    select: { fullName: true, email: true, credentialsIssuedAt: true },
  });

  let sent = 0;
  for (const m of pending) {
    const msLeft = m.credentialsIssuedAt!.getTime() + windowMs - now;
    const hoursLeft = Math.ceil(msLeft / 3600_000);
    if (hoursLeft <= 0 || hoursLeft > 12) continue;

    await sendWindowReminderEmail({
      to: m.email,
      fullName: m.fullName,
      hoursLeft,
      loginUrl: `${baseUrl()}/login`,
    });
    sent++;
  }
  return sent;
}
