import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import type { PeriodState, TaskExecState, Prisma } from "@prisma/client";
import { lastWeekdayAt, nextWeekdayAt, SATURDAY, riyadhDaysBetween } from "@/lib/riyadh";
import { getDictionary, type Locale } from "@/i18n";

/** فتراتُ التنفيذ الأسبوعية: آلةُ حالةٍ صريحة، وقفلٌ يُفرَض في الخادم.
 *
 *  ## لماذا الفترةُ تنظيميةٌ لا قسمية
 *
 *  «فتحُ الأسبوع» قرارٌ واحدٌ للمنظمة كلِّها: لا يُعقَل أن يكون أسبوعُ
 *  التسويق مفتوحاً وأسبوعُ التقنية مغلقاً وهما يَجتمعان سبتاً واحداً.
 *  فالفترةُ صفٌّ واحد، وخططُ الأقسام داخلها صفوف.
 *
 *  ## والفتحُ لا يقع بمرور الوقت
 *
 *  **هذا أهمُّ قيدٍ في هذا الملف.** لو فُتح الأسبوع لأن الساعة بلغت
 *  السبت لصار «فتحُ الأسبوع» حدثاً تقويمياً لا قراراً إدارياً: تُفتَح
 *  الفترةُ والمراجعةُ لم تقع، ويُقرأ في التقرير أن الأسبوع بدأ وأحدٌ لم
 *  يُراجع شيئاً. فلا تُفتَح إلا بنداءٍ صريحٍ من مُصرَّحٍ له — والكنسُ
 *  اليوميُّ يُنشئ الفترةَ ويُرحّل، **ولا يفتح**.
 *
 *  ## والقفلُ في الخادم لا في الواجهة
 *
 *  كلُّ كتابةٍ على مهمّةٍ تمرّ بـ`assertPeriodWritable`: فمن نادى
 *  الإجراءَ من خارج الصفحة، أو خمّن معرّفاً، أو عدّل حالةَ العميل، وجد
 *  القفلَ نفسَه. وإخفاءُ زرٍّ ليس قفلاً.
 */

export const PERIOD_WEEKDAY = SATURDAY;

/** ساعةُ بداية الأسبوع بتوقيت الرياض — بعد اجتماع السبت.
 *
 *  وهي نفسُ ساعةِ أرشفة التذاكر (`lastWeeklyCutoff`) عن قصد: الأسبوعُ
 *  التنفيذيُّ يبدأ حيث ينتهي الأسبوعُ المُراجَع، فلا تُقرأ تذكرةٌ في
 *  فترتين ولا يقع يومٌ بين الفترتين لا يتبع أيّاً منهما. */
export const PERIOD_START_HOUR = 22;

/** حالاتُ المهمّة التي تُعَدّ **عملاً قائماً** لم يُغلَق بعد */
export const OUTSTANDING_STATES: TaskExecState[] = [
  "not_started",
  "in_progress",
  "submitted",
  "returned",
  "incomplete",
  "blocked",
];

/** حالاتٌ أُغلقت بقرار: لا تُرحَّل ولا تُعَدّ إنجازاً (خلا `verified`) */
export const CLOSED_STATES: TaskExecState[] = [
  "verified",
  "waived",
  "cancelled",
  "superseded",
  "deferred",
];

/** من يَفتح ويُغلق ويَستثني: التنفيذي ومعه المؤسس.
 *
 *  والمؤسس يملكها لأنه يعلوه، ولأن المنصة لا تتوقّف إن خلا مقعدُه —
 *  وهذا هو القيدُ نفسُه المطبَّق في اعتماد اللجان. */
export function canGovernPeriod(role: string) {
  return role === "executive" || role === "super_admin";
}

/** من يَعتمد خططَ الأقسام ويُراجع التسليمات: التنفيذي ومعه المؤسس */
export function canReviewWork(role: string) {
  return role === "executive" || role === "super_admin";
}

/** من يَبني خطةَ قسمٍ ويُسندُ مهامَّها: قائدُه — ومن يعلوه */
export function canPlanDepartment(session: Session, departmentId: string) {
  if (canGovernPeriod(session.user.role)) return true;
  return session.user.role === "department_admin" && session.user.departmentId === departmentId;
}

/** بدايةُ الفترة التي تقع فيها هذه اللحظة */
export function periodStartFor(now: Date = new Date()): Date {
  return lastWeekdayAt(PERIOD_WEEKDAY, PERIOD_START_HOUR, 0, now);
}

/** بدايةُ الفترة التالية */
export function nextPeriodStartFor(now: Date = new Date()): Date {
  return nextWeekdayAt(PERIOD_WEEKDAY, PERIOD_START_HOUR, 0, now);
}

function endOf(weekStart: Date) {
  return new Date(weekStart.getTime() + 7 * 86_400_000);
}

/** يُنشئ صفَّ الفترة إن لم يكن — ولا يفتحها.
 *
 *  **وهي الدالّةُ الوحيدة التي يُسمَح للكنس بندائها**، ولذلك لا تَفتح
 *  شيئاً: تُنشئ الصفَّ حالتُه `draft` فتُبنى فيه الخطط. والتفرّدُ على
 *  `weekStart` هو ما يجعلها لا تُكرِّر مهما نودِيت. */
export async function ensurePeriod(weekStart: Date) {
  const existing = await prisma.executionPeriod.findUnique({ where: { weekStart } });
  if (existing) return existing;
  try {
    return await prisma.executionPeriod.create({
      data: { weekStart, weekEnd: endOf(weekStart) },
    });
  } catch {
    // متسابقان أنشآها معاً — التفرّدُ يَرفض الثاني، فيُقرأ الأول
    return prisma.executionPeriod.findUniqueOrThrow({ where: { weekStart } });
  }
}

/** الفترةُ الجارية والتالية — تُنشَآن إن لم تكونا */
export async function currentAndNextPeriod(now: Date = new Date()) {
  const current = await ensurePeriod(periodStartFor(now));
  const next = await ensurePeriod(nextPeriodStartFor(now));
  return { current, next };
}

/** الفترةُ السابقة لفترةٍ — للمراجعة الأسبوعية */
export async function previousPeriod(weekStart: Date) {
  return prisma.executionPeriod.findFirst({
    where: { weekStart: { lt: weekStart } },
    orderBy: { weekStart: "desc" },
  });
}

/** هل يُكتَب في هذه الفترة؟ — المفتوحةُ وحدها، وما أُعيد فتحُه باستثناء */
export function periodIsWritable(state: PeriodState) {
  return state === "open" || state === "reopened";
}

/** يَرفض الكتابةَ في فترةٍ غير مفتوحة — ويُسمّي السبب.
 *
 *  **والرفضُ يُسمّي الحالةَ لا يقول «ممنوع»:** من يُحاول تعديل مهمّةٍ
 *  في أسبوعٍ لم يُفتَح بعد يجب أن يعرف أنه لم يُفتَح، لا أن يَحسب أن
 *  صلاحيته ناقصة. */
export async function assertPeriodWritable(periodId: string | null | undefined) {
  if (!periodId) return; // مهمّةٌ خارج فترة — لا قفلَ عليها
  const period = await prisma.executionPeriod.findUnique({
    where: { id: periodId },
    select: { state: true, weekStart: true },
  });
  if (!period) throw new Error("فترة التنفيذ غير موجودة");
  if (periodIsWritable(period.state)) return;

  const why: Record<PeriodState, string> = {
    draft: "خطةُ هذا الأسبوع ما زالت تُبنى ولم تُفتَح للتنفيذ بعد",
    submitted: "خطةُ هذا الأسبوع رُفعت للمراجعة التنفيذية ولم تُفتَح بعد",
    approved_for_review: "الخطة معتمَدةٌ للعرض في اجتماع السبت، ولا يُكتَب فيها قبل فتحها",
    awaiting_review: "مراجعةُ السبت لم تكتمل بعد — والأسبوع لا يُفتَح قبلها",
    awaiting_opening: "اكتملت المراجعة وتنتظر إذنَ الفتح من الإدارة التنفيذية",
    open: "",
    closed: "هذا الأسبوع أُغلق — وما لم يكتمل فيه رُحِّل إلى الأسبوع التالي",
    reopened: "",
  };
  throw new Error(why[period.state] || "لا يُكتَب في هذه الفترة");
}

export type PeriodDecision =
  | { ok: true; message: string }
  | { ok: false; reason: string };

/** الانتقالاتُ المسموحة — مكتوبةً لا مُستنتَجة.
 *
 *  آلةُ الحالة تُقرأ من هذا الجدول وحده، فلا انتقالَ «يُنسى» في فرعٍ من
 *  الكود ولا يُسمَح بقفزةٍ غير مقصودة (من `draft` إلى `open` مثلاً). */
const ALLOWED: Record<PeriodState, PeriodState[]> = {
  draft: ["submitted"],
  submitted: ["approved_for_review", "draft"],
  approved_for_review: ["awaiting_review"],
  awaiting_review: ["awaiting_opening", "open"], // الفتحُ الاستثنائيُّ من هنا
  awaiting_opening: ["open"],
  open: ["closed"],
  closed: ["reopened"],
  reopened: ["closed"],
};

export function canTransition(from: PeriodState, to: PeriodState) {
  return (ALLOWED[from] ?? []).includes(to);
}

async function recordChange(data: {
  kind: Prisma.WorkChangeCreateInput["kind"];
  periodId?: string | null;
  taskId?: string | null;
  reason: string;
  previous?: unknown;
  next?: unknown;
  actorId?: string | null;
  actorName: string;
}) {
  await prisma.workChange.create({
    data: {
      kind: data.kind,
      periodId: data.periodId ?? null,
      taskId: data.taskId ?? null,
      reason: data.reason,
      previousJson: (data.previous ?? undefined) as Prisma.InputJsonValue | undefined,
      nextJson: (data.next ?? undefined) as Prisma.InputJsonValue | undefined,
      actorId: data.actorId ?? null,
      actorName: data.actorName,
    },
  });
}

/** يَنقل الفترةَ من حالةٍ إلى حالة — بالحرس في `where` لا قبله.
 *
 *  **والشرطُ في `where` هو ما يمنع السباق:** نداءانِ متزامنان للفتح لا
 *  يَكتب أحدُهما فوق الآخر، ولا يُحسَب الفتحُ مرّتين — الثاني يجد
 *  `count === 0` فيُجاب بأنها مفتوحةٌ سلفاً. وهذا معنى أن يكون الفتحُ
 *  **idempotent**: نداؤه مرّتين كنداؤه مرّة. */
async function transition(opts: {
  periodId: string;
  to: PeriodState;
  session: Session;
  reason?: string;
  extra?: Prisma.ExecutionPeriodUpdateInput;
  idempotentMessage: string;
  successMessage: string;
}): Promise<PeriodDecision> {
  const period = await prisma.executionPeriod.findUnique({
    where: { id: opts.periodId },
    select: { id: true, state: true, weekStart: true },
  });
  if (!period) return { ok: false, reason: "فترة التنفيذ غير موجودة" };
  if (period.state === opts.to) return { ok: true, message: opts.idempotentMessage };
  if (!canTransition(period.state, opts.to)) {
    return {
      ok: false,
      reason: `لا يُنتقَل من «${stateLabel(period.state)}» إلى «${stateLabel(opts.to)}» — المسار: بناءٌ ← رفعٌ ← اعتمادٌ للعرض ← مراجعةٌ ← إذنُ فتح ← تنفيذ`,
    };
  }

  const written = await prisma.executionPeriod.updateMany({
    where: { id: period.id, state: period.state },
    data: { state: opts.to, ...(opts.extra as Prisma.ExecutionPeriodUpdateManyMutationInput) },
  });
  if (written.count === 0) {
    return { ok: false, reason: "تغيّرت حالةُ الفترة أثناء تنفيذ طلبك — أعِد المحاولة" };
  }

  await recordChange({
    kind: opts.to === "open" ? "emergency_open" : "lock_exception",
    periodId: period.id,
    reason: opts.reason ?? `انتقال إلى ${stateLabel(opts.to)}`,
    previous: { state: period.state },
    next: { state: opts.to },
    actorId: opts.session.user.id,
    actorName: opts.session.user.name ?? "—",
  });

  return { ok: true, message: opts.successMessage };
}

/** اسمُ حالة الفترة. والعربيةُ افتراضاً: سجلُّ التغييرات يكتبه بها. */
export function stateLabel(state: PeriodState, locale: Locale = "ar"): string {
  return getDictionary(locale).libLabels.periodState[state];
}

/** رفعُ خطط الأسبوع للمراجعة — لقائد قسمٍ أو للإدارة */
export async function submitPeriod(opts: { periodId: string; session: Session }) {
  if (!canGovernPeriod(opts.session.user.role) && opts.session.user.role !== "department_admin") {
    return { ok: false as const, reason: "الرفعُ للقيادة" };
  }
  return transition({
    periodId: opts.periodId,
    to: "submitted",
    session: opts.session,
    extra: { submittedAt: new Date() },
    idempotentMessage: "الخطةُ مرفوعةٌ للمراجعة سلفاً",
    successMessage: "رُفعت خطةُ الأسبوع للمراجعة التنفيذية",
  });
}

/** اعتمادُها للعرض في اجتماع السبت */
export async function approvePeriodForReview(opts: { periodId: string; session: Session }) {
  if (!canReviewWork(opts.session.user.role)) {
    return { ok: false as const, reason: "الاعتمادُ للمدير التنفيذي — ومعه المؤسس" };
  }
  return transition({
    periodId: opts.periodId,
    to: "approved_for_review",
    session: opts.session,
    extra: { approvedAt: new Date() },
    idempotentMessage: "معتمَدةٌ للعرض سلفاً",
    successMessage: "اعتُمدت للعرض في اجتماع السبت",
  });
}

/** بدءُ المراجعة — يقع بعقد الاجتماع */
export async function beginReview(opts: { periodId: string; session: Session }) {
  if (!canReviewWork(opts.session.user.role)) {
    return { ok: false as const, reason: "بدءُ المراجعة للمدير التنفيذي — ومعه المؤسس" };
  }
  return transition({
    periodId: opts.periodId,
    to: "awaiting_review",
    session: opts.session,
    idempotentMessage: "المراجعةُ جاريةٌ سلفاً",
    successMessage: "بدأت المراجعة — راجِع التزامات الأسبوع الماضي وتسليماتِه",
  });
}

/** إعلانُ اكتمال المراجعة — تنتقل الفترةُ إلى انتظار إذن الفتح */
export async function completeReview(opts: { periodId: string; session: Session }) {
  if (!canReviewWork(opts.session.user.role)) {
    return { ok: false as const, reason: "إتمامُ المراجعة للمدير التنفيذي — ومعه المؤسس" };
  }
  const outstanding = await unresolvedReviewCount(opts.periodId);
  if (outstanding > 0) {
    return {
      ok: false as const,
      reason: `بقي ${outstanding} بنداً بلا قرارٍ في المراجعة — اقضِ فيها، أو افتح الأسبوع استثناءً بسببٍ مكتوب`,
    };
  }
  return transition({
    periodId: opts.periodId,
    to: "awaiting_opening",
    session: opts.session,
    idempotentMessage: "اكتملت المراجعةُ سلفاً",
    successMessage: "اكتملت المراجعة — والأسبوع ينتظر إذن الفتح",
  });
}

/** كم بنداً في فترةٍ سابقةٍ ينتظر قراراً؟
 *
 *  وهو ما يَمنع إعلانَ اكتمال المراجعة: المهمّةُ المرفوعُ تسليمُها
 *  (`submitted`) تنتظر حُكماً، والمعوّقةُ تنتظر قراراً. */
export async function unresolvedReviewCount(periodId: string) {
  const period = await prisma.executionPeriod.findUnique({
    where: { id: periodId },
    select: { weekStart: true },
  });
  if (!period) return 0;
  const prev = await previousPeriod(period.weekStart);
  if (!prev) return 0;
  return prisma.planTask.count({
    where: { periodId: prev.id, execState: { in: ["submitted", "blocked"] } },
  });
}

/** **فتحُ الأسبوع** — القرارُ الذي لا يقع إلا صريحاً.
 *
 *  ويقع من حالتين: `awaiting_opening` بعد مراجعةٍ كاملة، أو
 *  `awaiting_review` **استثناءً** بسببٍ مكتوب. والاستثناءُ لا يَمحو ما
 *  بقي: يُعَدّ ما لم يُقضَ فيه ويُكتَب في صفّ الفترة، وتبقى المهامُّ
 *  على حالها قائمةً أو مُرحَّلة.
 *
 *  ونداؤه مرّتين كنداؤه مرّة: الحرسُ في `where`. */
export async function openPeriod(opts: {
  periodId: string;
  session: Session;
  /** سببُ الفتح قبل اكتمال المراجعة — إلزاميٌّ في الاستثناء وحده */
  emergencyReason?: string | null;
}): Promise<PeriodDecision> {
  if (!canGovernPeriod(opts.session.user.role)) {
    return { ok: false, reason: "فتحُ الأسبوع للمدير التنفيذي — ومعه المؤسس" };
  }
  const period = await prisma.executionPeriod.findUnique({
    where: { id: opts.periodId },
    select: { id: true, state: true, weekStart: true },
  });
  if (!period) return { ok: false, reason: "فترة التنفيذ غير موجودة" };
  if (period.state === "open" || period.state === "reopened") {
    return { ok: true, message: "الأسبوع مفتوحٌ سلفاً — ولم يُفتَح مرّتين" };
  }

  const emergency = period.state === "awaiting_review";
  const reason = opts.emergencyReason?.trim() || null;
  if (emergency && !reason) {
    return {
      ok: false,
      reason: "المراجعةُ لم تكتمل — والفتحُ قبلها استثناءٌ لا يقع بلا سببٍ مكتوب",
    };
  }
  if (!canTransition(period.state, "open")) {
    return {
      ok: false,
      reason: `الأسبوع في حالة «${stateLabel(period.state)}» — ولا يُفتَح منها. المسار: رفعٌ ← اعتمادٌ ← مراجعةٌ ← فتح.`,
    };
  }

  const unresolved = emergency ? await unresolvedReviewCount(period.id) : 0;

  const written = await prisma.executionPeriod.updateMany({
    where: { id: period.id, state: period.state },
    data: {
      state: "open",
      openedAt: new Date(),
      openedById: opts.session.user.id,
      openedByName: opts.session.user.name ?? "—",
      emergencyOpen: emergency,
      emergencyReason: reason,
      unresolvedAtOpen: unresolved,
    },
  });
  if (written.count === 0) return { ok: true, message: "الأسبوع مفتوحٌ سلفاً" };

  await recordChange({
    kind: emergency ? "emergency_open" : "lock_exception",
    periodId: period.id,
    reason: reason ?? "فتحُ الأسبوع بعد اكتمال المراجعة",
    previous: { state: period.state },
    next: { state: "open", emergencyOpen: emergency, unresolvedAtOpen: unresolved },
    actorId: opts.session.user.id,
    actorName: opts.session.user.name ?? "—",
  });

  return {
    ok: true,
    message: emergency
      ? `فُتح الأسبوع استثناءً — وبقي ${unresolved} بنداً بلا قرارٍ وهي قائمةٌ لم تُمحَ`
      : "فُتح الأسبوع للتنفيذ",
  };
}

/** إعادةُ فتحِ فترةٍ أُغلقت — استثناءٌ مسجَّلٌ يُعَدّ */
export async function reopenPeriod(opts: {
  periodId: string;
  session: Session;
  reason: string;
}): Promise<PeriodDecision> {
  if (!canGovernPeriod(opts.session.user.role)) {
    return { ok: false, reason: "إعادةُ الفتح للمدير التنفيذي — ومعه المؤسس" };
  }
  const reason = opts.reason?.trim();
  if (!reason) return { ok: false, reason: "إعادةُ الفتح لا تقع بلا سببٍ مكتوب" };

  const period = await prisma.executionPeriod.findUnique({
    where: { id: opts.periodId },
    select: { id: true, state: true, reopenCount: true },
  });
  if (!period) return { ok: false, reason: "فترة التنفيذ غير موجودة" };
  if (period.state !== "closed") {
    return { ok: false, reason: `الفترةُ «${stateLabel(period.state)}» — ولا يُعاد فتحُ غير المُغلقة` };
  }

  const written = await prisma.executionPeriod.updateMany({
    where: { id: period.id, state: "closed" },
    data: {
      state: "reopened",
      reopenedAt: new Date(),
      reopenCount: { increment: 1 },
      reopenReason: reason,
    },
  });
  if (written.count === 0) return { ok: false, reason: "تغيّرت حالةُ الفترة — أعِد المحاولة" };

  await recordChange({
    kind: "reopen_period",
    periodId: period.id,
    reason,
    previous: { state: "closed", reopenCount: period.reopenCount },
    next: { state: "reopened", reopenCount: period.reopenCount + 1 },
    actorId: opts.session.user.id,
    actorName: opts.session.user.name ?? "—",
  });
  return { ok: true, message: "أُعيد فتحُ الفترة باستثناءٍ مسجَّل" };
}

/** حالةُ الفترة كما تُعرَض: اسمُها، وتواريخُها، وأيُّ أسبوعٍ هي */
export function periodLabel(weekStart: Date, now: Date = new Date(), locale: Locale = "ar"): string {
  const when = getDictionary(locale).libLabels.periodWhen;
  const days = riyadhDaysBetween(weekStart, now);
  if (days >= 0 && days < 7) return when.current;
  if (days < 0 && days >= -7) return when.next;
  if (days >= 7 && days < 14) return when.previous;
  return "";
}
