import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { formatDate } from "@/lib/format";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import {
  currentAndNextPeriod,
  canGovernPeriod,
  unresolvedReviewCount,
  stateLabel,
  periodLabel,
} from "@/lib/execution";
import { periodProgress } from "@/lib/progress";
import { repeatedCarryovers, assessWeekPlan, CARRYOVER_ESCALATION } from "@/lib/carryover";
import { approvedGoals, pendingProposals } from "@/lib/goals";
import { goalProgress } from "@/lib/progress";
import { upcomingMeetings, overdueMeetings } from "@/lib/reviewMeeting";
import { periodTasks } from "@/lib/executionViews";
import { PeriodControls } from "@/components/execution/PeriodControls";
import { ProgressBars } from "@/components/execution/ProgressBars";
import { TaskCard } from "@/components/execution/TaskCard";
import { PlanDecision } from "./PlanDecision";
import { countdownLabel } from "@/lib/riyadh";

export const dynamic = "force-dynamic";

/** لوحةُ التنفيذ التنفيذية — ما التزمت به المنظمة، وأين هي منه.
 *
 *  **ولا رقمَ واحدٌ يُقال هنا:** المعتمَدُ والمُعلَنُ شريطانِ فوق بعض،
 *  والمتأخّرُ والمعوَّقُ والمُرحَّلُ والمُسقَطُ شاراتٌ مفصولة. ومن أراد
 *  الحكمَ على أسبوعٍ فليقرأ مهامَّه — وهي معروضةٌ بأدلّتها لا ملخَّصةً
 *  في نسبة.
 */
export default async function ExecutionPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === "member") redirect("/member");

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const canGovern = canGovernPeriod(session.user.role);

  const { current, next } = await currentAndNextPeriod();

  const [
    currentProgress,
    nextProgress,
    currentTasks,
    repeated,
    goals,
    proposals,
    meetings,
    lateMeetings,
    unresolved,
    departments,
    plans,
    nextPlans,
  ] = await Promise.all([
    periodProgress(current.id),
    periodProgress(next.id),
    periodTasks(current.id),
    repeatedCarryovers(),
    approvedGoals(),
    pendingProposals(),
    upcomingMeetings(3),
    overdueMeetings(),
    unresolvedReviewCount(next.id),
    prisma.department.findMany({
      where: OPEN_DEPARTMENT_WHERE,
      select: { id: true, name: true, colorHex: true },
      orderBy: { name: "asc" },
    }),
    prisma.weekPlan.findMany({
      where: { periodId: current.id },
      select: {
        id: true,
        state: true,
        department: { select: { id: true, name: true, colorHex: true } },
      },
    }),
    prisma.weekPlan.findMany({
      where: { periodId: next.id },
      select: {
        id: true,
        state: true,
        submittedByName: true,
        decisionNote: true,
        overloadAcknowledged: true,
        department: { select: { id: true, name: true, colorHex: true } },
      },
    }),
  ]);

  // تقدُّمُ كل هدفٍ — يُحسَب من مهامِّه بلا تكرار
  const goalRows = await Promise.all(
    goals.map(async (g) => ({ goal: g, progress: await goalProgress(g.id) }))
  );
  // تقييمُ خطط الأسبوع القادم: الحِملُ والإقراراتُ قبل الاعتماد
  const nextAssessments = await Promise.all(
    nextPlans.map(async (p) => ({ plan: p, report: await assessWeekPlan(p.id) }))
  );

  const overdueTasks = currentTasks.filter((t) => t.overdue);
  const pendingVerify = currentTasks.filter((t) => t.execState === "submitted");
  const blockedTasks = currentTasks.filter((t) => t.execState === "blocked");

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName="التنفيذ الاستراتيجي" userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-7 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <h1 className="text-lg font-bold sm:text-xl">التنفيذ الاستراتيجي والمحاسبة الأسبوعية</h1>
          <p className="mt-1 text-sm leading-relaxed text-black/50">
            من الهدف إلى المحطّة إلى خطة الأسبوع إلى المهمّة إلى التسليم إلى التحقّق. والأسبوعُ
            لا يُفتَح بمرور التقويم بل بإذنٍ صريح، وما لم يكتمل لا يَضيع ولا يُعَدّ منجَزاً.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link
              href="/admin/execution/review"
              className="rounded-xl px-3.5 py-2 font-bold text-on-brand"
              style={{ background: theme.accentDark }}
            >
              مساحةُ مراجعة السبت ←
            </Link>
            <Link
              href="/admin/execution/goals"
              className="rounded-xl border border-black/10 px-3.5 py-2 font-bold text-black/70"
            >
              الأهدافُ والمحطّات ←
            </Link>
            <Link
              href="/calendar"
              className="rounded-xl border border-black/10 px-3.5 py-2 font-bold text-black/70"
            >
              التقويم ←
            </Link>
          </div>
        </div>

        {/* ── الأسبوعان: الجاري والقادم */}
        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold">
                الأسبوع الجاري · {formatDate(current.weekStart)}
              </h2>
              <span className="text-[11px] text-black/45">{stateLabel(current.state)}</span>
            </div>
            <ProgressBars b={currentProgress} />
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold">
                الأسبوع القادم · {formatDate(next.weekStart)}
              </h2>
              <span className="text-[11px] text-black/45">{periodLabel(next.weekStart)}</span>
            </div>
            <PeriodControls
              periodId={next.id}
              state={next.state}
              canGovern={canGovern}
              unresolved={unresolved}
              theme={theme}
            />
            {next.emergencyOpen && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                فُتح استثناءً: {next.emergencyReason} — وبقي {next.unresolvedAtOpen} بنداً بلا
                قرارٍ وهي قائمةٌ لم تُمحَ.
              </p>
            )}
            <div className="mt-3">
              <ProgressBars b={nextProgress} label="خطةُ الأسبوع القادم" />
            </div>
          </Card>
        </section>

        {/* ── خططُ الأقسام للأسبوع القادم: الحِملُ قبل الاعتماد */}
        <section>
          <h2 className="mb-1 text-base font-bold">خططُ الأقسام للأسبوع القادم</h2>
          <p className="mb-3 text-xs leading-relaxed text-black/50">
            الحِملُ يُجمَع — جديدٌ ومُرحَّلٌ معاً — ويُقارَن بطاقة القسم. ولا تُعتمَد خطةٌ فيها
            مُرحَّلٌ بلا سببٍ وخطةِ تصحيح، ولا خطةٌ متجاوزةٌ للطاقة إلا بإقرارٍ مكتوب.
          </p>
          {nextAssessments.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">
              لا خططَ بعد — تُنشأ من لوحة كل قسم.
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {nextAssessments.map(({ plan, report }) => (
                <Card key={plan.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: plan.department.colorHex }}
                        aria-hidden
                      />
                      <h3 className="text-sm font-bold">{plan.department.name}</h3>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        plan.state === "approved"
                          ? "bg-emerald-100 text-emerald-900"
                          : plan.state === "submitted"
                            ? "bg-amber-100 text-amber-900"
                            : plan.state === "returned"
                              ? "bg-red-50 text-red-700"
                              : "bg-black/[0.06] text-black/60"
                      }`}
                    >
                      {plan.state === "approved"
                        ? "معتمَدة"
                        : plan.state === "submitted"
                          ? "مرفوعةٌ للاعتماد"
                          : plan.state === "returned"
                            ? "مردودة"
                            : "قيد البناء"}
                    </span>
                  </div>

                  {report && (
                    <>
                      <p className="mt-2 text-xs text-black/55">
                        الحِمل {report.totalPoints} من طاقةٍ {report.capacityPoints} — جديدٌ{" "}
                        {report.newPoints} ومُرحَّلٌ {report.carriedPoints}
                        {report.overloaded ? " · متجاوِز" : ""}
                      </p>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.07]">
                        <div
                          className={`h-full ${report.overloaded ? "bg-red-500" : "bg-emerald-500"}`}
                          style={{
                            width: `${Math.min(100, Math.round((100 * report.totalPoints) / Math.max(1, report.capacityPoints)))}%`,
                          }}
                          aria-hidden
                        />
                      </div>
                      {report.blockers.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                          {report.blockers.map((b, i) => (
                            <li
                              key={i}
                              className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900"
                            >
                              {b}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  {plan.decisionNote && (
                    <p className="mt-2 text-[11px] text-black/45">ملاحظةُ القرار: {plan.decisionNote}</p>
                  )}

                  {canGovern && plan.state === "submitted" && (
                    <PlanDecision
                      planId={plan.id}
                      overloaded={Boolean(report?.overloaded)}
                      theme={theme}
                    />
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── ما يحتاج قراراً الآن */}
        {(pendingVerify.length > 0 || overdueTasks.length > 0 || blockedTasks.length > 0) && (
          <section>
            <h2 className="mb-3 text-base font-bold">ما يحتاج قراراً الآن</h2>
            <div className="flex flex-col gap-3">
              {pendingVerify.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  theme={theme}
                  can={{ work: false, review: canGovern, carryPlan: false }}
                />
              ))}
              {blockedTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  theme={theme}
                  can={{ work: false, review: canGovern, carryPlan: false }}
                />
              ))}
              {overdueTasks
                .filter((t) => t.execState !== "submitted" && t.execState !== "blocked")
                .map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    theme={theme}
                    can={{ work: false, review: canGovern, carryPlan: false }}
                  />
                ))}
            </div>
          </section>
        )}

        {/* ── الترحيلُ المتكرّر */}
        <section>
          <h2 className="mb-1 text-base font-bold">الترحيلُ المتكرّر</h2>
          <p className="mb-3 text-xs leading-relaxed text-black/50">
            ما بلغ {CARRYOVER_ESCALATION.escalateAfter} ترحيلاتٍ متتالية يحتاج قراراً تنفيذياً لا
            إقراراً جديداً: تقليلُ نطاق، أو نقلُ مسؤولية، أو موعدٌ جديد، أو إسقاطُ الالتزام.
            والتكرارُ لا يُقرَأ سوءَ نيّة — قد يكون تبعيّةً أو طاقةً ناقصة.
          </p>
          {repeated.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">
              لا التزامَ تكرّر ترحيلُه — وهذه حالٌ تُشكَر لا تُفترَض.
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {repeated.map((r) => (
                <Card key={r.id} className="p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">{r.title}</h3>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                      {r.consecutiveCarryover} متتالية · {r.carryoverCount} إجمالاً
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-black/50">
                    {r.department?.name ?? "—"} ·{" "}
                    {r.ownerUser?.fullName ?? r.ownerMember?.fullName ?? "بلا صاحب"} · الموعد
                    الأصلي {formatDate(r.originalDueAt)} · {countdownLabel(r.dueAt)}
                  </p>
                  {r.blockedReason && (
                    <p className="mt-1 text-xs text-red-700">المعوّق: {r.blockedReason}</p>
                  )}
                  {r.correctivePlan && (
                    <p className="mt-1 text-xs text-black/55">التصحيح المُقَرّ: {r.correctivePlan}</p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── الأهداف */}
        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold">الأهدافُ المعتمَدة ({goalRows.length})</h2>
            <Link href="/admin/execution/goals" className="text-xs font-bold underline">
              الإدارةُ والمقترَحات
              {proposals.goals.length + proposals.objectives.length > 0
                ? ` (${proposals.goals.length + proposals.objectives.length} بانتظارك)`
                : ""}{" "}
              ←
            </Link>
          </div>
          {goalRows.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">
              لا أهدافَ معتمَدةً بعد — تُنشأ من صفحة الأهداف.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {goalRows.map(({ goal, progress }) => (
                <Card key={goal.id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold">{goal.title}</h3>
                    <span className="text-[11px] text-black/45">
                      {formatDate(goal.dueDate)} · {countdownLabel(goal.dueDate)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-black/55">
                    <span className="font-semibold">معيار النجاح:</span> {goal.successCriteria}
                  </p>
                  <p className="mt-1 text-[11px] text-black/40">
                    {goal.accountable?.fullName ? `المسؤول: ${goal.accountable.fullName}` : ""}
                    {goal.owner?.fullName ? ` · المالك: ${goal.owner.fullName}` : ""} ·{" "}
                    {goal.milestones.length} محطّة · {goal._count.tasks} مهمّة
                  </p>
                  <div className="mt-2.5">
                    <ProgressBars b={progress} />
                  </div>
                  {goal.milestones.length > 0 && (
                    <ol className="mt-3 flex flex-col gap-1.5 border-t border-black/5 pt-2.5">
                      {goal.milestones.map((m, i) => (
                        <li key={m.id} className="text-xs text-black/60">
                          <span className="font-bold">{i + 1}.</span> {m.title} — {m.expectedResult}{" "}
                          <span className="text-black/40">
                            ({formatDate(m.dueDate)} · {countdownLabel(m.dueDate)})
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── الاجتماعات */}
        <section>
          <h2 className="mb-3 text-base font-bold">اجتماعاتُ المراجعة</h2>
          {lateMeetings.length > 0 && (
            <Card className="mb-3 p-4">
              <p className="text-sm font-bold text-amber-900">
                {lateMeetings.length} اجتماعٌ مستحقٌّ لم يُعلَن انعقادُه
              </p>
              <p className="mt-1 text-xs leading-relaxed text-black/55">
                ومرورُ الموعد لا يَعقد اجتماعاً: يبقى مستحقّاً ظاهراً حتى يُعلَن انعقادُه أو
                يُؤجَّل.
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {lateMeetings.map((m) => (
                  <li key={m.id} className="text-xs text-black/60">
                    {formatDate(m.scheduledAt)} — أسبوعُ {formatDate(m.period.weekStart)}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {meetings.map((m) => (
              <Card key={m.id} className="p-4">
                <p className="text-sm font-bold">{formatDate(m.scheduledAt)}</p>
                <p className="mt-1 text-xs text-black/50">
                  {m.durationMinutes} دقيقة · أسبوعُ {formatDate(m.period.weekStart)}
                </p>
                {m.locationOrUrl && (
                  <a
                    href={m.locationOrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs font-bold underline"
                  >
                    رابطُ الاجتماع ←
                  </a>
                )}
              </Card>
            ))}
            {meetings.length === 0 && (
              <Card className="p-6 text-center text-sm text-black/45 sm:col-span-3">
                لا اجتماعاتٍ مجدولة — تُنشأ مع فترة الأسبوع.
              </Card>
            )}
          </div>
        </section>

        <Card className="p-4 text-xs leading-relaxed text-black/50">
          الأقسامُ العاملة: {departments.map((d) => d.name).join("، ")} — ولكلِّ قسمٍ خطتُه
          الأسبوعية في لوحته، يبنيها قائدُه ويعتمدها التنفيذي.
        </Card>
      </main>
    </div>
  );
}
