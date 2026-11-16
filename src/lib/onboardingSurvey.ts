import type { Gender, OnboardingSurveyResponse, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";

/** **استبيانُ الانضمام** — أربعةُ أسئلةٍ يُجيبها العضوُ مرّةً بعد اعتماده النهائي.
 *
 *  - **متى:** يُطلقه الاعتمادُ النهائي (`approveMember` يختم `onboardingSurveyRequiredAt`)، ويُعرض
 *    عند أول دخولٍ بعده، ولا تُفتح مساحةُ العمل حتى يُجاب (`AppSidebar` ← `/onboarding-survey`).
 *    ولا يُعرض قبل الاعتماد أبداً، ولا لمن اعتُمد قبل وجوده (لا ختمَ له).
 *  - **مرّةً واحدة:** الإجابةُ القائمة (`supersededAt = null`) واحدةٌ للعضو — يحرسها قفلٌ في معاملة
 *    فلا تمرّ إجابتان متسابقتان. ولا تُعاد إلا بإعادة فتحٍ إداريةٍ موثّقة (من وسبب)، والإجابةُ
 *    السابقة تبقى محفوظةً كما هي.
 *  - **لا أثرَ على العضوية:** التقييمُ المنخفض ليس رسوباً ولا يغيّر حالةَ العضو ولا صلاحياته —
 *    يُعلَّم «تحتاج متابعة» لمسؤول التشغيل وحسب.
 *  - **البنر:** إجابةُ العضو إفادتُه هو، تُحفظ وتُعرض منفصلةً عن سجلّ التسليم الفعلي
 *    (`welcomeEmailSentAt`) — لا تُصحِّح إحداهما الأخرى.
 *  - **الجنس:** يُحدِّث صيغةَ المخاطبة فيما يأتي من رسائل وواجهة؛ وما أُرسل قبلُ لا يُمَسّ. */

export const SURVEY_ADMIN_ROLES = ["super_admin", "executive", "operations_officer"] as const;
/** من يرى لوحة الاستبيان ويصدّرها ويعيد فتحه ويُغلق متابعته */
export function canManageOnboardingSurvey(role: string | null | undefined): boolean {
  return (SURVEY_ADMIN_ROLES as readonly string[]).includes(role ?? "");
}

export type SurveyAnswers = {
  journeyRating: number;
  roleClarityRating: number;
  bannerReceived: boolean;
  gender: Gender;
};

/** التقييمُ عند هذا الحدّ أو دونه يستدعي متابعةً — لا حكماً */
export const LOW_RATING = 2;

function rating(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*[1-5]\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** التحقّقُ في الخادم — والقاعدةُ تفرض المدى ثانيةً (قيد CHECK) */
export function parseSurveyAnswers(raw: Record<string, unknown>): { ok: true; answers: SurveyAnswers } | { ok: false; reason: string } {
  const journeyRating = rating(raw.journeyRating);
  const roleClarityRating = rating(raw.roleClarityRating);
  const banner = raw.bannerReceived;
  const bannerReceived = banner === true || banner === "yes" ? true : banner === false || banner === "no" ? false : null;
  const gender = raw.gender === "male" || raw.gender === "female" ? raw.gender : null;
  if (journeyRating === null) return { ok: false, reason: "اختر تقييماً من ١ إلى ٥ لسهولة رحلة الانضمام" };
  if (roleClarityRating === null) return { ok: false, reason: "اختر تقييماً من ١ إلى ٥ لوضوح دورك" };
  if (bannerReceived === null) return { ok: false, reason: "أجب: هل وصلك البنر الترحيبي؟" };
  if (gender === null) return { ok: false, reason: "اختر الجنس" };
  return { ok: true, answers: { journeyRating, roleClarityRating, bannerReceived, gender } };
}

type PendingShape = {
  approvalStatus: string;
  isActive: boolean;
  terminatedAt: Date | null;
  onboardingSurveyRequiredAt: Date | null;
  currentResponses: number;
};

/** هل على العضو الاستبيانُ الآن؟ — معتمَدٌ نشطٌ طُلب منه ولا إجابةَ قائمةً له */
export function surveyPendingFrom(m: PendingShape | null): boolean {
  return !!m && m.approvalStatus === "approved" && m.isActive && !m.terminatedAt && !!m.onboardingSurveyRequiredAt && m.currentResponses === 0;
}

const PENDING_SELECT = {
  approvalStatus: true,
  isActive: true,
  terminatedAt: true,
  onboardingSurveyRequiredAt: true,
  _count: { select: { onboardingSurveys: { where: { supersededAt: null } } } },
} satisfies Prisma.MemberSelect;

function pendingShape(m: Prisma.MemberGetPayload<{ select: typeof PENDING_SELECT }> | null): PendingShape | null {
  return m ? { ...m, currentResponses: m._count.onboardingSurveys } : null;
}

export async function surveyPending(memberId: string): Promise<boolean> {
  return surveyPendingFrom(pendingShape(await prisma.member.findUnique({ where: { id: memberId }, select: PENDING_SELECT })));
}

/** إجابةٌ أُرسلت للتوّ — لتبقى صفحةُ الاستبيان تعرض الشكرَ بعد الإرسال (وبعد التحديث) بدل أن تُحوَّل
 *  فوراً: إجراءُ الخادم يُعيد رسمَ الصفحة، والصفحةُ تُحوِّل من لا استبيانَ عليه */
export async function recentSurveySubmission(memberId: string, withinMs = 10 * 60_000, now = new Date()) {
  return prisma.onboardingSurveyResponse.findFirst({
    where: { memberId, supersededAt: null, submittedAt: { gte: new Date(now.getTime() - withinMs) } },
    select: { gender: true, bannerReceived: true },
  });
}

export type SubmitResult =
  | { ok: true; responseId: string; fullName: string; gender: Gender; bannerReceived: boolean }
  | { ok: false; code: "invalid" | "not_required" | "already"; reason: string };

/** **الإجابة** — ذرّيةٌ: القفلُ ثم الفحصُ ثم الكتابة، في معاملةٍ واحدة */
export async function submitOnboardingSurvey(memberId: string, raw: Record<string, unknown>, now = new Date()): Promise<SubmitResult> {
  const parsed = parseSurveyAnswers(raw);
  if (!parsed.ok) return { ok: false, code: "invalid", reason: parsed.reason };
  const a = parsed.answers;

  const res = await prisma.$transaction(async (tx): Promise<SubmitResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding-survey:${memberId}`}))`;
    const m = await tx.member.findUnique({ where: { id: memberId }, select: { ...PENDING_SELECT, fullName: true } });
    const shape = pendingShape(m);
    if (!shape || !surveyPendingFrom(shape)) {
      return shape && shape.currentResponses > 0
        ? { ok: false, code: "already", reason: "أُرسلت إجابتك من قبل — شكراً لك" }
        : { ok: false, code: "not_required", reason: "لا استبيانَ مطلوبٌ منك الآن" };
    }
    const r = await tx.onboardingSurveyResponse.create({
      data: { memberId, ...a, submittedAt: now },
      select: { id: true },
    });
    // صيغةُ المخاطبة لما يأتي — وما أُرسل قبلُ يبقى كما كُتب
    await tx.member.update({ where: { id: memberId }, data: { gender: a.gender } });
    return { ok: true, responseId: r.id, fullName: m!.fullName, gender: a.gender, bannerReceived: a.bannerReceived };
  });

  if (res.ok) {
    const m = await prisma.member.findUnique({ where: { id: memberId }, select: { email: true, department: { select: { name: true } } } });
    await logEvent({
      fullName: res.fullName,
      email: m?.email ?? "",
      roleOrDepartment: m?.department?.name ?? "",
      event: "استبيان الانضمام",
      details: `سهولة الرحلة ${a.journeyRating}/5 — وضوح الدور ${a.roleClarityRating}/5 — البنر: ${a.bannerReceived ? "وصل" : "لم يصل (بإفادته)"}`,
      at: now,
    });
  }
  return res;
}

export type SurveyStatus = "not_completed" | "completed" | "banner_missing" | "needs_follow_up";
export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  not_completed: "لم يُكمل",
  completed: "اكتملت رحلة الانضمام",
  banner_missing: "البنر لم يصل",
  needs_follow_up: "تحتاج متابعة",
};

type StatusShape = Pick<OnboardingSurveyResponse, "bannerReceived" | "journeyRating" | "roleClarityRating" | "followUpResolvedAt">;

/** الحالةُ من الإجابة القائمة: البنرُ أولاً، ثم التقييمُ المنخفض — وما أغلق التشغيلُ متابعتَه مكتمل */
export function surveyStatus(r: StatusShape | null | undefined): SurveyStatus {
  if (!r) return "not_completed";
  if (r.followUpResolvedAt) return "completed";
  if (!r.bannerReceived) return "banner_missing";
  if (r.journeyRating <= LOW_RATING || r.roleClarityRating <= LOW_RATING) return "needs_follow_up";
  return "completed";
}

export type SurveyActor = { id: string; name: string; role: string; email?: string | null };

function cleanText(v: unknown, max = 500) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** **إعادةُ فتحٍ موثّقة** — تُحفَظ الإجابةُ السابقة (تُعلَّم «سابقة» بمن وسبب) ويُجيب العضوُ من جديد */
export async function reopenOnboardingSurvey(actor: SurveyActor, memberId: string, rawReason: unknown, now = new Date()) {
  if (!canManageOnboardingSurvey(actor.role)) return { ok: false as const, reason: "ليس لك إعادةُ فتح الاستبيان" };
  const reason = cleanText(rawReason);
  if (reason.length < 5) return { ok: false as const, reason: "اكتب سبب إعادة الفتح — يُحفَظ مع الإجابة السابقة" };
  const res = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding-survey:${memberId}`}))`;
    const current = await tx.onboardingSurveyResponse.findFirst({ where: { memberId, supersededAt: null }, select: { id: true } });
    if (!current) return { ok: false as const, reason: "لا إجابةَ قائمةً لإعادة فتحها" };
    await tx.onboardingSurveyResponse.update({
      where: { id: current.id },
      data: { supersededAt: now, reopenedByName: actor.name, reopenReason: reason },
    });
    return { ok: true as const };
  });
  if (res.ok) {
    const m = await prisma.member.findUnique({ where: { id: memberId }, select: { fullName: true, email: true } });
    await logEvent({
      fullName: m?.fullName ?? "",
      email: m?.email ?? "",
      roleOrDepartment: "استبيان الانضمام",
      event: "إعادة فتح استبيان الانضمام",
      details: `${reason} — أعاده ${actor.name}`,
      at: now,
    });
  }
  return res;
}

/** **إغلاقُ المتابعة** — بعد أن يتصرّف التشغيل (أعاد البنر، تواصل بشأن التقييم). لا يغيّر الإجابة */
export async function resolveOnboardingFollowUp(actor: SurveyActor, responseId: string, rawNote: unknown, now = new Date()) {
  if (!canManageOnboardingSurvey(actor.role)) return { ok: false as const, reason: "ليس لك إغلاقُ المتابعة" };
  const note = cleanText(rawNote);
  if (note.length < 3) return { ok: false as const, reason: "اكتب ما تمّ في المتابعة" };
  const r = await prisma.onboardingSurveyResponse.findUnique({
    where: { id: responseId },
    include: { member: { select: { fullName: true, email: true } } },
  });
  if (!r || r.supersededAt) return { ok: false as const, reason: "الإجابة غير موجودة أو أُعيد فتحها" };
  const status = surveyStatus(r);
  if (status !== "banner_missing" && status !== "needs_follow_up") return { ok: false as const, reason: "لا متابعةَ مفتوحةً لهذه الإجابة" };
  const w = await prisma.onboardingSurveyResponse.updateMany({
    where: { id: responseId, supersededAt: null, followUpResolvedAt: null },
    data: { followUpResolvedAt: now, followUpResolvedByName: actor.name, followUpNote: note },
  });
  if (!w.count) return { ok: false as const, reason: "أُغلقت المتابعة للتوّ — حدّث الصفحة" };
  await logEvent({
    fullName: r.member.fullName,
    email: r.member.email,
    roleOrDepartment: "استبيان الانضمام",
    event: "إغلاق متابعة استبيان الانضمام",
    details: `${SURVEY_STATUS_LABEL[status]} — ${note} — ${actor.name}`,
    at: now,
  });
  return { ok: true as const };
}

/** صفوفُ اللوحة والتصدير: كلُّ عضوٍ معتمَدٍ نشطٍ طُلب منه الاستبيان، بإجابته القائمة وسجلّه */
export async function onboardingRows() {
  // member-roster: all — استبيانُ القائد على سجلّ ترشّحه التوأم (ق٥): فالقائمةُ تقصد القادةَ المرقَّين أيضاً، لا الأعضاءَ وحدهم
  const members = await prisma.member.findMany({
    // كلُّ من طُلب منه الاستبيانُ وهو معتمَدٌ نشط — الأعضاءُ، والقادةُ بسجلّ عضويتهم التوأم (ق٥: كانوا يُستثنون)
    where: { isActive: true, approvalStatus: "approved", onboardingSurveyRequiredAt: { not: null }, terminatedAt: null },
    select: {
      id: true,
      fullName: true,
      email: true,
      jobTitle: true,
      decidedAt: true,
      welcomeEmailSentAt: true,
      onboardingSurveyRequiredAt: true,
      department: { select: { name: true } },
      onboardingSurveys: { orderBy: { submittedAt: "desc" }, take: 10 },
    },
    orderBy: { decidedAt: "desc" },
    take: 2000,
  });
  return members.map((m) => {
    const current = m.onboardingSurveys.find((r) => !r.supersededAt) ?? null;
    return {
      ...m,
      current,
      previous: m.onboardingSurveys.filter((r) => r.supersededAt),
      status: surveyStatus(current),
    };
  });
}
export type OnboardingRow = Awaited<ReturnType<typeof onboardingRows>>[number];

export function onboardingSummary(rows: OnboardingRow[]) {
  const answered = rows.filter((r) => r.current);
  const avg = (k: "journeyRating" | "roleClarityRating") =>
    answered.length ? Math.round((answered.reduce((s, r) => s + r.current![k], 0) / answered.length) * 10) / 10 : null;
  const by = (s: SurveyStatus) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    answered: answered.length,
    notCompleted: by("not_completed"),
    completed: by("completed"),
    bannerMissing: by("banner_missing"),
    needsFollowUp: by("needs_follow_up"),
    avgJourney: avg("journeyRating"),
    avgRoleClarity: avg("roleClarityRating"),
    /** قال «لم يصل» والسجلُّ يقول إنه سُلِّم لمزوّد البريد — يُتحقَّق من صندوقه لا من المنصة */
    statedVsDelivered: answered.filter((r) => !r.current!.bannerReceived && r.welcomeEmailSentAt).length,
  };
}

async function logEvent(row: Parameters<typeof appendMemberEvent>[0]) {
  try {
    await appendMemberEvent(row);
  } catch (e) {
    console.error("[onboarding-survey] sheet event", e instanceof Error ? e.name : typeof e);
  }
}

/** **إطلاقُ الاستبيان عند الاعتماد النهائي** — من كل طريقٍ إليه: العضو، والقائد (على سجلّ عضويته التوأم)، وعضو الإدارة
 *  العليا. كان يُختم في طريق العضو وحده فلم يظهر للإدارة العليا ولا للقادة (البند ٦). ولا يُعاد ختمُ من خُتم. */
export async function requireOnboardingSurvey(memberId: string, now = new Date()) {
  await prisma.member.updateMany({ where: { id: memberId, onboardingSurveyRequiredAt: null }, data: { onboardingSurveyRequiredAt: now } });
}

/** سجلُّ الاستبيان لصاحب الجلسة: العضوُ نفسُه، أو سجلُّ عضوية القائد التوأم (القادةُ دخلوا من طريق الترشّح فلهم رحلة).
 *  والمؤسسُ لا رحلةَ انضمامٍ له — لا سجلَّ له. */
export async function surveyMemberIdFor(session: { user?: { id?: string; role?: string; email?: string | null } } | null): Promise<string | null> {
  const u = session?.user;
  if (!u?.id || !u.role) return null;
  if (u.role === "member") return u.id;
  if (u.role === "super_admin" || !u.email) return null;
  const twin = await prisma.member.findFirst({ where: { email: { equals: u.email, mode: "insensitive" } }, select: { id: true } });
  return twin?.id ?? null;
}

/** أُطلق الاستبيان (الترحيل `20261109120000_onboarding_survey_requests`) — ومن اعتُمد قبله لا يُطالَب به (لا يُعاد لكل قديم) */
export const SURVEY_LAUNCHED_AT = new Date("2026-11-09T12:00:00Z");

/** **من فاته الاستبيانُ بسبب الخلل** (ق٥): اعتُمد نهائياً بعد إطلاقه، وهو من الإدارة العليا أو قائد (الطريقان اللذان لم
 *  يُختما)، ولا ختمَ له ولا إجابة. لا يشمل الأعضاءَ القدامى الذين اكتملت رحلتُهم — ولا يُغيَّر شيءٌ قبل موافقةٍ صريحة. */
export async function missedSurveyRows() {
  return prisma.member.findMany({
    where: {
      isActive: true,
      approvalStatus: "approved",
      terminatedAt: null,
      onboardingSurveyRequiredAt: null,
      decidedAt: { gte: SURVEY_LAUNCHED_AT },
      onboardingSurveys: { none: {} },
      OR: [{ department: { leadershipOnly: true } }, { invite: { targetRole: { not: "member" } } }],
    },
    select: { id: true, fullName: true, email: true, decidedAt: true, department: { select: { name: true } }, invite: { select: { targetRole: true } } },
    orderBy: { decidedAt: "asc" },
  });
}

/** يُطلق الاستبيانَ لمن فاتهم — بإجراءٍ صريحٍ ممن يدير الاستبيان، ويُسجَّل في سجلّ التدقيق بعدد من شملهم وأسمائهم */
export async function stampMissedSurveys(actor: SurveyActor, now = new Date()) {
  if (!canManageOnboardingSurvey(actor.role)) return { ok: false as const, reason: "لمن يدير استبيان الانضمام" };
  const rows = await missedSurveyRows();
  if (!rows.length) return { ok: true as const, count: 0 };
  await prisma.member.updateMany({ where: { id: { in: rows.map((r) => r.id) }, onboardingSurveyRequiredAt: null }, data: { onboardingSurveyRequiredAt: now } });
  const { recordOrgEvent } = await import("@/lib/org/audit");
  await recordOrgEvent(prisma, {
    scope: "member", entityId: "onboarding-survey", departmentId: "—", action: "survey.missed.enabled",
    actor: { kind: "user", id: actor.id, name: actor.name, role: actor.role },
    after: { count: rows.length, members: rows.map((r) => r.fullName) },
  });
  return { ok: true as const, count: rows.length };
}
