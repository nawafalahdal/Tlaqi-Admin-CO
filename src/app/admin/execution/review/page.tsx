import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { formatDate } from "@/lib/format";
import { goalWeekSummary } from "@/lib/goalReview";
import { canGovernPeriod, currentAndNextPeriod, stateLabel } from "@/lib/execution";
import { assembleAgenda, meetingSettings } from "@/lib/reviewMeeting";
import { periodProgress } from "@/lib/progress";
import { periodTasks } from "@/lib/executionViews";
import { ProgressBars } from "@/components/execution/ProgressBars";
import { TaskCard } from "@/components/execution/TaskCard";
import { AgendaBoard } from "./AgendaBoard";
import { MeetingSettingsForm } from "./MeetingSettingsForm";
import { countdownLabel } from "@/lib/riyadh";

export const dynamic = "force-dynamic";

/** مساحةُ مراجعة السبت — عشرُ مراحلَ على بياناتٍ حقيقية.
 *
 *  **والمُراجِعُ يَفحص المهامَّ نفسَها لا نسبةً:** كلُّ تسليمٍ معروضٌ
 *  بدليله وبزرِّ قرارٍ بجانبه. ونسبةُ الأسبوع تُعرَض فوقها — لا بدلاً
 *  منها.
 */
export default async function ReviewPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!canGovernPeriod(session.user.role)) redirect("/admin");

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const { next } = await currentAndNextPeriod();

  const [agenda, settings] = await Promise.all([assembleAgenda(next.id), meetingSettings()]);
  if (!agenda) redirect("/admin/execution");

  const prev = agenda.previousPeriod;
  const [prevTasks, prevProgress, decisions, goalRows] = await Promise.all([
    prev ? periodTasks(prev.id) : Promise.resolve([]),
    prev ? periodProgress(prev.id) : Promise.resolve(null),
    agenda.meeting
      ? prisma.meetingDecision.findMany({
          where: { meetingId: agenda.meeting.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, text: true, dueAt: true, createdByName: true, createdAt: true },
        })
      : Promise.resolve([]),
    goalWeekSummary(prev?.id ?? null),
  ]);

  const submitted = prevTasks.filter((t) => t.execState === "submitted");
  const unfinished = prevTasks.filter((t) =>
    ["not_started", "in_progress", "returned", "incomplete", "blocked"].includes(t.execState)
  );
  const waived = prevTasks.filter((t) =>
    ["waived", "cancelled", "superseded", "deferred"].includes(t.execState)
  );

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName="مراجعة السبت" userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-7 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton fallbackHref="/admin/execution" />
          <PageHeader title="مراجعةُ السبت" description={<>أسبوعٌ يُراجَع ({prev ? formatDate(prev.weekStart) : "لا أسبوعَ سابق"}) وأسبوعٌ
            يُفتَح ({formatDate(next.weekStart)} — {stateLabel(next.state)}). والإذنُ بالفتح آخرُ
            المراحل لا أوّلُها.</>} />
          {agenda.meeting && (
            <p className="mt-2 text-xs text-black/45">
              الاجتماع: {formatDate(agenda.meeting.scheduledAt)} ·{" "}
              {agenda.meeting.durationMinutes} دقيقة ·{" "}
              {agenda.meeting.status === "held" ? "انعقد" : "لم يُعلَن انعقادُه بعد"}
              {agenda.meeting.locationOrUrl ? " · " : ""}
              {agenda.meeting.locationOrUrl && (
                <a
                  href={agenda.meeting.locationOrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline"
                >
                  رابطُ الاجتماع
                </a>
              )}
            </p>
          )}
        </div>

        {/* ── الأجندة: مراحلُها تُعلَّم صراحةً */}
        <section>
          <Card className="p-4 sm:p-5">
            <AgendaBoard
              periodId={next.id}
              stages={agenda.stages.map((s) => ({ key: s.key, label: s.label, done: s.done }))}
              unresolved={agenda.unresolved}
              meetingHeld={agenda.meeting?.status === "held"}
              decisions={decisions.map((d) => ({
                id: d.id,
                text: d.text,
                dueAt: d.dueAt ? d.dueAt.toISOString() : null,
                createdByName: d.createdByName,
              }))}
              theme={theme}
            />
          </Card>
        </section>

        {/* ── ١) التزاماتُ الأسبوع الماضي */}
        {prev && prevProgress && (
          <section>
            <h2 className="mb-1 text-base font-bold">
              ١ · التزاماتُ الأسبوع الماضي ({prevTasks.length})
            </h2>
            <p className="mb-3 text-xs leading-relaxed text-black/50">
              ما التُزم به في أسبوعٍ يُقرأ فيه أبداً — ولو رُحِّل منه عملٌ إلى غيره.
            </p>
            <Card className="p-4 sm:p-5">
              <ProgressBars b={prevProgress} label="حصيلةُ الأسبوع المُراجَع" />
            </Card>
          </section>
        )}

        {/* ── الأهداف: ما أُنجز منها هذا الأسبوع، وما بقي، وما يُرحَّل للقادم.
            المراجعةُ تُقرأ مهامَّ في الأقسام التالية؛ وهذا جوابُ سؤالها الأوّل
            مجمّعاً بالهدف — من المهامّ نفسها لا من تقدير. */}
        <section>
          <h2 className="mb-1 text-base font-bold">الأهداف — المنجَز والباقي والمُرحَّل ({goalRows.length})</h2>
          <p className="mb-3 text-xs leading-relaxed text-black/50">
            لكل هدفٍ معتمَد: ما تحقّقت منه المراجعة في الأسبوع المُراجَع، وما ينتظر التحقّق، وما لم يكتمل، وما رُحِّل
            إلى الأسبوع القادم — ثم حصيلتُه منذ بدأ.
          </p>
          {goalRows.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">لا أهدافَ معتمَدةً بعد.</Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {goalRows.map((g) => (
                <Card key={g.id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold">{g.title}</h3>
                    <span className="text-[11px] text-black/45">
                      {g.owner ? `${g.owner} · ` : ""}موعده {formatDate(g.dueDate)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      ["أُنجز هذا الأسبوع", g.doneThisWeek, "text-green-800"],
                      ["ينتظر التحقّق", g.awaitingVerify, "text-black/70"],
                      ["لم يكتمل", g.unfinishedThisWeek, g.unfinishedThisWeek > 0 ? "text-red-800" : "text-black/70"],
                      ["رُحِّل للقادم", g.carriedToNext, g.carriedToNext > 0 ? "text-amber-900" : "text-black/70"],
                    ].map(([label, v, cls]) => (
                      <div key={label as string} className="rounded-xl bg-black/[0.03] px-2 py-2">
                        <dd className={`text-lg font-bold ${cls}`}>{v}</dd>
                        <dt className="text-[11px] leading-tight text-black/50">{label}</dt>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2.5 text-xs text-black/55">
                    منذ بدأ: <b>{g.doneTotal}</b> منجَزة · <b>{g.remainingTotal}</b> باقية
                    {g.nextMilestone
                      ? ` · المحطة القادمة: ${g.nextMilestone.title} (${formatDate(g.nextMilestone.dueDate)})`
                      : ""}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── ٢/٣) التسليماتُ وأدلّتُها والتحقّق */}
        <section>
          <h2 className="mb-1 text-base font-bold">
            ٢–٣ · التسليماتُ بانتظار التحقّق ({submitted.length})
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-black/50">
            اطّلِع على الدليل ثم قرِّر: تحقُّقٌ، أو ردٌّ بسبب، أو عدمُ اكتمال. ولا تُحتسَب
            مهمّةٌ إنجازاً قبل قرارك — والتسليمُ المردود يبقى محفوظاً.
          </p>
          {submitted.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">
              لا تسليماتٍ تنتظر التحقّق في الأسبوع المُراجَع.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {submitted.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  theme={theme}
                  can={{ work: false, review: true, carryPlan: false }}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── ٤/٥) غيرُ المكتمل وخططُ تصحيحه */}
        <section>
          <h2 className="mb-1 text-base font-bold">
            ٤–٥ · غيرُ المكتمل والمعوَّق والمردود ({unfinished.length})
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-black/50">
            هذه تُرحَّل إلى الأسبوع القادم بمعرّفاتها ومواعيدها الأصلية وأصحابها — ولا تُعَدّ
            منجَزةً لأن الأسبوع انتهى. ويُطلَب لكلٍّ سببٌ وخطةُ تصحيحٍ قبل اعتماد خطة قسمها.
          </p>
          {unfinished.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">
              لا عملَ غيرَ مكتملٍ في الأسبوع المُراجَع.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {unfinished.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  theme={theme}
                  can={{ work: false, review: true, carryPlan: false }}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── ٦) أداءُ الأقسام وأحمالُها */}
        <section>
          <h2 className="mb-3 text-base font-bold">٦ · أداءُ الأقسام وأحمالُها</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {agenda.deptPlans.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: p.department.colorHex }}
                    aria-hidden
                  />
                  <h3 className="text-sm font-bold">{p.department.name}</h3>
                </div>
                <p className="mt-1 text-xs text-black/50">
                  {p._count.tasks} التزاماً في خطة الأسبوع القادم · الطاقة{" "}
                  {p.capacityPoints ?? "—"}
                  {p.overloadAcknowledged ? " · تحميلٌ مُقَرّ" : ""}
                </p>
              </Card>
            ))}
            {agenda.deptPlans.length === 0 && (
              <Card className="p-6 text-center text-sm text-black/45 sm:col-span-2">
                لا خططَ أقسامٍ للأسبوع القادم بعد.
              </Card>
            )}
          </div>
        </section>

        {/* ── ٧) المُرحَّلُ المتكرّر والتبعيّات */}
        <section>
          <h2 className="mb-1 text-base font-bold">
            ٧ · المتكرّرُ ترحيلُه ({agenda.repeated.length})
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-black/50">
            ما بلغ {agenda.escalateAfter} ترحيلاتٍ متتالية يحتاج قرارك: تقليلُ نطاقٍ، أو نقلُ
            مسؤولية، أو موعدٌ جديد، أو إسقاطُ التزام.
          </p>
          {agenda.repeated.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">لا تكرارَ يُذكَر.</Card>
          ) : (
            <div className="flex flex-col gap-2">
              {agenda.repeated.map((r) => (
                <Card key={r.id} className="p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">{r.title}</h3>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                      {r.consecutiveCarryover} متتالية
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-black/50">
                    {r.department?.name ?? "—"} ·{" "}
                    {r.ownerUser?.fullName ?? r.ownerMember?.fullName ?? "بلا صاحب"} · الأصلي{" "}
                    {formatDate(r.originalDueAt)} · {countdownLabel(r.dueAt)}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── المُسقَطُ بقرار — يُعرَض وحده */}
        {waived.length > 0 && (
          <section>
            <h2 className="mb-1 text-base font-bold">المُسقَطُ بقرار ({waived.length})</h2>
            <p className="mb-3 text-xs leading-relaxed text-black/50">
              هذه <strong>لا تُحتسَب إنجازاً</strong> ولا تُحسَب في نسبة الأسبوع — وتُعرَض
              لتُقرأ، فالتزامُها التاريخيُّ باقٍ.
            </p>
            <div className="flex flex-col gap-2">
              {waived.map((t) => (
                <Card key={t.id} className="p-3.5">
                  <h3 className="text-sm font-bold">{t.title}</h3>
                  <p className="mt-1 text-xs text-black/55">
                    {t.ownerName ?? "—"} · {t.waivedReason ?? "—"}
                  </p>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* ── إعداداتُ الاجتماع */}
        <section>
          <h2 className="mb-3 text-base font-bold">إعداداتُ الاجتماع الأسبوعي</h2>
          <Card className="p-4 sm:p-5">
            <MeetingSettingsForm settings={settings} theme={theme} />
          </Card>
        </section>

        <Card className="p-4 text-xs leading-relaxed text-black/50">
          وبعد إتمام المراحل: الإذنُ بفتح الأسبوع من{" "}
          <Link href="/admin/execution" className="font-bold underline">
            لوحة التنفيذ
          </Link>{" "}
          — ولا يُفتَح بمرور التقويم.
        </Card>
      </main>
    </div>
  );
}
