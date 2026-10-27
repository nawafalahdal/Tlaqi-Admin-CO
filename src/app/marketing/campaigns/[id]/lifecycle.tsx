import type { MarketingCampaignStatus } from "@prisma/client";
import type { Dictionary } from "@/i18n";
import { prisma } from "@/lib/prisma";
import type { MkActor } from "@/lib/marketing/access";
import { planningDesk } from "@/lib/marketing/planningCycle";
import { chatView } from "@/lib/marketing/ai/chat";
import { serializeChat } from "@/lib/marketing/ai/chatView";
import { archiveBlockers, campaignArchiveRuns } from "@/lib/marketing/archive";
import { marketingArchiveStore } from "@/lib/googleSheets";
import { fmt } from "@/i18n/fmt";
import { ActionForm } from "../../_components/ActionForm";
import { ChatPanel } from "../../_components/ChatPanel";
import { Pill, Section, Field, inputCls, when, Muted } from "../../_components/bits";

type Mk = Dictionary["mk"];
const PLANNING: MarketingCampaignStatus[] = ["idea", "briefing", "ready_for_planning"];

/** التخطيطُ ودورتُه: رسالةُ الإغلاق بعد الاعتماد وموعدُ الفتح، والفتحُ المبكر لقائد التسويق، وشاتُ
 *  التخطيط في حملةٍ ما زالت تُخطَّط. والقراءةُ هنا بلا كتابة (`planningDesk`). */
export async function PlanningPanel({ mk, actor, campaignId, status }: { mk: Mk; actor: MkActor; campaignId: string; status: MarketingCampaignStatus }) {
  const L = mk.planning;
  const desk = await planningDesk();
  const inPlanning = PLANNING.includes(status);
  const view = inPlanning ? await chatView(actor, { kind: "planning", campaignId }) : null;

  return (
    <Section title={mk.chat.titles.planning} hint={mk.chat.hints.planning}>
      <div className="flex flex-col gap-3">
        {!desk.open ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-planning-closed>
            <p className="text-sm font-bold">{fmt(L.closedTitle, when(desk.cycle.reopenAt))}</p>
            <p className="mt-1 text-sm leading-relaxed" dir="auto">
              {fmt(L.closedBody, desk.cycle.campaignName, when(desk.cycle.startDate, false), when(desk.cycle.endDate, false), when(desk.cycle.reopenAt))}
            </p>
            {actor.isMarketingLead && (
              <details className="mt-3 border-t border-amber-200/70 pt-2">
                <summary className="cursor-pointer text-sm font-bold">{mk.settings.earlyReopen}</summary>
                <p className="mt-1 text-[11px] text-black/55">{mk.settings.earlyHint}</p>
                <div className="mt-2">
                  <ActionForm op="planning.reopen" submit={mk.settings.earlyReopen} variant="outline">
                    <Field label={mk.settings.earlyReason}>
                      <input name="reason" required minLength={5} maxLength={500} className={inputCls} />
                    </Field>
                  </ActionForm>
                </div>
              </details>
            )}
          </div>
        ) : (
          desk.lastCycle && (
            <p className="text-xs text-black/55" dir="auto">
              {fmt(L.lastCycle, desk.lastCycle.campaignName, when(desk.lastCycle.reopenedAt), (L.reasons as Record<string, string>)[String(desk.lastCycle.reopenReason ?? "").split(":")[0]] ?? desk.lastCycle.reopenReason ?? "")}
            </p>
          )
        )}
        {view && <ChatPanel scope={{ kind: "planning", campaignId }} initial={serializeChat(view)} />}
      </div>
    </Section>
  );
}

/** الأرشفةُ في Google Sheets: ما يمنعها الآن، وتوثيقُ ما لم يُنشر، والطلب، وسجلُّ المحاولات.
 *  الطلبُ لقائد التسويق — كما في الخادم (`requestArchive`). */
export async function ArchiveSection({ mk, actor, campaignId }: { mk: Mk; actor: MkActor; campaignId: string }) {
  const L = mk.archive;
  const [blockers, runs, pieces] = await Promise.all([
    archiveBlockers(prisma, campaignId),
    campaignArchiveRuns(campaignId),
    prisma.marketingDeliverable.findMany({ where: { campaignId, status: { not: "published" } }, select: { id: true, title: true, unpublishedReason: true } }),
  ]);
  const configured = !!marketingArchiveStore();
  const lead = actor.isMarketingLead;
  const label = (b: string) => (L.blockers as Record<string, string>)[b] ?? b;
  const errorLabel = (e: string | null) => (e ? (L.errors as Record<string, string>)[e.split(":")[0]] ?? e : "");

  return (
    <Section id="archive" title={L.sectionTitle} hint={L.sectionHint}>
      <div className="flex flex-col gap-3">
        {!configured && <p className="text-xs text-amber-900">{L.unavailable}</p>}
        {blockers.length === 0 ? (
          <p className="text-sm font-semibold text-emerald-700">{L.ready}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {blockers.map((b) => (
              <li key={b}>
                <Pill tone="review">{label(b)}</Pill>
              </li>
            ))}
          </ul>
        )}
        {pieces.length > 0 && (
          <ul className="flex flex-col gap-2">
            {pieces.map((p) => (
              <li key={p.id} className="rounded-xl border border-black/[0.08] p-3 text-sm">
                <p className="font-bold" dir="auto">{p.title}</p>
                {p.unpublishedReason ? (
                  <p className="mt-1 text-xs text-black/60" dir="auto">{fmt(L.documented, p.unpublishedReason)}</p>
                ) : (
                  lead && (
                    <div className="mt-2">
                      <ActionForm op="archive.document" submit={L.document} variant="outline">
                        <input type="hidden" name="deliverableId" value={p.id} />
                        <Field label={L.documentReason}>
                          <input name="reason" required minLength={5} maxLength={1000} className={inputCls} dir="auto" />
                        </Field>
                      </ActionForm>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {lead && configured && blockers.length === 0 && (
          <ActionForm op="archive.request" submit={L.request} variant="danger" confirm={L.confirm}>
            <input type="hidden" name="campaignId" value={campaignId} />
          </ActionForm>
        )}
        {runs.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold">{L.runs}</p>
            <ol className="flex flex-col gap-2">
              {runs.map((r) => (
                <li key={r.id} className="rounded-lg bg-black/[0.03] p-2.5 text-xs">
                  <p className="flex flex-wrap items-center gap-2">
                    <Pill tone={r.status === "completed" ? "good" : r.status === "failed" ? "bad" : "review"}>{L.runStatus[r.status]}</Pill>
                    <span>{when(r.createdAt)}</span>
                    {r.expectedRows > 0 && <span>{fmt(L.rows, r.expectedRows)}</span>}
                    {r.lastError && <span className="text-red-800">{fmt(L.lastError, errorLabel(r.lastError))}</span>}
                    {r.nextAttemptAt && r.status === "pending" && <span>{fmt(L.nextAttempt, when(r.nextAttemptAt))}</span>}
                  </p>
                  {r.status === "failed" && lead && (
                    <div className="mt-2">
                      <ActionForm op="archive.retry" submit={L.retry} variant="outline" inline>
                        <input type="hidden" name="runId" value={r.id} />
                      </ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
        {!lead && <Muted>{L.forbidden}</Muted>}
      </div>
    </Section>
  );
}
