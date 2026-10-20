import { prisma } from "@/lib/prisma";

/** الأهدافُ في مراجعة السبت — ما أُنجز منها، وما بقي، وما رُحِّل.
 *
 *  كانت المراجعةُ تقرأ الأسبوعَ مهامَّ: المنجَز والمتأخّر والمُرحَّل. فيعرف
 *  الرئيسُ التنفيذي ما جرى في الأسبوع، ولا يعرف ما جرى **لكلّ هدف** — وهو
 *  السؤالُ الذي تُعقد المراجعةُ من أجله: أين وصلنا من أهدافنا؟
 *
 *  فهذا يُعيد قراءةَ المهامّ نفسها مجمّعةً بالهدف. ولا يُحسَب شيءٌ تقديراً:
 *  المنجَزُ ما تحقّقت منه المراجعة (`verified`)، والمُرحَّلُ ما سُجِّل له ترحيلٌ
 *  من الأسبوع المُراجَع (`TaskCarryover`)، والباقي ما لم يُغلق بعد. */

const OPEN_STATES = ["not_started", "in_progress", "submitted", "returned", "incomplete", "blocked"] as const;

export type GoalWeekRow = {
  id: string;
  title: string;
  dueDate: Date;
  owner: string | null;
  /** في الأسبوع المُراجَع */
  doneThisWeek: number;
  awaitingVerify: number;
  unfinishedThisWeek: number;
  carriedToNext: number;
  /** على مدى الهدف كلّه */
  doneTotal: number;
  remainingTotal: number;
  nextMilestone: { title: string; dueDate: Date } | null;
};

export async function goalWeekSummary(reviewedPeriodId: string | null): Promise<GoalWeekRow[]> {
  const goals = await prisma.strategicGoal.findMany({
    where: { status: { in: ["approved", "active"] } },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    select: {
      id: true,
      title: true,
      dueDate: true,
      accountable: { select: { fullName: true } },
      owner: { select: { fullName: true } },
      milestones: {
        where: { dueDate: { gte: new Date() } },
        orderBy: { dueDate: "asc" },
        take: 1,
        select: { title: true, dueDate: true },
      },
    },
  });
  if (goals.length === 0) return [];
  const ids = goals.map((g) => g.id);

  // المهمّةُ تتبع الهدفَ مباشرةً أو عبر محطّته أو هدفِ قسمه — والثلاثةُ تُقرأ
  const [tasks, carried] = await Promise.all([
    prisma.planTask.findMany({
      where: {
        OR: [
          { goalId: { in: ids } },
          { milestone: { goalId: { in: ids } } },
          { objective: { goalId: { in: ids } } },
        ],
        execState: { notIn: ["cancelled", "superseded"] },
      },
      select: {
        id: true,
        goalId: true,
        periodId: true,
        execState: true,
        milestone: { select: { goalId: true } },
        objective: { select: { goalId: true } },
      },
    }),
    reviewedPeriodId
      ? prisma.taskCarryover.findMany({ where: { fromPeriodId: reviewedPeriodId }, select: { taskId: true } })
      : Promise.resolve([]),
  ]);
  const carriedIds = new Set(carried.map((c) => c.taskId));

  const byGoal = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const g = t.goalId ?? t.milestone?.goalId ?? t.objective?.goalId;
    if (!g) continue;
    byGoal.set(g, [...(byGoal.get(g) ?? []), t]);
  }

  return goals.map((g) => {
    const list = byGoal.get(g.id) ?? [];
    const inWeek = reviewedPeriodId ? list.filter((t) => t.periodId === reviewedPeriodId) : [];
    const open = (s: string) => (OPEN_STATES as readonly string[]).includes(s);
    return {
      id: g.id,
      title: g.title,
      dueDate: g.dueDate,
      owner: g.accountable?.fullName ?? g.owner?.fullName ?? null,
      doneThisWeek: inWeek.filter((t) => t.execState === "verified").length,
      awaitingVerify: inWeek.filter((t) => t.execState === "submitted").length,
      unfinishedThisWeek: inWeek.filter((t) => open(t.execState) && t.execState !== "submitted").length,
      carriedToNext: list.filter((t) => carriedIds.has(t.id)).length,
      doneTotal: list.filter((t) => t.execState === "verified").length,
      remainingTotal: list.filter((t) => open(t.execState)).length,
      nextMilestone: g.milestones[0] ?? null,
    };
  });
}
