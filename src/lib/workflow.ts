import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { approverFor } from "@/lib/notify";
import { singleRecipient } from "@/lib/emailPolicy";
import { isSigningRole } from "@/lib/signatures";
import { clearFailedAttempts } from "@/lib/loginAttempts";
import { shareCardUrl } from "@/lib/bannerToken";
import { appendApprovedMember, appendMemberEvent, appendTestResult, upsertMemberLifecycleRow, upsertAdminAccountRow } from "@/lib/googleSheets";
import {
  sendCredentialsEmail,
  sendAwaitingApprovalEmail,
  sendTestFailedEmail,
  sendMeetingOwnerEmail,
  sendWindowReminderEmail,
  sendWarningEmail,
  sendExitEmail,
  sendRequestReminderEmail,
  sendTestReopenedEmail,
  sendTotpNudgeEmail,
} from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { generateTempPassword, hashPassword } from "@/lib/credentials";
import { scoreAnswers, ROLE_LABELS, accountRoleLabel } from "@/lib/testTracks";
import { retireMarketingProfile } from "@/lib/marketing/team";


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
export async function syncMemberLifecycleRow(
  memberId: string,
  /** شاهدةٌ تُكتب في عمود المرحلة بدل المحسوب — للحذف النهائي.
   *
   *  الصفّ يبقى في الشيت بعد زوال صاحبه من القاعدة، فلا يُقرأ عضواً
   *  قائماً: يُعلَن عليه أنه حُذف نهائياً ومتى وبيد من. ولو تُرك على
   *  مرحلته الأخيرة لبقي في السجل كأنه ما يزال في الفريق. */
  tombstone?: string
) {
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
    // المحذوف نهائياً لا يُقيَّد بريدُه في الصفّ الباقي: السجل يُحفظ
    // ليُقرأ تاريخاً، والبريد يتحرّر ليُدعى صاحبه من جديد بنفس بياناته.
    email: tombstone ? "— (حُرِّر البريد لإعادة الدعوة)" : member.email,
    departmentName: member.department?.name ?? "—",
    roleLabel: ROLE_LABELS[member.invite.targetRole] ?? member.invite.targetRole,
    stage: tombstone ?? memberStage(member),
    specialization: member.specialization,
    section: member.section,
    profileCompletedAt: member.profileCompletedAt,
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
    welcomeEmailSentAt: member.welcomeEmailSentAt,
    welcomeEmailCount: member.welcomeEmailCount,
    stepDownAt: member.stepDownAt,
    stepDownByName: member.stepDownByName,
    endDate: member.endDate,
    farewellDesignAt: member.farewellDesignAt,
    offboardingClosedAt: member.offboardingClosedAt,
  });

  if (!member.sheetRow && result.sheetRow) {
    await prisma.member.update({ where: { id: member.id }, data: { sheetRow: result.sheetRow } });
  }
}

/** نظير دالة الأعضاء للحسابات الإدارية — صف ثابت واحد لكل حساب، يُحدَّث عند
 *  إنشائه، أو تغيير كلمة مروره، أو تفعيل التحقق بخطوتين، أو تنحيته */
export async function syncAdminAccountRow(
  userId: string,
  /** شاهدةُ حذفٍ نهائي: الصفّ يبقى والبريد لا يُقيَّد فيه */
  tombstone?: string
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { department: true },
  });

  const result = await upsertAdminAccountRow({
    sheetRow: user.sheetRow,
    fullName: user.fullName,
    email: tombstone ? "— (حُرِّر البريد لإعادة الدعوة)" : user.email,
    removalReason: tombstone ?? user.removalReason,
    roleLabel: accountRoleLabel(user.role),
    departmentName: user.department?.name ?? null,
    phone: user.phone,
    jobTitle: user.jobTitle,
    specialization: user.specialization,
    section: user.section,
    profileCompletedAt: user.profileCompletedAt,
    totpEnabled: user.totpEnabled,
    isActive: user.isActive,
    createdAt: user.createdAt,
    passwordChangedAt: user.passwordChangedAt,
    removedAt: user.removedAt,
    welcomeEmailSentAt: user.welcomeEmailSentAt,
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
    // المسارُ يُسمّى بمنصبه: مرشّحُ المتابعة والتشغيل ليس «قيادة قسم»
    track: updated.department?.name ?? ROLE_LABELS[updated.invite.targetRole],
    score,
    passed,
    at: new Date(),
  });

  const roleLabel = ROLE_LABELS[updated.invite.targetRole] ?? updated.invite.targetRole;

  if (passed) {
    // **لا بريد للمرشّح هنا.** كان يصله «اجتزتَ الاختبار» وهو يقرأ
    // نتيجته على الشاشة في اللحظة نفسها، ثم ينتظر الاعتماد بلا خبر —
    // فيُراسَل مرّتين (نتيجة ثم اعتماد) وإحداهما تُخبره بما يعلم.
    // والخبر الحقيقي هو الاعتماد، وله بطاقة الانضمام.
    //
    // والبريد الذي كان **ناقصاً** هو هذا: من يملك الاعتماد لا يعلم أن
    // طلباً ينتظره. فصار يُخبَر هو — وحده — ليفعل ما لا يفعله غيره.
    // وواحدٌ منهم لا كلُّهم: الاعتماد فعلٌ يقع مرّةً، وثلاثُ نسخٍ منه
    // ثلاثُ رسائل في خبرٍ واحد
    const approver = await approverFor(updated.departmentId);
    const approverTo = singleRecipient(approver.to);
    if (approverTo.length > 0) {
      await sendAwaitingApprovalEmail({
        to: approverTo,
        candidateName: updated.fullName,
        candidateEmail: updated.email,
        score,
        scopeLabel: updated.department?.name ?? roleLabel,
        portalUrl: `${baseUrl()}/admin`,
      });
    }
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
  const candidate = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    include: { department: true, invite: true },
  });

  // المرشّحُ القياديُّ: يُعتمد ويُنشأ حسابُه الإداريُّ معاً أو لا يقع شيء —
  // انظر `provisionLeadershipAccount`
  if (candidate.invite.targetRole !== "member") {
    const { member, userId } = await provisionLeadershipAccount(candidate, { approve: true });
    await finishLeadershipPromotion(member, userId, "اعتماد نهائي");
    return { member, tempPassword: null as string | null };
  }

  const member = await prisma.member.update({
    where: { id: memberId },
    data: { approvalStatus: "approved", decidedAt: new Date() },
    include: { department: true, invite: true },
  });

  // لا تُولَّد كلمة مرور جديدة عند الاعتماد: المرشّح استلم رمزاً مؤقتاً لحظة
  // إنشاء حسابه وغيّره بنفسه قبل الاختبار، فيدخل بعد الاعتماد بنفس كلمته.
  // توليد رمز ثانٍ هنا كان يعني بيانات دخول مزدوجة لشخص واحد، وإرباكاً في
  // تسليمها يدوياً.
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

  await announceApproval(member, { kind: "member", id: member.id }, "اعتماد نهائي");
  return { member, tempPassword: null as string | null };
}

type CandidateRecord = Prisma.MemberGetPayload<{ include: { department: true; invite: true } }>;

/** المنصبُ الإداريُّ الذي يُمنَحه المرشّح القيادي */
function leadershipRoleFor(targetRole: string): "executive" | "operations_officer" | "department_admin" {
  return targetRole === "executive"
    ? "executive"
    : targetRole === "operations_officer"
      ? "operations_officer"
      : "department_admin";
}

/** يُنشئ الحسابَ الإداريَّ لمرشّحٍ قياديّ — **مع اعتماده في معاملةٍ واحدة، أو لا شيء.**
 *
 *  **العطبُ الذي يُصلحه، وهو حادثةُ قائدة التسويق:** كان الاعتمادُ يُكتب أولاً
 *  (`approvalStatus = approved`) ثم يُفحص المنصب ويُنشأ الحساب. فإن تعثّر ما بعده —
 *  منصبٌ يُرى مشغولاً، أو بريدٌ له حسابٌ إداريٌّ قديم، أو انقطاعُ التنفيذ — بقي
 *  المرشّحُ «معتمَداً» بلا حسابٍ إداري وبكلمة مروره هو. فيدخل من باب العضو:
 *  «عضو» في القائمة، وبوابةُ الأعضاء، ولا شيءَ من أدوات القيادة. ويخرج من قائمة
 *  الاعتماد (لم يعد «بانتظار») فلا يراه أحدٌ ليعيد المحاولة.
 *
 *  فصار الترتيب: فحصُ المنصب قبل أي كتابة (والمرشّحُ نفسُه لا يُعدّ شاغلاً له)، ثم
 *  الاعتمادُ وإنشاءُ الحساب ونقلُ كلمة المرور في معاملةٍ واحدة. فإن رُفض شيءٌ بقي
 *  المرشّحُ في قائمته كما كان، وظهر سببُ الرفض لمن يعتمد.
 *
 *  و`approve: false` لإكمال اعتمادٍ سابقٍ تعثّر قبل هذا الإصلاح
 *  (`completeLeadershipPromotion`) — الاعتمادُ مكتوبٌ من قبل، والناقصُ الحساب. */
async function provisionLeadershipAccount(
  candidate: CandidateRecord,
  opts: { approve: boolean }
): Promise<{ member: CandidateRecord; userId: string }> {
  const role = leadershipRoleFor(candidate.invite.targetRole);

  // قد يكون المنصب شُغل بين لحظة إنشاء المرشّح ولحظة اعتماده (مرشّحان قديمان،
  // أو تنحية ثم تعيين) — فيُفحص الآن، قبل أن يُكتب شيء
  await assertRoleSeatAvailable(candidate.invite.targetRole, candidate.departmentId, candidate.id);

  // تُنقل كلمة المرور التي اختارها بنفسه إلى الحساب الإداري الجديد، ثم
  // يُفرَّغ hash حساب المرشّح حتى لا يبقى لشخص واحد مَدخلان.
  const passwordHash = candidate.passwordHash ?? (await hashPassword(generateTempPassword()));
  const decidedAt = new Date();

  return prisma.$transaction(async (tx) => {
    if (opts.approve) {
      // اعتمادان متزامنان لمرشّحٍ واحد: يمضي أحدهما، ويُردّ الثاني بسببه
      const claimed = await tx.member.updateMany({
        where: { id: candidate.id, approvalStatus: { not: "approved" } },
        data: { approvalStatus: "approved", decidedAt },
      });
      if (claimed.count === 0) throw new Error("حُسم أمرُ هذا المرشّح من قبل");
    }

    // وتُنقل معها بياناته كلها — المسمى الذي حدّدته الإدارة الداعية،
    // وجواله وتخصصه وشعبته وتاريخ استكمالها. كانت تُترك خلفه فيُولَد
    // الحساب الإداري فارغاً، فتظهر بطاقة انضمامه بلا مهمة ولا فريق،
    // ويُطالَب باستكمال بيانات استكملها قبل اختباره.
    const user = await tx.user.create({
      data: {
        fullName: candidate.fullName,
        email: candidate.email,
        passwordHash,
        mustChangePassword: candidate.mustChangePassword,
        role,
        departmentId: role === "department_admin" ? candidate.departmentId : null,
        phone: candidate.phone,
        jobTitle: candidate.jobTitle,
        gender: candidate.gender,
        specialization: candidate.specialization,
        section: candidate.section,
        profileCompletedAt: candidate.profileCompletedAt,
      },
      select: { id: true },
    });
    const member = await tx.member.update({
      where: { id: candidate.id },
      data: { passwordHash: null },
      include: { department: true, invite: true },
    });
    return { member, userId: user.id };
  });
}

/** ما يلي إنشاءَ الحساب القيادي: الشيت، وطلبُ التوقيع، وبطاقةُ الانضمام، والسجلّ.
 *  لا يقع إلا بعد أن تُثبَّت المعاملة — فلا يُعلَن عن حسابٍ لم يُنشأ. */
async function finishLeadershipPromotion(member: CandidateRecord, userId: string, event: string) {
  const role = leadershipRoleFor(member.invite.targetRole);
  await appendApprovedMember({
    fullName: member.fullName,
    email: member.email,
    departmentName: member.department?.name ?? ROLE_LABELS[member.invite.targetRole],
    jobTitle: member.jobTitle,
    approvedAt: member.decidedAt ?? new Date(),
  });

  // الحساب الإداري الجديد يفتح صفه في تبويب الحسابات الإدارية فوراً،
  // وصف المرشّح في تبويب الأعضاء يُغلق على حالته الأخيرة
  await syncAdminAccountRow(userId);
  await syncMemberLifecycleRow(member.id);

  // قائدٌ جديد يُطلب توقيعه فوراً: الشهادات تصدر باسمه، ولا يُستعار
  // توقيع من سبقه. والطلب هنا لا عند أول شهادة — حتى لا يُكتشَف
  // النقص يوم الحاجة.
  if (isSigningRole(role)) {
    const { requestSignature } = await import("@/lib/signatures");
    await requestSignature({
      userId,
      reason: `تكليف جديد: ${accountRoleLabel(role)}`,
    });
  }

  // من رُقِّي إلى حساب إداري تُكتب بطاقته على حسابه الجديد لا على صفّ
  // المرشّح: صفحته هي التي يقرأ فيها «وصلتك بتاريخ كذا»
  await announceApproval(member, { kind: "user", id: userId }, event);
}

/** رسالة واحدة تُعلن الاعتماد وتُرحّب وتحمل عدّة المشاركة. كانت ثلاثاً
 *  تصل متتابعة في دقائق عن حدثٍ واحد — تُقرأ أولاها ويُهمل الباقي.
 *  والاستيراد داخل الدالة لأن `welcome` يستورد من هذا الملف،
 *  واستيرادهما المتبادل في الأعلى يُدوّر الاعتماد. */
async function announceApproval(
  member: CandidateRecord,
  account: { kind: "user" | "member"; id: string },
  event: string
) {
  const { sendWelcomePack } = await import("@/lib/welcome");
  const welcomed = await sendWelcomePack(account, "approved");

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event,
    roleOrDepartment: await memberScope(member),
    details:
      "يدخل بنفس كلمة المرور التي اختارها — لم يُصدر رمز جديد" +
      (welcomed.ok ? " — وصلته بطاقة الانضمام" : " — تعذّر إرسال بطاقة الانضمام"),
    at: new Date(),
  });
}

/** اعتماداتٌ قياديةٌ تعثّرت قبل أن يصير الاعتمادُ والحسابُ معاملةً واحدة: ترشّحٌ قياديٌّ
 *  معتمَدٌ نشط، كلمةُ مروره ما تزال على سجلّه (لم تُنقل)، ولا حسابَ إداريَّ بالبريد نفسه.
 *
 *  صاحبُه يدخل عضواً منذ اعتماده — وهذه القائمة هي ما يراه من يملك إكمال اعتماده.
 *  ولا تدخل فيها بقيةُ حسابٍ حُذف (كلمتُه فارغة — `leftoverLeaderIds`). */
export async function halfApprovedLeaders() {
  const rows = await prisma.member.findMany({
    omit: { avatarData: true },
    where: {
      approvalStatus: "approved",
      isActive: true,
      terminatedAt: null,
      passwordHash: { not: null },
      invite: { targetRole: { not: "member" } },
    },
    include: { department: true, invite: true },
    orderBy: { decidedAt: "asc" },
    take: QUEUE_TAKE,
  });
  if (rows.length === 0) return [];
  const held = new Set(
    (await prisma.user.findMany({ where: { email: { in: rows.map((r) => r.email) } }, select: { email: true } })).map((u) => u.email)
  );
  return rows.filter((r) => !held.has(r.email));
}

/** يُكمل اعتماداً قيادياً تعثّر (`halfApprovedLeaders`): يُنشئ الحسابَ الإداريَّ الذي
 *  قُرِّر ولم يُنشأ، بالشروط نفسها — المنصبُ شاغر، ولا حسابَ آخر بالبريد.
 *
 *  لا يُنشئ ترشّحاً ولا حساباً ثانياً: إن كان الحسابُ الإداريُّ قائماً عاد بلا تغيير.
 *  ومن يملكه هو من يملك اعتمادَ ذلك المنصب (`canDecideCandidate` في الإجراء). */
export async function completeLeadershipPromotion(memberId: string, performedByName?: string) {
  const candidate = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    include: { department: true, invite: true },
  });
  if (candidate.invite.targetRole === "member") throw new Error("هذا سجلُّ عضوية، لا ترشّحٌ لمنصب قيادي");
  if (candidate.approvalStatus !== "approved") throw new Error("لم يُعتمد بعد — يُعتمد من قائمة «بانتظار اعتماد القيادة»");
  if (!candidate.isActive || candidate.terminatedAt) throw new Error("هذا الحساب متوقف — لا يُكمَل اعتماده");

  const existing = await prisma.user.findUnique({ where: { email: candidate.email }, select: { id: true, isActive: true } });
  if (existing?.isActive) return { userId: existing.id, created: false as const };
  if (existing) throw new Error("لهذا البريد حسابٌ إداريٌّ مُنحّى — لا يُنشأ له حسابٌ ثانٍ");
  // كلمةٌ فارغة بلا حسابٍ إداري: بقيةُ حسابٍ حُذف (`leftoverLeaderIds`) — لا يُبعث
  if (!candidate.passwordHash) throw new Error("هذا سجلُّ حسابٍ حُذف — يُدعى صاحبُه من جديد");

  const { member, userId } = await provisionLeadershipAccount(candidate, { approve: false });
  await finishLeadershipPromotion(
    member,
    userId,
    performedByName ? `إكمال اعتماد قيادي تعثّر — نفّذه: ${performedByName}` : "إكمال اعتماد قيادي تعثّر"
  );
  return { userId, created: true as const };
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

/** إصدار شهادة إتمام لعضو — عملية يدوية يقررها الأدمن.
 *
 *  ولا تُصدرها بنفسها: كان هنا مسارٌ ثانٍ يختم `certificateIssuedAt`
 *  ويُرسل بريداً خاصاً به، إلى جانب مسار التنحي. ومسارانِ يختمان الختم
 *  نفسه يعنيان شهادتين لمسيرةٍ واحدة — ورسالتين بنصّين مختلفين. فصار
 *  الإصدار في موضع واحد (`markCertificateShared`) وهذا بابٌ إليه. */
export async function issueCertificate(memberId: string) {
  const { markCertificateShared } = await import("@/lib/offboarding");
  return markCertificateShared(memberId, "إصدار يدوي من الإدارة");
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
    // إعادة تعيين لا دعوة: لا تُهنّئ عضواً قديماً على انضمامٍ جرى قبل سنة
    occasion: "reset",
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
    roleOrDepartment: accountRoleLabel(user.role),
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
    select: { email: true },
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

  // لا يُدعى أحدٌ إلى ما لم يُعتمد: طلبُ قسمٍ ينتظر المؤسس، أو لجنةٌ مقترحة —
  // كلاهما ليس قسماً بعد. والقوائمُ تحجبهما، وهذا الحرسُ لمن تجاوز القائمة
  if (opts.departmentId) {
    const open = await prisma.department.findFirst({
      where: { id: opts.departmentId, ...OPEN_DEPARTMENT_WHERE },
      select: { id: true },
    });
    if (!open) throw new Error("هذا القسم لم يُعتمد بعد — لا يُدعى إليه أحدٌ قبل اعتماده");
  }

  const existingUser = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existingUser) throw new Error("هذا البريد مستخدم بالفعل في حساب قائم");
  const existingMember = await prisma.member.findUnique({ where: { email: opts.email } });
  if (existingMember) throw new Error("هذا البريد مستخدم بالفعل في حساب قائم");

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // اسم القسم يُقرأ من المعرّف: الدعوة تذكر لمن دُعي، لا معرّفاً مُبهماً
  const department = opts.departmentId
    ? await prisma.department.findUnique({ where: { id: opts.departmentId } })
    : null;

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

  // من دعاه يُذكَر باسمه: «دعاك فلان» أوضح من «دعتك الإدارة»، وهو ما
  // يجعل الدعوة إعلاناً شخصياً لا رسالةً آلية
  const inviter = await prisma.user.findUnique({
    where: { id: opts.invitedById },
    select: { fullName: true },
  });
  const invited = await sendCredentialsEmail({
    to: member.email,
    fullName: member.fullName,
    tempPassword,
    loginUrl: `${baseUrl()}/login`,
    targetRole: opts.targetRole,
    invitedByName: inviter?.fullName ?? null,
    departmentColorHex: department?.colorHex ?? null,
    inviteCardUrl: shareCardUrl("invite", { kind: "member", id: member.id }, baseUrl()),
    // الدعوة تقول إنها دعوة: القسم والمسمّى كما سجّلتهما الإدارة،
    // والخطوات، والمهلة — لا «تهانينا، تم اعتماد انضمامك».
    occasion: "invitation",
    departmentName: department?.name ?? null,
    jobTitle: opts.jobTitle ?? null,
    roleLabel: ROLE_LABELS[opts.targetRole],
    hoursValid: CANDIDATE_WINDOW_HOURS,
  });

  // يُسجَّل وصولُ البريد لا إرسالُه: `skipped` تعني أنه لم يصل — إمّا
  // لأن البريد معطّل أو لأن Resend رفضه. والفرق بين «وصلت ولم يفتحها»
  // و«لم تصل» هو الفرق بين الانتظار والإعادة، فلا يُخمَّن.
  await prisma.invite.update({
    where: { id: invite.id },
    data: {
      emailAttempts: { increment: 1 },
      ...(invited.skipped ? {} : { emailSentAt: new Date() }),
    },
  });
  if (invited.skipped) {
    await appendMemberEvent({
      fullName: member.fullName,
      email: member.email,
      event: "تعذّر تسليم الدعوة",
      roleOrDepartment: department?.name ?? ROLE_LABELS[opts.targetRole],
      details: "أُنشئ الحساب ولم يصل بريد الدعوة — تُعاد بإعادة تعيين بياناته، ولا تُنشأ دعوة ثانية",
      at: new Date(),
    });
  }

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
  departmentId: string | null,
  /** المرشّحُ الذي يُعتمَد الآن — لا يُعدّ شاغلاً للمنصب الذي يُمنَحه */
  excludeMemberId?: string
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
      ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
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
export async function assertRoleSeatAvailable(targetRole: string, departmentId: string | null, excludeMemberId?: string) {
  const holder = await findRoleSeatHolder(targetRole, departmentId, excludeMemberId);
  if (!holder) return;

  const label = ROLE_LABELS[targetRole as keyof typeof ROLE_LABELS] ?? targetRole;
  throw new Error(
    holder.kind === "active"
      ? `منصب ${label} مشغول حالياً بـ${holder.fullName}. نحِّ الحساب القائم أولاً من إدارة الحسابات، ثم أنشئ البديل.`
      : `يوجد مرشّح لمنصب ${label} لم يُحسم أمره بعد (${holder.fullName}). اعتمده أو ارفضه أولاً.`
  );
}

/** تنحية حساب قيادي: تُعطّله وتُفرِغ منصبه لمن بعده، دون حذف سجله.
 *  المؤسس وحده يملكها، ولا تطال حساب فاوندر آخر ولا حسابه هو. */
export async function removeLeadershipUser(opts: {
  userId: string;
  reason: string;
  performedById: string;
  performedByName: string;
}) {
  const target = await prisma.user.findUniqueOrThrow({ where: { id: opts.userId } });
  if (target.id === opts.performedById) throw new Error("لا يمكنك تنحية حسابك أنت");
  if (target.role === "super_admin") throw new Error("لا يمكن تنحية حساب المؤسس");
  if (!target.isActive) throw new Error("هذا الحساب مُنحّى بالفعل");

  const user = await prisma.user.update({
    where: { id: opts.userId },
    data: { isActive: false, removedAt: new Date(), removalReason: opts.reason },
  });

  // توقيعه يبطل مع منصبه: لا يُرسَم على شهادةٍ بعد اليوم، والصادر
  // يبقى صحيحاً بتاريخه. ولا يُورَّث لخَلَفِه — الوراثة انتحال.
  const { supersedeSignatures } = await import("@/lib/signatures");
  await supersedeSignatures(user.id, `تنحية عن ${accountRoleLabel(user.role)}`);

  // والعملُ المعلَّق باسمه ينتقل إلى خَلَفِه: المُنحّى لا يَفتح المنصة،
  // فطلبُ اعتمادٍ ينتظره وتذكرةٌ وُجِّهت إليه يبقيان في بريدٍ مغلق.
  // أما المنصب فلا يُنقَل — الهيكل يُحسَب، فمن عُيِّن بعده ورث قادته
  // وأقسامه وأعضاءه في القراءة التالية بلا إجراء.
  const { handOver } = await import("@/lib/succession");
  const handover = await handOver({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    },
    byName: opts.performedByName,
    occasion: "تنحية",
  });

  await appendMemberEvent({
    fullName: user.fullName,
    email: user.email,
    event: "تنحية حساب قيادي",
    roleOrDepartment: accountRoleLabel(user.role),
    details: `السبب: ${opts.reason} — نفّذه: ${opts.performedByName}. ${handover.summary}`,
    at: new Date(),
  });

  await syncAdminAccountRow(user.id);

  return { ...user, handover: handover.summary };
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

/** يعيد فتح اختبار القبول لمرشّح لم يجتزه.
 *
 *  لا يُعاد الفتح بضغطة مجرّدة: الرسوب قرار مُسجَّل، ونقضُه يحتاج سبباً
 *  مكتوباً — اجتماع الشرح. فيُطلب تأكيد انعقاده وتُحفظ ملاحظته، ويُحسب
 *  عدد مرات الإعادة حتى لا تتحوّل الاستثناءات إلى قاعدة صامتة.
 *
 *  وتُعاد مهلة الـ24 ساعة من الآن: الرمز القديم مضى زمنه. */
export async function reopenCandidateTest(opts: {
  memberId: string;
  meetingHeld: boolean;
  note?: string;
  performedByName: string;
}) {
  if (!opts.meetingHeld) {
    throw new Error("لا يُعاد فتح الاختبار قبل تأكيد انعقاد اجتماع الشرح");
  }

  const current = await prisma.member.findUniqueOrThrow({
    where: { id: opts.memberId },
    include: { department: true, invite: true },
  });

  if (current.approvalStatus === "approved") {
    throw new Error("هذا الحساب معتمد بالفعل — لا اختبار يُعاد له");
  }
  if (current.testStatus === "not_started") {
    throw new Error("الاختبار مفتوح أصلاً ولم يُسلَّم بعد");
  }

  const member = await prisma.member.update({
    where: { id: opts.memberId },
    data: {
      testStatus: "not_started",
      testScore: null,
      approvalStatus: "pending_review",
      decidedAt: null,
      isActive: true,
      terminatedAt: null,
      exitReason: null,
      firstLoginAt: null,
      credentialsIssuedAt: new Date(),
      testReopenCount: { increment: 1 },
      testReopenedAt: new Date(),
      testReopenNote: opts.note?.trim() || "أُعيد الفتح بعد اجتماع الشرح",
    },
    include: { department: true, invite: true },
  });

  // الدعوة تعود صالحة أيضاً، وإلا بقي الحساب مفتوحاً ودعوته منتهية
  await prisma.invite.update({ where: { id: member.inviteId }, data: { status: "used" } });

  await sendTestReopenedEmail({
    to: member.email,
    fullName: member.fullName,
    roleLabel: member.department?.name ?? (ROLE_LABELS[member.invite.targetRole] ?? ""),
    loginUrl: `${baseUrl()}/login`,
    hoursValid: CANDIDATE_WINDOW_HOURS,
  });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    roleOrDepartment: await memberScope(member),
    event: "إعادة فتح الاختبار",
    details: `المحاولة رقم ${member.testReopenCount + 1} — ${member.testReopenNote} — نفّذه: ${opts.performedByName}`,
    at: new Date(),
  });

  await syncMemberLifecycleRow(member.id);
  return member;
}

/** حذف نهائي لمرشّح عالق — الملاذ الأخير.
 *
 *  المنصة لا تحذف شيئاً عادةً: الحوكمة تعني إثبات أن حساباً صدر ولمن
 *  ومتى وكيف انتهى. لكن قيد البريد الفريد يعني أن مرشّحاً راسباً أو
 *  عالقاً يحجز بريده إلى الأبد، فلا يُدعى صاحبه مرة أخرى.
 *
 *  فالحلّ: يُكتب السجل كاملاً في الشيت أولاً — وهو السجل الدائم — ثم
 *  يُحذف الصف من القاعدة. لا شيء يضيع، والبريد يتحرّر.
 *
 *  ويُشترط كتابة البريد كاملاً: الحذف لا يقع بنقرة في المكان الخطأ. */
export async function purgeCandidate(opts: {
  memberId: string;
  confirmEmail: string;
  reason: string;
  performedByName: string;
}) {
  const member = await prisma.member.findUniqueOrThrow({
    where: { id: opts.memberId },
    include: { department: true, invite: true, warnings: true },
  });

  if (opts.confirmEmail.trim().toLowerCase() !== member.email.toLowerCase()) {
    throw new Error("البريد المكتوب لا يطابق بريد الحساب — لم يُحذف شيء");
  }
  if (member.approvalStatus === "approved" && member.isActive) {
    throw new Error("هذا عضو معتمد نشط — أنهِ عضويته أولاً، فالحذف ليس طريق الاستبعاد");
  }

  const scope = await memberScope(member);

  // السجل يُختم في الشيت قبل الحذف لا بعده: بعد الحذف لا يبقى ما يُكتب
  await syncMemberLifecycleRow(member.id);
  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    roleOrDepartment: scope,
    event: "حذف نهائي من قاعدة البيانات",
    details:
      `السبب: ${opts.reason} — التنبيهات: ${member.warningsCount} — ` +
      `نتيجة الاختبار: ${member.testScore === null ? "لم يختبر" : `${member.testScore}%`} — ` +
      `نفّذه: ${opts.performedByName}. السجل محفوظ هنا والبريد تحرّر لدعوة جديدة.`,
    at: new Date(),
  });

  // التذاكر لا تُحذف: هي سجل عمل يخص أطرافاً أخرى، فيُفكّ ارتباطها فقط
  await prisma.ticket.updateMany({ where: { memberId: member.id }, data: { memberId: null } });
  await prisma.ticket.updateMany({
    where: { targetMemberId: member.id },
    data: { targetMemberId: null },
  });
  await prisma.request.updateMany({
    where: { linkedMemberId: member.id },
    data: { linkedMemberId: null },
  });
  await prisma.testAttempt.deleteMany({ where: { memberId: member.id } });
  await prisma.memberWarning.deleteMany({ where: { memberId: member.id } });
  await retireMarketingProfile(prisma, { memberId: member.id }, member.fullName);
  await prisma.member.delete({ where: { id: member.id } });
  await prisma.invite.delete({ where: { id: member.inviteId } });

  return { email: member.email, fullName: member.fullName, warningsCount: member.warningsCount };
}

/** مهلة تكرار تذكير التحقق الثنائي — أسبوعان.
 *  يومياً يُزعج، وشهرياً يُنسى. */
const TOTP_NUDGE_DAYS = 14;

/** يذكّر الحسابات الإدارية التي لم تفعّل التحقق الثنائي.
 *
 *  التذكير يتكرّر ما دام غير مفعّل ويتوقّف من تلقائه بالتفعيل — لا حاجة
 *  لأن يُلغيه أحد. و`totpNudgedAt` يمنع تكراره كل يوم: من ذُكِّر أمس
 *  لا يُذكَّر اليوم. والحسابات المُنحّاة خارج النطاق أصلاً. */
export async function nudgeMissingTwoFactor(): Promise<number> {
  const cutoff = new Date(Date.now() - TOTP_NUDGE_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.user.findMany({
    where: {
      isActive: true,
      totpEnabled: false,
      OR: [{ totpNudgedAt: null }, { totpNudgedAt: { lt: cutoff } }],
    },
    select: { id: true, email: true, fullName: true },
  });

  const securityUrl = `${process.env.APP_BASE_URL || "http://localhost:3000"}/admin/security`;
  let sent = 0;
  for (const user of due) {
    const res = await sendTotpNudgeEmail({
      to: user.email,
      fullName: user.fullName,
      securityUrl,
    });
    // الختم يُكتب على المحاولة الناجحة وحدها: بريدٌ لم يخرج لا يُعدّ
    // تذكيراً، وختمه يحجب صاحبه أسبوعين عن تذكير لم يصله
    if (!res.skipped) {
      await prisma.user.update({ where: { id: user.id }, data: { totpNudgedAt: new Date() } });
      sent += 1;
    }
  }
  return sent;
}

/** تعارضات المقاعد المفردة — يُقرأ الجواب من الإنتاج لا يُخمَّن.
 *
 *  `assertRoleSeatAvailable` يحرس **الإنشاء والاعتماد**: فلا يُنشأ مقعدٌ
 *  ثانٍ لمنصبٍ مفرد من اليوم. لكنه لا يرى ما سبقه — حساباتٌ أُدخلت قبل
 *  القاعدة، أو زُرعت في القاعدة مباشرةً، أو غُيّر دورُها بمسارٍ لا يمرّ
 *  على الحرس. فالحرس سليم والبيانات قد لا تكون.
 *
 *  وللتعارض أثرٌ يُقرأ في البريد: `emailsForExecutive()` يرجع **كل**
 *  تنفيذيٍّ نشط، فتذكرةٌ صُعِّدت إلى التنفيذي تُراسل ثلاثة إن كانوا
 *  ثلاثة — وهو عين ما نُهي عنه في تقليل الرسائل.
 *
 *  ولا يُصلح هذا تلقائياً: تعطيلُ حسابين من ثلاثة اختيارٌ لا يملكه
 *  الكود — قد يُعطّل التنفيذيَّ الحقيقي ويُبقي قديماً. فيُعرَض على
 *  المؤسس بأسمائه ليحسمه هو. */
export type SeatHolder = {
  id: string;
  fullName: string;
  email: string;
  createdAt: Date;
  /** هل استُعمل الحساب قطّ؟
   *
   *  حسابٌ أُنشئ ولم يُغيَّر رمزُه المؤقّت ولم يُكمَل سجلُّه لم يدخله
   *  صاحبُه. وهذه أوثق علامةٍ على المكرّر الزائد: الحقيقي يُستعمل. */
  everUsed: boolean;
  /** حالة اعتماد سجلّ ترشّحه — يُوصَل بالبريد.
   *
   *  `null` يعني: لا سجلّ ترشّحٍ لهذا البريد أصلاً. وهو حالُ من أُنشئ
   *  حسابُه بيدٍ مباشرةً (بذرة النظام أو إنشاءٌ إداري)، وحالُ المكرّر
   *  الذي أُنشئ خطأً. */
  approvalStatus: string | null;
};

export async function seatConflicts(): Promise<
  { role: string; roleLabel: string; departmentName: string | null; holders: SeatHolder[] }[]
> {
  const conflicts: Awaited<ReturnType<typeof seatConflicts>> = [];

  /** يُلحق بكل شاغلٍ ما يُفرّقه عن قرينه.
   *
   *  كان التعارض يُعرض أسماءً وبُرُداً فقط — فيرى المؤسس أن المقعد
   *  مشغولٌ باثنين ولا يعرف أيُّهما الزائد. والمعرفة هنا ليست رفاهية:
   *  حذفُ الحساب الخطأ يُخرج قائداً عاملاً من المنصة.
   *
   *  فيُقال: متى أُنشئ، وهل استُعمل قطّ، وهل له سجلُّ ترشّحٍ معتمَد. */
  async function enrich(
    rows: { id: string; fullName: string; email: string; createdAt: Date;
            passwordChangedAt: Date | null; profileCompletedAt: Date | null }[]
  ): Promise<SeatHolder[]> {
    const members = await prisma.member.findMany({
      where: { email: { in: rows.map((r) => r.email) } },
      select: { email: true, approvalStatus: true },
    });
    const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.approvalStatus]));
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      createdAt: r.createdAt,
      everUsed: r.passwordChangedAt !== null || r.profileCompletedAt !== null,
      approvalStatus: byEmail.get(r.email.toLowerCase()) ?? null,
    }));
  }

  const SEAT_SELECT = {
    id: true,
    fullName: true,
    email: true,
    createdAt: true,
    passwordChangedAt: true,
    profileCompletedAt: true,
  } as const;

  // الأدوار المفردة على مستوى المنظمة
  for (const role of ["super_admin", "executive", "operations_officer"] as const) {
    if (!isSingletonRole(role)) continue;
    const rows = await prisma.user.findMany({
      where: { role, isActive: true },
      select: SEAT_SELECT,
      orderBy: { createdAt: "asc" },
    });
    if (rows.length > 1) {
      conflicts.push({
        role,
        roleLabel: ROLE_LABELS[role] ?? role,
        departmentName: null,
        holders: await enrich(rows),
      });
    }
  }

  // قيادة القسم مفردةٌ لكل قسم لا للمنظمة
  const departments = await prisma.department.findMany({
    where: OPEN_DEPARTMENT_WHERE,
    select: { id: true, name: true },
  });
  for (const dept of departments) {
    const rows = await prisma.user.findMany({
      where: { role: "department_admin", isActive: true, departmentId: dept.id },
      select: SEAT_SELECT,
      orderBy: { createdAt: "asc" },
    });
    if (rows.length > 1) {
      conflicts.push({
        role: "department_admin",
        roleLabel: ROLE_LABELS.department_admin ?? "قائد قسم",
        departmentName: dept.name,
        holders: await enrich(rows),
      });
    }
  }

  return conflicts;
}

/** حدُّ طوابير الاعتماد والقوائم المعروضة في اللوحات.
 *
 *  **ولماذا حدٌّ أصلاً على طابورٍ لا يُنتظَر أن يطول:** لأن الحدَّ يُعلَن
 *  ولا يُفترَض. استعلامٌ بلا `take` عقدُه «أعطِني كلَّ شيء» — وهو يَصدق
 *  اليوم وعشرةُ صفوفٍ في الجدول، ويَنكسر يومَ تَكبر المنصة بلا أن يتغيّر
 *  سطرٌ واحد. والترتيبُ هنا بالأقدم فالأقدم (الطابورُ يُعالَج من رأسه)،
 *  فما يُقطَع هو الذيلُ الذي لا يُعالَج في هذه الجلسة على كل حال. */
export const QUEUE_TAKE = 200;
