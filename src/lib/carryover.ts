import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import type { TaskExecState, Prisma } from "@prisma/client";
import {
  OUTSTANDING_STATES,
  canGovernPeriod,
  canPlanDepartment,
  ensurePeriod,
  nextPeriodStartFor,
  periodStartFor,
} from "@/lib/execution";

/** ترحيلُ ما لم يكتمل — ومنعُ تراكمه صامتاً.
 *
 *  ## القاعدةُ التي يقوم عليها هذا الملف كلُّه
 *
 *  **ما لم يكتمل لا يَختفي بانتهاء الأسبوع، ولا يُعَدّ منجَزاً لأن
 *  الأسبوع انتهى.** وهذان خطآن متقابلان، وكلاهما يُفسد التقرير:
 *  الأولُ يُخفي الالتزام، والثاني يَكذب في الإنجاز.
 *
 *  فالمهمّةُ **صفٌّ واحدٌ يَعبر الأسابيع**: يُنقَل `planId`/`periodId`
 *  إلى خطة الأسبوع التالي، ويبقى **المعرّفُ والموعدُ الأصليُّ وصاحبُها
 *  وقسمُها** كما هي، ويُعَدّ الترحيلُ في عدّادَين (كلّيٍّ ومتتالٍ)،
 *  ويُكتَب له صفٌّ في `TaskCarryover` يحمل حالتَها لحظةَ الترحيل.
 *
 *  ## ولا يُرحَّل شيءٌ بلا سببٍ وخطةِ تصحيح
 *
 *  الكنسُ يُرحّل ويُعلّم، ثم **لا تُعتمَد خطةُ الأسبوع التالي** حتى
 *  يكتب قائدُ القسم لكلِّ مُرحَّلٍ سببَه وخطةَ تصحيحه. فالترحيلُ ليس
 *  إرجاءً تلقائياً، بل التزامٌ يُعاد إقرارُه.
 *
 *  ## والتراكمُ يُقاس قبل أن يقع
 *
 *  جمعُ أوزان الجديد والمُرحَّل يُقارَن بطاقة القسم المُعلَنة: فإن
 *  تجاوزها لم تُعتمَد الخطةُ إلا بإقرارٍ مكتوبٍ من الإدارة. وبلا هذا
 *  يُلصَق المُرحَّلُ بالأسبوع التالي فيُعطِّل جديدَه، فيُرحَّل الجديد،
 *  وتدور الحلقةُ حتى لا يبقى أسبوعٌ يُنفَّذ فيه شيء.
 */

/** عتباتُ التصعيد — تُضبَط ولا تُخمَّن في فرعٍ من الكود.
 *
 *  والرقمُ مكتوبٌ هنا بوصفه **قراراً معلَناً**، لا عدداً سحريّاً
 *  متناثراً في الشروط: ثلاثةُ ترحيلاتٍ متتاليةٍ تَستدعي تدخّلاً. */
export const CARRYOVER_ESCALATION = {
  /** تُبرَز في تقرير الإدارة عند هذا العدد المتتالي */
  highlightAfter: 2,
  /** تُرفَع للقرار التنفيذي عند هذا العدد */
  escalateAfter: 3,
} as const;

/** طاقةُ القسم الافتراضية بوحدات الوزن حين لا تُضبَط له طاقة.
 *
 *  وهي **تقديرٌ معلَنٌ لا قانون**: يُغيّرها قائدُ القسم أو الإدارة في
 *  صفّ الخطة. ووجودُها ضروريٌّ ليُقاس التحميلُ من أول أسبوع. */
export const DEFAULT_CAPACITY_POINTS = 12;

export type CarrySweepResult = {
  fromPeriodId: string;
  toPeriodId: string;
  carried: number;
  skipped: number;
  escalated: number;
};

/** يُرحّل ما لم يكتمل من فترةٍ إلى التي تليها — ويُغلِق الأولى.
 *
 *  **والكنسُ لا يَفتح شيئاً:** يُنشئ الفترةَ التالية إن لم تكن،
 *  ويُرحّل إليها، ويُغلق السابقة. أما الفتحُ فقرارٌ صريحٌ من الإدارة.
 *
 *  **ونداؤه مرّتين كنداؤه مرّة:** التفرّدُ على (المهمّة، الفترةِ
 *  المُرحَّلِ إليها) يَرفض الصفَّ الثاني، والعدّادُ لا يُزاد إلا مع
 *  كتابةِ صفِّ الترحيل في معاملةٍ واحدة. */
export async function sweepCarryover(opts: {
  /** الفترةُ التي انتهت — وإن لم تُمرَّر فُهمت الجاريةُ قبل الحاضرة */
  fromPeriodId?: string;
  now?: Date;
}): Promise<CarrySweepResult | null> {
  const now = opts.now ?? new Date();

  const from = opts.fromPeriodId
    ? await prisma.executionPeriod.findUnique({ where: { id: opts.fromPeriodId } })
    : await prisma.executionPeriod.findFirst({
        where: { weekStart: { lt: periodStartFor(now) }, state: { in: ["open", "reopened"] } },
        orderBy: { weekStart: "desc" },
      });
  if (!from) return null;

  const to = await ensurePeriod(
    // الفترةُ التالية لتلك لا التالية للآن: الكنسُ قد يتأخّر يوماً
    new Date(from.weekStart.getTime() + 7 * 86_400_000)
  );

  const outstanding = await prisma.planTask.findMany({
    where: { periodId: from.id, execState: { in: OUTSTANDING_STATES } },
    select: {
      id: true,
      departmentId: true,
      execState: true,
      consecutiveCarryover: true,
      carryoverCount: true,
    },
  });

  let carried = 0;
  let skipped = 0;
  let escalated = 0;

  for (const task of outstanding) {
    // خطةُ القسم في الفترة التالية — تُنشأ إن لم تكن، فلا يُرحَّل إلى عدم
    const plan = task.departmentId
      ? await ensureWeekPlan(to.id, task.departmentId)
      : null;

    try {
      await prisma.$transaction([
        prisma.taskCarryover.create({
          data: {
            taskId: task.id,
            fromPeriodId: from.id,
            toPeriodId: to.id,
            stateAtCarry: task.execState,
          },
        }),
        prisma.planTask.update({
          where: { id: task.id },
          data: {
            periodId: to.id,
            planId: plan?.id ?? null,
            carriedFromPeriodId: from.id,
            carryoverCount: { increment: 1 },
            consecutiveCarryover: { increment: 1 },
            // **السببُ وخطةُ التصحيح يُفرَّغان عمداً**: ما كُتب لأسبوعٍ
            // مضى لا يَصلح إقراراً لأسبوعٍ جديد، فيُطلَبان من جديد —
            // وهذا ما يَمنع الترحيلَ الصامت.
            carryReason: null,
            correctivePlan: null,
          },
        }),
      ]);
      carried++;
      if (task.consecutiveCarryover + 1 >= CARRYOVER_ESCALATION.escalateAfter) escalated++;
    } catch {
      // رُحِّلت سلفاً إلى هذه الفترة — الكنسُ لا يُكرِّر
      skipped++;
    }
  }

  await prisma.executionPeriod.updateMany({
    where: { id: from.id, state: { in: ["open", "reopened"] } },
    data: { state: "closed", closedAt: new Date(), closedByName: "الكنس اليومي" },
  });

  return { fromPeriodId: from.id, toPeriodId: to.id, carried, skipped, escalated };
}

/** خطةُ قسمٍ في فترة — تُنشأ إن لم تكن، ولا تُكرَّر */
export async function ensureWeekPlan(periodId: string, departmentId: string) {
  const existing = await prisma.weekPlan.findUnique({
    where: { periodId_departmentId: { periodId, departmentId } },
  });
  if (existing) return existing;
  try {
    return await prisma.weekPlan.create({
      data: { periodId, departmentId, capacityPoints: DEFAULT_CAPACITY_POINTS },
    });
  } catch {
    return prisma.weekPlan.findUniqueOrThrow({
      where: { periodId_departmentId: { periodId, departmentId } },
    });
  }
}

/** إقرارُ مُرحَّلٍ: سببُه وخطةُ تصحيحه — ولا تُعتمَد خطةٌ بدونهما */
export async function recordCarryoverPlan(opts: {
  taskId: string;
  reason: string;
  correctivePlan: string;
  session: Session;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const task = await prisma.planTask.findUnique({
    where: { id: opts.taskId },
    select: { id: true, departmentId: true, carryoverCount: true },
  });
  if (!task) return { ok: false, reason: "المهمّة غير موجودة" };
  if (task.carryoverCount === 0) {
    return { ok: false, reason: "هذه المهمّة لم تُرحَّل — ولا إقرارَ على جديد" };
  }
  if (!task.departmentId || !canPlanDepartment(opts.session, task.departmentId)) {
    return { ok: false, reason: "الإقرارُ لقائد القسم — ومن يعلوه" };
  }
  const reason = opts.reason.trim();
  const plan = opts.correctivePlan.trim();
  if (!reason) return { ok: false, reason: "سببُ عدم الاكتمال مطلوب" };
  if (!plan) return { ok: false, reason: "خطةُ التصحيح مطلوبة — الترحيلُ التزامٌ يُعاد إقرارُه" };

  await prisma.planTask.update({
    where: { id: task.id },
    data: { carryReason: reason, correctivePlan: plan },
  });
  return { ok: true };
}

export type CapacityReport = {
  planId: string;
  departmentId: string;
  capacityPoints: number;
  newPoints: number;
  carriedPoints: number;
  totalPoints: number;
  overloaded: boolean;
  /** المُرحَّلُ بلا سببٍ أو خطةِ تصحيح — يمنع الاعتماد */
  missingCorrective: { id: string; title: string; consecutive: number }[];
  /** ما بلغ عتبةَ التصعيد */
  escalated: { id: string; title: string; consecutive: number; total: number }[];
  /** مواعيدُ في الماضي داخل خطةٍ قادمة */
  pastDue: { id: string; title: string }[];
  blockers: string[];
};

/** يَقيس خطةَ قسمٍ قبل اعتمادها: الحِمل، والإقرارات، والتصعيد.
 *
 *  **ويُقاس الجديدُ والمُرحَّلُ معاً** — وهذا بيتُ القصيد: خطةٌ فيها
 *  ثلاثُ مهامٍّ جديدةٍ وثمانٍ مُرحَّلة ليست «ثلاثَ مهامّ». */
export async function assessWeekPlan(planId: string): Promise<CapacityReport | null> {
  const plan = await prisma.weekPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      departmentId: true,
      capacityPoints: true,
      overloadAcknowledged: true,
      period: { select: { weekStart: true, weekEnd: true } },
      tasks: {
        where: { execState: { notIn: ["waived", "cancelled", "superseded", "deferred"] } },
        select: {
          id: true,
          title: true,
          weight: true,
          dueAt: true,
          carryoverCount: true,
          consecutiveCarryover: true,
          carryReason: true,
          correctivePlan: true,
        },
      },
    },
  });
  if (!plan) return null;

  const capacity = plan.capacityPoints ?? DEFAULT_CAPACITY_POINTS;
  let newPoints = 0;
  let carriedPoints = 0;
  const missingCorrective: CapacityReport["missingCorrective"] = [];
  const escalated: CapacityReport["escalated"] = [];
  const pastDue: CapacityReport["pastDue"] = [];

  for (const t of plan.tasks) {
    const weight = Math.max(1, t.weight);
    if (t.carryoverCount > 0) {
      carriedPoints += weight;
      if (!t.carryReason?.trim() || !t.correctivePlan?.trim()) {
        missingCorrective.push({ id: t.id, title: t.title, consecutive: t.consecutiveCarryover });
      }
      if (t.consecutiveCarryover >= CARRYOVER_ESCALATION.escalateAfter) {
        escalated.push({
          id: t.id,
          title: t.title,
          consecutive: t.consecutiveCarryover,
          total: t.carryoverCount,
        });
      }
    } else {
      newPoints += weight;
    }
    // موعدٌ قبل بداية الأسبوع: التزامٌ لا يُمكن الوفاء به في أسبوعه
    if (t.dueAt < plan.period.weekStart) pastDue.push({ id: t.id, title: t.title });
  }

  const totalPoints = newPoints + carriedPoints;
  const overloaded = totalPoints > capacity;

  const blockers: string[] = [];
  if (missingCorrective.length > 0) {
    blockers.push(
      `${missingCorrective.length} مهمّةً مُرحَّلةً بلا سببٍ وخطةِ تصحيح — الترحيلُ التزامٌ يُعاد إقرارُه`
    );
  }
  if (overloaded && !plan.overloadAcknowledged) {
    blockers.push(
      `الحِملُ ${totalPoints} من طاقةٍ ${capacity} (${carriedPoints} منها مُرحَّل) — قسِّم أو أجِّل أو أقرَّ التحميل بسببٍ مكتوب`
    );
  }
  if (pastDue.length > 0) {
    blockers.push(`${pastDue.length} مهمّةً موعدُها قبل بداية الأسبوع — عدِّل الموعد بقرارٍ أو أجِّلها`);
  }
  if (escalated.length > 0) {
    blockers.push(
      `${escalated.length} مهمّةً بلغت ${CARRYOVER_ESCALATION.escalateAfter} ترحيلاتٍ متتالية — تحتاج قراراً تنفيذياً لا إقراراً جديداً`
    );
  }

  return {
    planId: plan.id,
    departmentId: plan.departmentId,
    capacityPoints: capacity,
    newPoints,
    carriedPoints,
    totalPoints,
    overloaded,
    missingCorrective,
    escalated,
    pastDue,
    blockers,
  };
}

/** رفعُ خطةِ قسمٍ للاعتماد — ولا تُرفَع وفيها مُرحَّلٌ بلا إقرار */
export async function submitWeekPlan(opts: {
  planId: string;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  const plan = await prisma.weekPlan.findUnique({
    where: { id: opts.planId },
    select: { id: true, departmentId: true, state: true },
  });
  if (!plan) return { ok: false, reason: "الخطة غير موجودة" };
  if (!canPlanDepartment(opts.session, plan.departmentId)) {
    return { ok: false, reason: "رفعُ خطة القسم لقائده — ومن يعلوه" };
  }
  if (plan.state === "submitted" || plan.state === "approved") {
    return { ok: true, message: "الخطةُ مرفوعةٌ سلفاً" };
  }

  const report = await assessWeekPlan(plan.id);
  const blocking = (report?.blockers ?? []).filter(
    (b) => !b.includes("قراراً تنفيذياً") // التصعيدُ يُعرَض ولا يَمنع الرفع
  );
  if (blocking.length > 0) {
    return { ok: false, reason: blocking.join(" — ") };
  }

  await prisma.weekPlan.updateMany({
    where: { id: plan.id, state: plan.state },
    data: {
      state: "submitted",
      submittedAt: new Date(),
      submittedByName: opts.session.user.name ?? "—",
    },
  });
  return { ok: true, message: "رُفعت خطةُ القسم للاعتماد التنفيذي" };
}

/** اعتمادُ خطةِ قسمٍ أو ردُّها — للتنفيذي ومعه المؤسس */
export async function decideWeekPlan(opts: {
  planId: string;
  decision: "approved" | "returned";
  note?: string | null;
  /** إقرارُ التحميل الزائد صراحةً — ولا يُعتمَد المُحمَّلُ بدونه */
  acknowledgeOverload?: boolean;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canGovernPeriod(opts.session.user.role)) {
    return { ok: false, reason: "اعتمادُ الخطط للمدير التنفيذي — ومعه المؤسس" };
  }
  const note = opts.note?.trim() || null;
  if (opts.decision === "returned" && !note) {
    return { ok: false, reason: "الردُّ لا يقع بلا سببٍ مكتوب" };
  }

  const plan = await prisma.weekPlan.findUnique({
    where: { id: opts.planId },
    select: { id: true, state: true, departmentId: true },
  });
  if (!plan) return { ok: false, reason: "الخطة غير موجودة" };

  if (opts.decision === "approved") {
    const report = await assessWeekPlan(plan.id);
    if (report) {
      if (report.missingCorrective.length > 0) {
        return {
          ok: false,
          reason: `لا تُعتمَد: ${report.missingCorrective.length} مهمّةً مُرحَّلةً بلا سببٍ وخطةِ تصحيح`,
        };
      }
      if (report.overloaded && !opts.acknowledgeOverload) {
        return {
          ok: false,
          reason: `الحِملُ ${report.totalPoints} من طاقةٍ ${report.capacityPoints} — أقرَّ التحميلَ صراحةً بسببٍ مكتوب، أو أعِد الخطةَ لتُقسَّم`,
        };
      }
    }
  }

  const written = await prisma.weekPlan.updateMany({
    where: { id: plan.id, state: plan.state },
    data: {
      state: opts.decision,
      approvedAt: opts.decision === "approved" ? new Date() : null,
      approvedByName: opts.decision === "approved" ? (opts.session.user.name ?? "—") : null,
      decisionNote: note,
      ...(opts.decision === "approved" && opts.acknowledgeOverload
        ? { overloadAcknowledged: true, overloadNote: note }
        : {}),
    },
  });
  if (written.count === 0) return { ok: false, reason: "تغيّرت حالةُ الخطة — أعِد المحاولة" };

  await prisma.workChange.create({
    data: {
      kind: "scope_change",
      reason: note ?? (opts.decision === "approved" ? "اعتماد خطة أسبوع" : "ردّ خطة أسبوع"),
      previousJson: { state: plan.state } as Prisma.InputJsonValue,
      nextJson: { state: opts.decision } as Prisma.InputJsonValue,
      actorId: opts.session.user.id,
      actorName: opts.session.user.name ?? "—",
    },
  });

  return {
    ok: true,
    message: opts.decision === "approved" ? "اعتُمدت خطةُ القسم" : "رُدَّت الخطةُ بسببها",
  };
}

/** تاريخُ ترحيلِ مهمّةٍ — يُقرأ في المراجعة ولا يُمحى */
export async function carryoverHistory(taskId: string) {
  return prisma.taskCarryover.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      stateAtCarry: true,
      reason: true,
      correctivePlan: true,
      createdAt: true,
      fromPeriod: { select: { weekStart: true } },
      toPeriod: { select: { weekStart: true } },
    },
  });
}

/** المُرحَّلُ المتكرّر على مستوى المنظمة — تقريرُ الإدارة */
export async function repeatedCarryovers(min = CARRYOVER_ESCALATION.highlightAfter) {
  return prisma.planTask.findMany({
    where: {
      consecutiveCarryover: { gte: min },
      execState: { in: OUTSTANDING_STATES },
    },
    orderBy: [{ consecutiveCarryover: "desc" }, { dueAt: "asc" }],
    select: {
      id: true,
      title: true,
      consecutiveCarryover: true,
      carryoverCount: true,
      originalDueAt: true,
      dueAt: true,
      execState: true,
      blockedReason: true,
      correctivePlan: true,
      department: { select: { id: true, name: true, colorHex: true } },
      ownerUser: { select: { fullName: true } },
      ownerMember: { select: { fullName: true } },
    },
    take: 50,
  });
}

/** هل حالةٌ ما تُعَدّ عملاً قائماً؟ — يُستعمَل في الواجهة والتقارير */
export function isOutstanding(state: TaskExecState) {
  return (OUTSTANDING_STATES as string[]).includes(state);
}

/** الفترةُ التالية كما تُقرأ قبل فتحها — للعرض لا للتعديل */
export async function nextPeriodPreview(now: Date = new Date()) {
  const next = await prisma.executionPeriod.findUnique({
    where: { weekStart: nextPeriodStartFor(now) },
    select: { id: true, state: true, weekStart: true, weekEnd: true },
  });
  return next;
}
