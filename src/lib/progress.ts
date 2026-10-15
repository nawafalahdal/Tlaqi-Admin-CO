import { prisma } from "@/lib/prisma";
import type { TaskExecState } from "@prisma/client";
import { isOverdue } from "@/lib/tasks";

/** قياسُ الإنجاز — ورقمٌ واحدٌ لا يُقال.
 *
 *  ## لماذا لا رقمَ واحد
 *
 *  «٧٠٪ منجَز» جملةٌ تُخفي أكثر ممّا تقول: أهي سبعون تحقّق منها
 *  التنفيذي، أم سبعون أعلنها أصحابُها؟ وأين المعوَّق؟ وكم مُرحَّل؟
 *  فالمقاييسُ تُعرَض **مفصولةً**: ما تُحقِّق منه، وما أُعلن ولم يُراجَع
 *  بعد، والمتأخّر، والمعوَّق، والمُرحَّل، والمُسقَط. ومن أراد رقماً
 *  واحداً فهو **المتحقَّقُ منه** وحده.
 *
 *  ## والمُسقَطُ لا يُحتسَب في المقام ولا في البسط
 *
 *  لو حُسب المُسقَطُ منجَزاً لأمكن بلوغُ المئة بإسقاط ما لم يُنجَز. ولو
 *  حُسب في المقام مهمّةً قائمةً لظُلم القسمُ بما أُسقط عنه بقرارِ
 *  الإدارة نفسِها. فيُطرَح من الحساب ويُعرَض وحده — وهذا معنى
 *  «المؤهَّلة» (`eligible`) في الصيغة.
 *
 *  ## والوزنُ يُحسَب مرّةً واحدة
 *
 *  المهمّةُ صفٌّ واحد، فجمعُ أوزان مهامِّ أسبوعٍ لا يُكرِّر شيئاً.
 *  وتقدُّمُ الهدف يُجمَع من مهامِّه **بمعرّفاتها** لا من مجموع تقدُّم
 *  محطّاته (وإلا حُسبت المهمّةُ المشتركة مرّتين). */

export type ProgressBreakdown = {
  /** المؤهَّلة للحساب: كلُّ ما لم يُسقَط بقرار */
  eligibleTasks: number;
  eligibleWeight: number;
  verifiedTasks: number;
  verifiedWeight: number;
  /** أُعلن إنجازُها وتنتظر التحقّق — ولا تُحتسَب */
  pendingReview: number;
  returned: number;
  incomplete: number;
  blocked: number;
  overdue: number;
  carried: number;
  notStarted: number;
  inProgress: number;
  /** المُسقَط بقرار — خارج الحساب، ويُعرَض وحده */
  waived: number;
  cancelled: number;
  deferred: number;
  superseded: number;
  /** النسبةُ المعتمَدة: وزنُ المتحقَّق منه ÷ وزنُ المؤهَّل. و`null` إذا لا مؤهَّل */
  verifiedPercent: number | null;
  /** النسبةُ المُعلَنة: المتحقَّقُ منه + ما يَنتظر التحقّق — تُقرأ بجانبها لا مكانها */
  reportedPercent: number | null;
};

const OUT_OF_SCOPE: TaskExecState[] = ["waived", "cancelled", "superseded", "deferred"];

type TaskRow = {
  weight: number;
  execState: TaskExecState;
  dueAt: Date;
  carryoverCount: number;
};

/** يَحسب التفصيلَ من صفوفٍ معلومة — دالّةٌ خالصةٌ تُختبَر بلا قاعدة */
export function breakdownOf(tasks: TaskRow[], now: Date = new Date()): ProgressBreakdown {
  const b: ProgressBreakdown = {
    eligibleTasks: 0,
    eligibleWeight: 0,
    verifiedTasks: 0,
    verifiedWeight: 0,
    pendingReview: 0,
    returned: 0,
    incomplete: 0,
    blocked: 0,
    overdue: 0,
    carried: 0,
    notStarted: 0,
    inProgress: 0,
    waived: 0,
    cancelled: 0,
    deferred: 0,
    superseded: 0,
    verifiedPercent: null,
    reportedPercent: null,
  };

  let reportedWeight = 0;

  for (const t of tasks) {
    const weight = Math.max(1, t.weight);

    if (OUT_OF_SCOPE.includes(t.execState)) {
      if (t.execState === "waived") b.waived++;
      else if (t.execState === "cancelled") b.cancelled++;
      else if (t.execState === "deferred") b.deferred++;
      else b.superseded++;
      continue; // خارج البسط والمقام معاً
    }

    b.eligibleTasks++;
    b.eligibleWeight += weight;
    if (t.carryoverCount > 0) b.carried++;
    if (isOverdue(t, now)) b.overdue++;

    switch (t.execState) {
      case "verified":
        b.verifiedTasks++;
        b.verifiedWeight += weight;
        reportedWeight += weight;
        break;
      case "submitted":
        b.pendingReview++;
        // المُعلَنُ يَدخل النسبةَ المُعلَنة وحدها
        reportedWeight += weight;
        break;
      case "returned":
        b.returned++;
        break;
      case "incomplete":
        b.incomplete++;
        break;
      case "blocked":
        b.blocked++;
        break;
      case "in_progress":
        b.inProgress++;
        break;
      default:
        b.notStarted++;
    }
  }

  if (b.eligibleWeight > 0) {
    b.verifiedPercent = Math.round((100 * b.verifiedWeight) / b.eligibleWeight);
    b.reportedPercent = Math.round((100 * reportedWeight) / b.eligibleWeight);
  }
  return b;
}

/** تقدُّمُ فترةٍ — **بما التُزِم فيها لا بما بقي فيها**.
 *
 *  **عطبٌ كشفه الفحص:** المهمّةُ صفٌّ واحدٌ يَعبر الأسابيع، فحين تُرحَّل
 *  ينتقل `periodId` إلى الأسبوع التالي — فيُقرأ تقريرُ الأسبوع المُغلَق
 *  وقد **نقص منه** ما رُحِّل عنه. فيبدو أسبوعٌ التزم بأربع مهامٍّ وأنجز
 *  ثلاثاً كأنه التزم بثلاثٍ وأنجزها كلَّها — وهذا يُجمّل التاريخ بعد
 *  وقوعه، وهو بالضبط ما تَمنعه المواصفة (البند ٢١).
 *
 *  والحلُّ **اشتقاقٌ لا نسخة**: صفوفُ الترحيل تحفظ ما خرج من كل فترة
 *  وحالتَه لحظةَ خروجه، فيُجمَع إليها من بقي. فالأسبوعُ المُغلَق يُقرأ
 *  أبداً كما كان: أربعُ مهامٍّ ثلاثٌ منها منجَزةٌ وواحدةٌ خرجت غيرَ
 *  مكتملة. ولا جدولَ لقطاتٍ يُصان ويُزامَن. */
export async function periodProgress(periodId: string, departmentId?: string | null) {
  const [resident, carriedOut] = await Promise.all([
    prisma.planTask.findMany({
      where: { periodId, ...(departmentId ? { departmentId } : {}) },
      select: { weight: true, execState: true, dueAt: true, carryoverCount: true },
    }),
    // ما خرج من هذه الفترة بالترحيل — بحالته يومَ خرج
    prisma.taskCarryover.findMany({
      where: {
        fromPeriodId: periodId,
        ...(departmentId ? { task: { departmentId } } : {}),
      },
      select: {
        stateAtCarry: true,
        task: { select: { weight: true, dueAt: true, originalDueAt: true } },
      },
    }),
  ]);

  const historical = carriedOut.map((c) => ({
    weight: c.task.weight,
    execState: c.stateAtCarry,
    // التأخّرُ في أسبوعه يُقاس بموعده الأصلي: التمديدُ اللاحق لا
    // يُبيّض أسبوعاً مضى
    dueAt: c.task.originalDueAt,
    // خرجت بالترحيل، فهي في قراءة ذلك الأسبوع «قائمةٌ لم تكتمل»
    carryoverCount: 0,
  }));

  return breakdownOf([...resident, ...historical]);
}

/** تقدُّمُ هدفٍ استراتيجي — **من مهامِّه لا من مجموع محطّاته**.
 *
 *  ولو جُمع من المحطّات لَحُسبت المهمّةُ المشتركةُ بين محطّتين مرّتين.
 *  فالجمعُ على المهامّ بمعرّفاتها: كلُّ مهمّةٍ مرّةً واحدة. */
export async function goalProgress(goalId: string) {
  const tasks = await prisma.planTask.findMany({
    where: {
      OR: [
        { goalId },
        { milestone: { goalId } },
        { objective: { goalId } },
      ],
    },
    // المعرّفُ يُنتقى ليُستبعَد التكرار: مهمّةٌ تتبع الهدفَ ومحطّتَه معاً
    // تَرِد مرّةً واحدة لأن الاستعلام على صفوفٍ لا على علاقات
    select: { id: true, weight: true, execState: true, dueAt: true, carryoverCount: true },
    distinct: ["id"],
  });
  return breakdownOf(tasks);
}

/** تقدُّمُ محطّةٍ شهرية */
export async function milestoneProgress(milestoneId: string) {
  const tasks = await prisma.planTask.findMany({
    where: { milestoneId },
    select: { weight: true, execState: true, dueAt: true, carryoverCount: true },
  });
  return breakdownOf(tasks);
}

/** تقدُّمُ هدفِ قسم */
export async function objectiveProgress(objectiveId: string) {
  const tasks = await prisma.planTask.findMany({
    where: { objectiveId },
    select: { weight: true, execState: true, dueAt: true, carryoverCount: true },
  });
  return breakdownOf(tasks);
}

/** حِملُ شخصٍ: ما عليه الآن بأوزانه — لقياس الطاقة لا للمحاسبة */
export async function personWorkload(opts: { userId?: string; memberId?: string }) {
  const tasks = await prisma.planTask.findMany({
    where: {
      ...(opts.userId ? { ownerUserId: opts.userId } : {}),
      ...(opts.memberId ? { ownerMemberId: opts.memberId } : {}),
      execState: { notIn: OUT_OF_SCOPE },
    },
    select: { weight: true, execState: true, dueAt: true, carryoverCount: true },
  });
  return breakdownOf(tasks);
}

/** نصُّ المقاييس كما تُعرَض — فلا تُختصَر في رقمٍ يَكذب */
export function progressSummary(b: ProgressBreakdown): string {
  if (b.eligibleTasks === 0) return "لا التزاماتٍ مؤهَّلةً للقياس";
  const parts = [`متحقَّقٌ منه ${b.verifiedPercent}٪`];
  if (b.pendingReview > 0) parts.push(`${b.pendingReview} بانتظار التحقّق`);
  if (b.overdue > 0) parts.push(`${b.overdue} متأخّرة`);
  if (b.blocked > 0) parts.push(`${b.blocked} معوَّقة`);
  if (b.carried > 0) parts.push(`${b.carried} مُرحَّلة`);
  if (b.waived + b.cancelled + b.deferred + b.superseded > 0) {
    parts.push(`${b.waived + b.cancelled + b.deferred + b.superseded} مُسقَطةٌ بقرار (خارج الحساب)`);
  }
  return parts.join(" · ");
}
