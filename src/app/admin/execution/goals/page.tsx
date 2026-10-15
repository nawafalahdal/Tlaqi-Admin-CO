import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { formatDate } from "@/lib/format";
import { canApproveGoal, approvedGoals, pendingProposals } from "@/lib/goals";
import { goalProgress } from "@/lib/progress";
import { countdownLabel } from "@/lib/riyadh";
import { ProgressBars } from "@/components/execution/ProgressBars";
import { GoalForm } from "./GoalForm";
import { MilestoneForm } from "./MilestoneForm";
import { ProposalDecision } from "./ProposalDecision";

export const dynamic = "force-dynamic";

/** الأهدافُ الاستراتيجية ومحطّاتُها — وطابورُ المقترَحات.
 *
 *  **والاقتراحُ يُفصَل عن الالتزام بصراحة:** ما اقترحه قائدُ قسمٍ يقف في
 *  طابورٍ منفصلٍ حتى يُقرَّر فيه، ولا يُقرأ في قائمة الأهداف المعتمَدة
 *  — فلا تُحسَب أمنيةٌ التزاماً.
 */
export default async function GoalsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === "member") redirect("/member");

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const canApprove = canApproveGoal(session.user.role);

  const [goals, proposals, leaders] = await Promise.all([
    approvedGoals(),
    pendingProposals(),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ["super_admin", "executive", "department_admin"] } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const rows = await Promise.all(
    goals.map(async (g) => ({ goal: g, progress: await goalProgress(g.id) }))
  );

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName="الأهداف الاستراتيجية" userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-7 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton fallbackHref="/admin/execution" />
          <h1 className="text-lg font-bold sm:text-xl">الأهدافُ الاستراتيجية ومحطّاتُها</h1>
          <p className="mt-1 text-sm leading-relaxed text-black/50">
            الهدفُ لا يصير التزاماً تنظيمياً إلا باعتماد الإدارة، والمحطّةُ نتيجةٌ تُسلَّم لا
            قسمةٌ حسابيةٌ للهدف — فلكلِّ محطّةٍ نتيجتُها ومعيارُ قبولها.
          </p>
        </div>

        {/* ── طابورُ المقترَحات */}
        {canApprove && (proposals.goals.length > 0 || proposals.objectives.length > 0) && (
          <section>
            <h2 className="mb-3 text-base font-bold">
              مقترَحاتٌ تنتظر قرارك ({proposals.goals.length + proposals.objectives.length})
            </h2>
            <div className="flex flex-col gap-3">
              {proposals.goals.map((g) => (
                <Card key={g.id} className="p-4">
                  <h3 className="text-sm font-bold">{g.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-black/55">
                    <span className="font-semibold">المسوّغ:</span> {g.rationale}
                  </p>
                  <p className="mt-1 text-[11px] text-black/40">
                    اقترحه {g.proposedByName} · الموعد {formatDate(g.dueDate)}
                  </p>
                  <ProposalDecision kind="goal" id={g.id} theme={theme} />
                </Card>
              ))}
              {proposals.objectives.map((o) => (
                <Card key={o.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold">{o.title}</h3>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        background: `${o.department.colorHex}1F`,
                        color: `light-dark(${o.department.colorHex}, var(--ink))`,
                      }}
                    >
                      {o.department.name}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-black/40">
                    اقترحه {o.proposedByName}
                    {o.goal ? ` · يخدم «${o.goal.title}»` : " · بلا هدفٍ تنظيميٍّ مرتبط"}
                    {o.dueDate ? ` · ${formatDate(o.dueDate)}` : ""}
                  </p>
                  <ProposalDecision kind="objective" id={o.id} theme={theme} />
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* ── الأهدافُ المعتمَدة */}
        <section>
          <h2 className="mb-3 text-base font-bold">الأهدافُ المعتمَدة ({rows.length})</h2>
          {rows.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">لا أهدافَ بعد.</Card>
          ) : (
            <div className="flex flex-col gap-4">
              {rows.map(({ goal, progress }) => (
                <Card key={goal.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-bold">{goal.title}</h3>
                    <span className="text-[11px] text-black/45">
                      {formatDate(goal.startDate)} ← {formatDate(goal.dueDate)} ·{" "}
                      {countdownLabel(goal.dueDate)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-black/60">{goal.description}</p>
                  <p className="mt-1 text-xs leading-relaxed text-black/55">
                    <span className="font-semibold">معيار النجاح:</span> {goal.successCriteria}
                  </p>
                  <div className="mt-3">
                    <ProgressBars b={progress} />
                  </div>

                  <div className="mt-3 border-t border-black/5 pt-3">
                    <h4 className="text-xs font-bold text-black/70">
                      المحطّاتُ الشهرية ({goal.milestones.length})
                    </h4>
                    {goal.milestones.length > 0 && (
                      <ol className="mt-2 flex flex-col gap-1.5">
                        {goal.milestones.map((m, i) => (
                          <li key={m.id} className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs">
                            <p className="font-semibold text-black/75">
                              {i + 1}. {m.title}
                            </p>
                            <p className="mt-0.5 text-black/55">{m.expectedResult}</p>
                            <p className="mt-0.5 text-[11px] text-black/40">
                              {formatDate(m.startDate)} ← {formatDate(m.dueDate)} ·{" "}
                              {countdownLabel(m.dueDate)}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                    {canApprove && (
                      <div className="mt-3">
                        <MilestoneForm goalId={goal.id} leaders={leaders} theme={theme} />
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── إنشاءُ هدف */}
        <section>
          <h2 className="mb-3 text-base font-bold">
            {canApprove ? "أنشئ هدفاً استراتيجياً" : "اقترح هدفاً"}
          </h2>
          <Card className="p-4 sm:p-5">
            <GoalForm canApprove={canApprove} leaders={leaders} theme={theme} />
          </Card>
        </section>
      </main>
    </div>
  );
}
