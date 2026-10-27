import type { MarketingPlanStage } from "@prisma/client";
import type { Dictionary } from "@/i18n";
import type { MkActor } from "@/lib/marketing/access";
import { PLAN_STAGES, type campaignPlan } from "@/lib/marketing/plan";
import { fmt } from "@/i18n/fmt";
import { ActionForm } from "../../_components/ActionForm";
import { Pill, Section, Field, areaCls, nameOf, when, Muted } from "../../_components/bits";

type Mk = Dictionary["mk"];
type Plan = NonNullable<Awaited<ReturnType<typeof campaignPlan>>>;
type Version = Plan["versions"][number];

/** خطةُ الحملة: النسخةُ الحاليّة ومراحلُها الثلاث بأصحابها، ثم النسخُ السابقة.
 *
 *  زرُّ القرار يُرسَم لصاحب المرحلة التالية وحده (`actor.planStage` من دوره في
 *  المنصة)، وزرُّ التقديم للمنسّق حين تقبله الخدمة. والخدمةُ تعيد الفحص كلَّه —
 *  الترتيب والنسخةَ وبصمتها وصاحبَ المرحلة — فلا يمرّ نموذجٌ مصطنع. */
export function PlanSection({ mk, actor, campaignId, status, plan, locale }: { mk: Mk; actor: MkActor; campaignId: string; status: string; plan: Plan; locale: "ar" | "en" }) {
  const L = mk.plan;
  const current = plan.current;
  const live = !!current && !current.invalidatedAt && !plan.stale;
  // الخطةُ الناقصة لا تُقدَّم — كما في الخادم (`plan_incomplete`): تُسمّى نواقصُها بدل الزرّ
  const gaps = plan.gaps ?? [];
  const canSubmit = plan.canSubmit && status === "ready_for_planning" && !live && gaps.length === 0;
  const sep = locale === "ar" ? "، " : ", ";
  const gapLabel = (g: { scope: string; piece?: string; field: string }) =>
    g.scope === "piece"
      ? `${g.piece}: ${(mk.gaps as Record<string, string>)[`piece.${g.field}`] ?? g.field}`
      : (mk.briefField as Record<string, string>)[g.field] ?? (mk.gaps as Record<string, string>)[g.field] ?? g.field;
  const myTurn = live && status === "ready_for_planning" && !!actor.planStage && plan.next === actor.planStage;

  return (
    <Section id="plan" title={L.title} hint={L.hint}>
      <div className="flex flex-col gap-4">
        {!current ? <Muted>{L.none}</Muted> : <VersionCard mk={mk} v={current} stale={plan.stale} next={plan.next} locale={locale} />}
        {plan.approved && status === "ready_for_planning" && <p className="text-sm font-semibold text-emerald-700">{L.approvedAll}</p>}

        {myTurn && current && actor.planStage && (
          <div className="rounded-xl border border-amber-200 p-3">
            <p className="mb-2 text-sm font-bold">{fmt(L.decide, current.number, L.stage[actor.planStage])}</p>
            <ActionForm
              op="plan.decide"
              buttons={[
                { label: L.approve, name: "decision", value: "approved", variant: "solid" },
                { label: L.requestChanges, name: "decision", value: "changes_requested", variant: "outline" },
              ]}
            >
              <input type="hidden" name="campaignId" value={campaignId} />
              <input type="hidden" name="planVersionId" value={current.id} />
              <input type="hidden" name="stage" value={actor.planStage} />
              <Field label={mk.common.note} hint={L.noteHint}>
                <textarea name="note" rows={2} maxLength={1000} className={areaCls} />
              </Field>
            </ActionForm>
          </div>
        )}

        {plan.canSubmit && status === "ready_for_planning" && !live && gaps.length > 0 && (
          <div className="rounded-xl border border-amber-200 p-3" data-plan-gaps>
            <p className="text-sm font-bold text-amber-900">{L.incompleteTitle}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {gaps.slice(0, 30).map((g, i) => (
                <li key={i}>
                  <Pill tone="review">{gapLabel(g)}</Pill>
                </li>
              ))}
            </ul>
            {gaps.length > 30 && <p className="mt-1 text-xs text-black/55">{`+${gaps.length - 30}`}</p>}
            <span className="sr-only">{gaps.map(gapLabel).join(sep)}</span>
          </div>
        )}
        {canSubmit && (
          <ActionForm op="plan.submit" submit={current ? L.resubmit : L.submit}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <Field label={L.submitNote}>
              <textarea name="note" rows={2} maxLength={1000} className={areaCls} />
            </Field>
          </ActionForm>
        )}
        {plan.canSubmit && !current && status !== "ready_for_planning" && <Muted>{L.notReady}</Muted>}

        {plan.versions.length > 1 && (
          <details>
            <summary className="cursor-pointer text-sm font-bold">{L.history} ({plan.versions.length - 1})</summary>
            <div className="mt-2 flex flex-col gap-2">
              {plan.versions.filter((v) => v.id !== current?.id).map((v) => (
                <VersionCard key={v.id} mk={mk} v={v} stale={false} next={null} locale={locale} />
              ))}
            </div>
          </details>
        )}
      </div>
    </Section>
  );
}

function VersionCard({ mk, v, stale, next, locale }: { mk: Mk; v: Version; stale: boolean; next: MarketingPlanStage | null; locale: "ar" | "en" }) {
  const L = mk.plan;
  const snap = v.snapshot as { deliverables?: { title: string; platform: string }[] } | null;
  const reason = v.invalidatedReason ? (L.reasons as Record<string, string>)[v.invalidatedReason] ?? v.invalidatedReason : null;
  return (
    <div className="rounded-xl border border-black/[0.08] p-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-black/55">
        <span className="font-bold text-black/80">{fmt(L.version, v.number)}</span>
        <span>{fmt(L.submittedBy, nameOf(v.submittedBy), when(v.createdAt))}</span>
        {v.invalidatedAt && <Pill>{fmt(L.invalidated, reason ?? when(v.invalidatedAt))}</Pill>}
        {stale && <Pill tone="review">{L.stale}</Pill>}
      </p>
      {v.note && <p className="mt-1 text-xs text-black/60">{v.note}</p>}
      {snap?.deliverables && (
        <p className="mt-1 text-[11px] text-black/50" dir="auto">
          {fmt(L.deliverables, snap.deliverables.map((d) => `${d.title} (${d.platform})`).join(locale === "ar" ? "، " : ", "))}
        </p>
      )}
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        {PLAN_STAGES.map((s) => {
          const d = v.decisions.find((x) => x.stage === s);
          return (
            <li key={s} className="rounded-lg bg-black/[0.03] p-2.5 text-xs">
              <p className="font-bold">{L.stage[s]}</p>
              <p className="text-black/55">{L.owner[s]}</p>
              <div className="mt-1.5">
                {d ? (
                  <>
                    <Pill tone={d.decision === "approved" ? "good" : "bad"}>{d.decision === "approved" ? L.approved : L.returned}</Pill>
                    <p className="mt-1 text-black/60">{d.deciderName} · {when(d.createdAt)}</p>
                    {d.note && <p className="mt-1 text-black/70">{d.note}</p>}
                  </>
                ) : (
                  <Pill tone={next === s ? "review" : "neutral"}>{next === s ? L.pending : L.waiting}</Pill>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
