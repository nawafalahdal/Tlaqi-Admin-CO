import type { MarketingCampaignRole } from "@prisma/client";
import type { Dictionary } from "@/i18n";
import type { deliverableWorkspace, DeliverableFacts } from "@/lib/marketing/deliverables";
import { contentChecks } from "@/lib/marketing/content";
import { QUALITY_ITEMS, METRIC_KEYS } from "@/lib/marketing/review";
import { fill } from "@/lib/marketing/messages";
import type { AiStatus } from "@/lib/marketing/ai/registry";
import type { JobsView } from "@/lib/marketing/ai/view";
import { fmt } from "@/i18n/fmt";
import { FileField } from "@/components/FileField";
import { ActionForm } from "../../../../_components/ActionForm";
import { AiPanel } from "../../../../_components/AiPanel";
import { DesignPreview } from "../../../../_components/DesignPreview";
import { Pill, Section, Field, inputCls, areaCls, nameOf, when, Muted } from "../../../../_components/bits";

type Mk = Dictionary["mk"];
type D = NonNullable<Awaited<ReturnType<typeof deliverableWorkspace>>>["deliverable"];
type Ctx = {
  mk: Mk;
  locale: "ar" | "en";
  d: D;
  facts: DeliverableFacts;
  me: string | null;
  separate: boolean;
  workable: boolean;
  has: (r: MarketingCampaignRole) => boolean;
};

type Check = { key: string; level: string; params?: Record<string, string | number> };
const LEVEL: Record<string, "good" | "review" | "bad"> = { ok: "good", warn: "review", fail: "bad" };

function Checks({ list, labels }: { list: Check[]; labels: Record<string, string> }) {
  return (
    <ul className="flex flex-col gap-1">
      {list.map((c, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <Pill tone={LEVEL[c.level] ?? "neutral"}>{c.level === "ok" ? "✓" : c.level === "warn" ? "!" : "✕"}</Pill>
          <span className="leading-relaxed text-black/70">{fill(labels[c.key] ?? c.key, c.params)}</span>
        </li>
      ))}
    </ul>
  );
}

/** قرارٌ على نسخةٍ بعينها: اعتمادٌ أو طلبُ تعديلٍ بملاحظة. ومن كتبها لا يُعرض له القرار */
function DecideForm({ mk, op, deliverableId, versionId }: { mk: Mk; op: string; deliverableId: string; versionId: string }) {
  return (
    <ActionForm
      op={op}
      buttons={[
        { label: mk.common.approve, name: "decision", value: "approved", variant: "solid" },
        { label: mk.common.requestChanges, name: "decision", value: "changes_requested", variant: "outline" },
      ]}
    >
      <input type="hidden" name="deliverableId" value={deliverableId} />
      <input type="hidden" name="versionId" value={versionId} />
      <Field label={mk.common.note} hint={mk.common.decisionNoteHint}>
        <textarea name="note" rows={2} maxLength={1000} className={areaCls} />
      </Field>
    </ActionForm>
  );
}

// ── النص ──────────────────────────────────────────────────────────────

export function ContentSection({ mk, d, facts, me, separate, workable, has, ai }: Ctx & {
  ai: { initial: { status: AiStatus["text"] } & JobsView; image: AiStatus["image"] } | null;
}) {
  const L = mk.content;
  const writer = has("writer");
  const current = d.contentVersions.find((v) => v.id === d.currentContentVersionId) ?? null;
  const checks = contentChecks(d.contentDraft || current?.body || "", current?.sources ?? null, d.platform);
  const canEdit = writer && workable;
  const own = !!current && current.authorId === me;

  return (
    <Section id="content" title={mk.deliverable.sections.content} hint={canEdit ? L.draftHint : writer ? undefined : L.readOnly}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {canEdit ? (
            <ActionForm
              buttons={[
                { label: L.saveDraft, op: "content.draft", variant: "outline" },
                { label: L.submit, op: "content.submit", variant: "solid" },
              ]}
            >
              <input type="hidden" name="deliverableId" value={d.id} />
              <Field label={L.draft}>
                {/* المفتاحُ على الحقل لا على النموذج: يُعاد بالمسودة المحفوظة (بعد تبنّي اقتراحٍ مثلاً)
                    ويبقى النموذجُ نفسُه — فلا تضيع رسالةُ «تمّ» بإعادة تركيبه */}
                <textarea key={d.draftUpdatedAt?.toISOString() ?? "new"} name="body" rows={8} maxLength={20000} defaultValue={d.contentDraft} dir="auto" className={areaCls} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={L.changeNote}>
                  <input name="changeNote" maxLength={1000} className={inputCls} />
                </Field>
                <Field label={L.sources} hint={L.sourcesHint}>
                  <input name="sources" maxLength={4000} defaultValue={current?.sources ?? ""} dir="auto" className={inputCls} />
                </Field>
              </div>
            </ActionForm>
          ) : (
            current && <p className="whitespace-pre-wrap rounded-xl bg-black/[0.03] p-3 text-sm leading-relaxed" dir="auto">{current.body}</p>
          )}

          {current && d.status === "content_review" && writer && workable && (
            <div className="rounded-xl border border-amber-200 p-3">
              <p className="mb-2 text-sm font-bold">{fmt(L.decide, current.number)}</p>
              {separate && own ? <Muted>{L.ownVersion}</Muted> : <DecideForm mk={mk} op="content.decide" deliverableId={d.id} versionId={current.id} />}
            </div>
          )}

          {writer && workable && d.status === "revision_required" && d.revisionTarget === "content" && facts.contentApproved && (
            <ActionForm op="content.keep" submit={L.keepApproved} variant="outline">
              <input type="hidden" name="deliverableId" value={d.id} />
              <span className="text-xs text-black/55">{L.keepApprovedHint}</span>
            </ActionForm>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-bold">{L.versions} ({d.contentVersions.length})</summary>
            {d.contentVersions.length === 0 ? (
              <Muted>{L.noVersions}</Muted>
            ) : (
              <ol className="mt-2 flex flex-col gap-2">
                {d.contentVersions.map((v) => (
                  <li key={v.id} className="rounded-xl border border-black/[0.08] p-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-black/55">
                      <span className="font-bold text-black/80">{fmt(mk.common.version, v.number)}</span>
                      {v.id === d.currentContentVersionId ? <Pill tone="progress">{mk.common.current}</Pill> : <Pill>{mk.common.previous}</Pill>}
                      <span>{fmt(mk.common.by, nameOf(v.author))}</span>
                      <span>{when(v.createdAt)}</span>
                    </p>
                    {v.changeNote && <p className="mt-1 text-xs text-black/60">{v.changeNote}</p>}
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" dir="auto">{v.body}</p>
                    {v.sources && <p className="mt-1 text-[11px] text-black/50" dir="auto">{L.sources}: {v.sources}</p>}
                  </li>
                ))}
              </ol>
            )}
          </details>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border border-black/[0.08] p-3">
            <p className="text-xs font-bold">{L.checks}</p>
            <p className="mb-2 text-[11px] text-black/50">{L.checksHint}</p>
            <Checks list={checks} labels={mk.textChecks} />
          </div>
          {ai && <AiPanel deliverableId={d.id} initial={ai.initial} image={ai.image} workable={workable} />}
        </aside>
      </div>
    </Section>
  );
}

// ── التصميم ───────────────────────────────────────────────────────────

const DESIGN_PHASE = ["content_approved", "design_review", "design_approved", "quality_review", "ready_to_publish"];
const RETURNABLE = ["content_approved", "design_review", "design_approved"];

export function DesignSection({ mk, d, facts, me, separate, workable, has }: Ctx) {
  const L = mk.design;
  const designer = has("designer");
  const phase = DESIGN_PHASE.includes(d.status) || (d.status === "revision_required" && d.revisionTarget === "design");
  const canUpload = designer && workable && phase && facts.contentApproved;
  const current = d.designVersions.find((v) => v.id === d.currentDesignVersionId) ?? null;
  const preview = d.designVersions.map((v) => ({ id: v.id, number: v.number, url: `/api/marketing/files/${v.fileId}`, width: v.width, height: v.height }));
  const target = { width: d.width, height: d.height, safeTop: d.safeTop, safeRight: d.safeRight, safeBottom: d.safeBottom, safeLeft: d.safeLeft };
  const checksOf = (v: D["designVersions"][number]) => (Array.isArray(v.checks) ? (v.checks as Check[]) : []);

  return (
    <Section id="design" title={mk.deliverable.sections.design} hint={designer ? undefined : L.readOnly}>
      <div className="flex flex-col gap-4">
        {preview.length > 0 ? <DesignPreview versions={preview} target={target} /> : <Muted>{L.noVersions}</Muted>}

        {designer && workable && !facts.contentApproved && <Muted>{L.needsApprovedContent}</Muted>}

        {designer && <BrandAssets mk={mk} />}

        {canUpload && (
          <details open={d.designVersions.length === 0}>
            <summary className="cursor-pointer text-sm font-bold">{L.upload}</summary>
            <div className="mt-2">
              <ActionForm op="design.upload" submit={L.upload} resetOnSuccess>
                <input type="hidden" name="deliverableId" value={d.id} />
                <FileField name="file" accept="image/png,image/jpeg,image/webp" />
                <span className="text-[11px] text-black/50">{L.uploadHint}</span>
                <Field label={mk.content.changeNote}>
                  <input name="changeNote" maxLength={1000} className={inputCls} />
                </Field>
              </ActionForm>
            </div>
          </details>
        )}

        {current && d.status === "design_review" && designer && workable && (
          <div className="rounded-xl border border-amber-200 p-3">
            <p className="mb-2 text-sm font-bold">{fmt(L.decide, current.number)}</p>
            {separate && current.author.id === me ? <Muted>{L.ownVersion}</Muted> : <DecideForm mk={mk} op="design.decide" deliverableId={d.id} versionId={current.id} />}
          </div>
        )}

        {d.status === "design_approved" && workable && (designer || has("coordinator")) && (
          <ActionForm op="quality.send" submit={L.sendToQuality}>
            <input type="hidden" name="deliverableId" value={d.id} />
          </ActionForm>
        )}

        {designer && workable && RETURNABLE.includes(d.status) && (
          <details>
            <summary className="cursor-pointer text-sm font-bold">{L.returnToWriter}</summary>
            <div className="mt-2">
              <ActionForm op="design.return" submit={L.returnToWriter} variant="outline">
                <input type="hidden" name="deliverableId" value={d.id} />
                <Field label={mk.common.note} hint={L.returnHint}>
                  <textarea name="note" required rows={2} maxLength={1000} className={areaCls} />
                </Field>
              </ActionForm>
            </div>
          </details>
        )}

        {d.designVersions.length > 0 && (
          <details open={d.designVersions.some((v) => !v.submittedAt)}>
            <summary className="cursor-pointer text-sm font-bold">{L.versions} ({d.designVersions.length})</summary>
            <ol className="mt-2 flex flex-col gap-2">
              {d.designVersions.map((v) => {
                const onCurrent = v.basedOnContentVersionId === d.currentContentVersionId;
                const passes = !checksOf(v).some((c) => c.level === "fail");
                const canSubmit = canUpload && !v.submittedAt && onCurrent && passes;
                return (
                  <li key={v.id} className="rounded-xl border border-black/[0.08] p-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-black/55">
                      <span className="font-bold text-black/80">{fmt(mk.common.version, v.number)}</span>
                      {v.id === d.currentDesignVersionId && <Pill tone="progress">{mk.common.current}</Pill>}
                      <span>{fmt(mk.common.by, nameOf(v.author))}</span>
                      <span>{when(v.createdAt)}</span>
                      {onCurrent ? <span>{fmt(L.onContent, v.basedOnContentVersion.number)}</span> : <Pill tone="review">{L.outdated}</Pill>}
                      <span>{v.submittedAt ? fmt(L.submitted, when(v.submittedAt)) : L.notSubmitted}</span>
                      <a href={`/api/marketing/files/${v.fileId}?download=1`} className="underline-offset-2 hover:underline">{mk.common.download}</a>
                    </p>
                    {v.changeNote && <p className="mt-1 text-xs text-black/60">{v.changeNote}</p>}
                    <div className="mt-2">
                      <Checks list={checksOf(v)} labels={mk.designChecks} />
                    </div>
                    {canSubmit && (
                      <div className="mt-2">
                        <ActionForm op="design.submit" submit={L.submit}>
                          <input type="hidden" name="deliverableId" value={d.id} />
                          <input type="hidden" name="versionId" value={v.id} />
                        </ActionForm>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        )}
      </div>
    </Section>
  );
}

/** ملفّاتُ الهوية التي تستعملها المنصةُ نفسها — للتحميل كما هي، لا يُعاد رسمُها.
 *  روابطُ لا غير: المنصةُ لا تفحص أن التصميمَ استعملها؛ ذلك بندُ «الهوية» في فحص الجودة. */
const BRAND_FILES = [
  { key: "logoFull", href: "/brand/logo-full.png" },
  { key: "lockupLight", href: "/brand/lockup-on-light.png" },
  { key: "lockupDark", href: "/brand/lockup-on-dark.png" },
  { key: "symbol", href: "/brand/symbol.png" },
  { key: "guide", href: "/brand/brand-guide.webp" },
] as const;

function BrandAssets({ mk }: { mk: Mk }) {
  const L = mk.design.brand;
  return (
    <details data-brand-assets>
      <summary className="cursor-pointer text-sm font-bold">{L.title}</summary>
      <p className="mt-1 text-[11px] leading-relaxed text-black/55">{L.hint}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {BRAND_FILES.map((f) => (
          <li key={f.key}>
            <a href={f.href} download className="inline-flex rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.04]">
              {L[f.key]}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── الجودة ────────────────────────────────────────────────────────────

export function QualitySection({ mk, d, workable, has }: Ctx) {
  const L = mk.quality;
  const content = d.contentVersions.find((v) => v.id === d.currentContentVersionId);
  const design = d.designVersions.find((v) => v.id === d.currentDesignVersionId);
  const canRecord = has("reviewer") && workable && d.status === "quality_review" && !!content && !!design;

  return (
    <Section id="quality" title={L.title} hint={canRecord && content && design ? fmt(L.onPair, content.number, design.number) : undefined}>
      {canRecord ? (
        <ActionForm op="quality.record" submit={L.record}>
          <input type="hidden" name="deliverableId" value={d.id} />
          <input type="hidden" name="contentVersionId" value={content!.id} />
          <input type="hidden" name="designVersionId" value={design!.id} />
          <ul className="flex flex-col divide-y divide-black/[0.06]">
            {QUALITY_ITEMS.map((k) => (
              <li key={k} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-3">
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input type="checkbox" name={`item.${k}`} />
                  {mk.qualityItems[k]}
                </label>
                <input name={`note.${k}`} maxLength={500} placeholder={L.itemNote} aria-label={`${mk.qualityItems[k]} — ${L.itemNote}`} className={`${inputCls} sm:max-w-72`} />
              </li>
            ))}
          </ul>
          <Field label={L.overallNote} hint={L.overallNoteHint}>
            <textarea name="note" rows={2} maxLength={1000} className={areaCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-red-800">
            <input type="checkbox" name="blocking" />
            {L.blocking}
          </label>
        </ActionForm>
      ) : (
        d.qualityChecks.length === 0 && <Muted>{L.notYet}</Muted>
      )}
      {d.qualityChecks.length > 0 && (
        <details className="mt-3" open={!canRecord}>
          <summary className="cursor-pointer text-sm font-bold">{L.history} ({d.qualityChecks.length})</summary>
          <ol className="mt-2 flex flex-col gap-2">
            {d.qualityChecks.map((q) => {
              const items = Array.isArray(q.items) ? (q.items as { key: string; passed: boolean; note: string | null }[]) : [];
              return (
                <li key={q.id} className="rounded-xl border border-black/[0.08] p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-black/55">
                    <Pill tone={q.passed ? "good" : "bad"}>{q.passed ? L.passed : L.failed}</Pill>
                    {q.blocking && <Pill tone="bad">{L.blocking}</Pill>}
                    <span>{fmt(L.onPair, q.contentVersion.number, q.designVersion.number)}</span>
                    <span>{fmt(mk.common.by, nameOf(q.reviewer))}</span>
                    <span>{when(q.createdAt)}</span>
                    {q.invalidatedAt && <Pill>{fmt(mk.common.invalidated, when(q.invalidatedAt))}</Pill>}
                  </p>
                  {q.note && <p className="mt-1 text-sm">{q.note}</p>}
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {items.map((i) => (
                      <li key={i.key} className="text-xs text-black/65">
                        {i.passed ? "✓" : "✕"} {(mk.qualityItems as Record<string, string>)[i.key] ?? i.key}
                        {i.note ? ` — ${i.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </Section>
  );
}

// ── النشر ─────────────────────────────────────────────────────────────

function riyadhNowInput(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

export function PublishSection({ mk, d, workable, has }: Ctx) {
  const L = mk.publish;
  const publisher = has("publisher");
  const canRecord = publisher && workable && d.status === "ready_to_publish";

  return (
    <Section id="publish" title={mk.deliverable.sections.publish} hint={L.manualOnly}>
      {canRecord ? (
        <ActionForm op="publish.record" submit={L.record}>
          <input type="hidden" name="deliverableId" value={d.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L.url}>
              <input name="url" type="url" required placeholder="https://" dir="ltr" className={inputCls} />
            </Field>
            <Field label={L.publishedAt}>
              <input name="publishedAt" type="datetime-local" required defaultValue={riyadhNowInput()} className={inputCls} />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirmedLive" required className="mt-1" />
            {L.confirmedLive}
          </label>
        </ActionForm>
      ) : (
        d.publications.length === 0 && <Muted>{L.notReady}</Muted>
      )}

      {d.publications.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm font-bold">{L.records}</p>
          {d.publications.map((p) => {
            const metrics = (p.metrics ?? null) as Record<string, number> | null;
            return (
              <div key={p.id} className="rounded-xl border border-black/[0.08] p-3">
                <p className="flex flex-wrap items-center gap-2 text-xs text-black/55">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-bold text-black/80 underline-offset-2 hover:underline" dir="ltr">{p.url}</a>
                  <span>{when(p.publishedAt)}</span>
                  <span>{fmt(L.pair, p.contentVersion.number, p.designVersion.number)}</span>
                  <span>{fmt(mk.common.by, nameOf(p.publisher))}</span>
                </p>
                <div className="mt-2">
                  <p className="text-xs font-bold">{L.results}</p>
                  {metrics && Object.keys(metrics).length > 0 ? (
                    <>
                      <dl className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {METRIC_KEYS.filter((k) => metrics[k] !== undefined).map((k) => (
                          <div key={k} className="rounded-lg bg-black/[0.03] p-2">
                            <dt className="text-[10px] text-black/50">{mk.metrics[k]}</dt>
                            <dd className="text-sm font-bold tabular-nums">{metrics[k]}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="mt-1 text-[11px] text-black/45">{fmt(L.resultsAsOf, when(p.metricsAsOf, false), p.metricsSource ?? "")}</p>
                    </>
                  ) : (
                    <Muted>{L.noResults}</Muted>
                  )}
                </div>
                {publisher && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-bold text-black/60">{L.saveResults}</summary>
                    <div className="mt-2">
                      <ActionForm op="publish.results" submit={L.saveResults} variant="outline">
                        <input type="hidden" name="publicationId" value={p.id} />
                        <p className="text-[11px] text-black/50">{L.resultsHint}</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {METRIC_KEYS.map((k) => (
                            <Field key={k} label={mk.metrics[k]}>
                              <input name={`metric.${k}`} type="number" min={0} step={1} inputMode="numeric" defaultValue={metrics?.[k] ?? ""} className={inputCls} />
                            </Field>
                          ))}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label={L.asOf}>
                            <input name="asOf" type="date" required className={inputCls} />
                          </Field>
                          <Field label={L.source}>
                            <input name="source" required maxLength={200} placeholder={L.sourceHint} className={inputCls} />
                          </Field>
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ── القرارات ──────────────────────────────────────────────────────────

export function DecisionsList({ mk, approvals }: { mk: Mk; approvals: D["approvals"] }) {
  const L = mk.deliverable;
  return (
    <Section title={L.approvals}>
      {approvals.length === 0 ? (
        <Muted>{L.noApprovals}</Muted>
      ) : (
        <ol className="flex flex-col divide-y divide-black/[0.06]">
          {approvals.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
              <Pill tone={a.decision === "approved" ? "good" : "review"}>{L.decision[a.decision]}</Pill>
              <span className="font-bold">{L.kind[a.kind]} · {fmt(mk.common.version, a.contentVersion?.number ?? a.designVersion?.number ?? "—")}</span>
              <span className="text-black/55">{fmt(mk.common.by, nameOf(a.decider))}</span>
              <span className="text-black/45">{when(a.createdAt)}</span>
              {a.invalidatedAt && <Pill>{fmt(mk.common.invalidated, a.invalidatedReason ?? when(a.invalidatedAt))}</Pill>}
              {a.note && <span className="w-full text-black/65">{a.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
