import Link from "next/link";
import { notFound } from "next/navigation";
import { deliverableWorkspace } from "@/lib/marketing/deliverables";
import { listFormats } from "@/lib/marketing/formats";
import { marketingSettings } from "@/lib/marketing/team";
import { deliverableJobs } from "@/lib/marketing/ai/jobs";
import { aiStatus } from "@/lib/marketing/ai/registry";
import { serializeJobs } from "@/lib/marketing/ai/view";
import { marketingPage } from "@/lib/marketing/page";
import { fmt } from "@/i18n/fmt";
import { MkHeader } from "../../../../_components/MkHeader";
import { ActionForm } from "../../../../_components/ActionForm";
import { Pill, Section, Field, inputCls, deliverableTone } from "../../../../_components/bits";
import { CommentsTab, AuditTab } from "../../tabs";
import { ContentSection, DesignSection, QualitySection, PublishSection, DecisionsList } from "./sections";

export const dynamic = "force-dynamic";

/** صفحةُ المخرج: النصّ ← التصميم ← الجودة ← النشر، وما يمنع النشر في رأسها.
 *
 *  **كلُّ زرٍّ هنا مرآةٌ لشرط الخادم:** يُرسَم لصاحب المسؤولية في الحالة التي
 *  تقبله الخدمة، ولا يُرسَم لغيره. والخدمةُ تعيد الفحص على كل حال — فزرٌّ
 *  بقي في صفحةٍ قديمة يُردّ برمزٍ مفهوم («ظهرت نسخةٌ أحدث»)، لا يُنفَّذ. */
export default async function DeliverablePage({ params }: { params: Promise<{ id: string; did: string }> }) {
  const { id, did } = await params;
  const { actor, mk, isManager, locale } = await marketingPage(`/marketing/campaigns/${id}/deliverables/${did}`);
  const ws = await deliverableWorkspace(actor, did);
  if (!ws || ws.deliverable.campaignId !== id) notFound();
  const { deliverable: d, roles, facts, blockers } = ws;
  const has = (r: (typeof roles)[number]) => roles.includes(r);
  const workable = d.campaign.status === "in_progress" && d.status !== "published" && d.status !== "blocked";
  const [settings, jobsView, formats] = await Promise.all([
    marketingSettings(),
    has("writer") ? deliverableJobs(actor, did) : Promise.resolve(null),
    has("coordinator") ? listFormats() : Promise.resolve([]),
  ]);
  const ai = aiStatus();
  const ctx = { mk, locale, d, facts, me: actor.member?.id ?? null, separate: settings.requireSeparateApprover, workable, has };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader
        mk={mk}
        current={null}
        isManager={isManager}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.title}
            <Pill tone={deliverableTone(d.status)}>{mk.deliverableStatus[d.status]}</Pill>
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-3 text-xs" dir="auto">
            <span>{d.campaign.name}</span>
            <span dir="ltr">{d.platform} · {d.formatKey} · {d.width}×{d.height}</span>
          </span>
        }
        back={<Link href={`/marketing/campaigns/${id}?tab=deliverables`} className="text-xs font-bold text-black/55 hover:underline">{mk.deliverable.backToCampaign}</Link>}
      />

      {roles.length === 0 && <p className="rounded-2xl bg-black/[0.04] px-4 py-3 text-sm text-black/65">{mk.common.viewOnly}</p>}
      {d.status === "revision_required" && d.revisionNote && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800">
          {fmt(mk.deliverable.revisionNote, d.revisionTarget ? mk.revisionTarget[d.revisionTarget] : "", d.revisionNote)}
        </p>
      )}
      {d.status === "blocked" && d.revisionNote && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{fmt(mk.campaign.blockedBecause, d.revisionNote)}</p>
      )}

      {d.status !== "published" && (
        <Section title={mk.deliverable.blockersTitle}>
          {blockers.length === 0 ? (
            <p className="text-sm font-semibold text-emerald-700">{mk.deliverable.ready}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {blockers.map((b) => (
                <li key={b}>
                  <Pill tone="review">{(mk.blockers as Record<string, string>)[b] ?? b}</Pill>
                </li>
              ))}
            </ul>
          )}
          {has("coordinator") && d.campaign.status === "in_progress" && (
            <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-3">
              {d.status !== "blocked" ? (
                <details>
                  <summary className="cursor-pointer text-sm font-bold">{mk.deliverable.block}</summary>
                  <div className="mt-2">
                    <ActionForm op="deliverable.block" submit={mk.deliverable.block} variant="danger">
                      <input type="hidden" name="deliverableId" value={d.id} />
                      <input type="hidden" name="blocked" value="1" />
                      <Field label={mk.campaign.blockReason}>
                        <input name="reason" required maxLength={500} className={inputCls} />
                      </Field>
                    </ActionForm>
                  </div>
                </details>
              ) : (
                <ActionForm op="deliverable.block" submit={mk.deliverable.unblock}>
                  <input type="hidden" name="deliverableId" value={d.id} />
                  <input type="hidden" name="blocked" value="0" />
                </ActionForm>
              )}
              {d.status !== "blocked" && formats.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-bold">{mk.deliverable.changeFormat}</summary>
                  <div className="mt-2">
                    <ActionForm op="deliverable.format" submit={mk.deliverable.changeFormat} variant="outline" inline>
                      <input type="hidden" name="deliverableId" value={d.id} />
                      <Field label={mk.common.format} hint={mk.deliverable.changeFormatHint} className="min-w-56 flex-1">
                        <select name="formatKey" defaultValue={d.formatKey} className={inputCls}>
                          {formats.map((f) => (
                            <option key={f.key} value={f.key}>{locale === "en" ? f.nameEn : f.nameAr} — {f.width}×{f.height}</option>
                          ))}
                        </select>
                      </Field>
                    </ActionForm>
                  </div>
                </details>
              )}
            </div>
          )}
        </Section>
      )}

      <ContentSection
        {...ctx}
        ai={has("writer") && jobsView ? { initial: { status: ai.text, ...serializeJobs(jobsView) }, image: ai.image } : null}
      />
      <DesignSection {...ctx} />
      <QualitySection {...ctx} />
      <PublishSection {...ctx} />
      <DecisionsList mk={mk} approvals={d.approvals} />
      <CommentsTab mk={mk} actor={actor} campaignId={id} canWrite={roles.length > 0} deliverableId={d.id} />
      <AuditTab mk={mk} campaignId={id} deliverableId={d.id} locale={locale} />
    </main>
  );
}
