import Link from "next/link";
import type { Dictionary } from "@/i18n";
import { fmt } from "@/i18n/fmt";
import type { WorkItem, WorkStage } from "@/lib/marketing/workQueue";
import { ActionForm } from "./ActionForm";
import { Muted, Pager, Pill, Section, when, type Tone } from "./bits";

type Mk = Dictionary["mk"];

const ANCHOR: Record<WorkItem["next"], string> = {
  write: "content", revise_content: "content", approve_content: "content", add_design: "design", revise_design: "design", approve_design: "design",
  send_quality: "design", quality: "quality", final_check: "final-check", publish: "publish", archiving: "publish", retry_archive: "publish", unblock: "content",
};
const toneOf = (v: string): Tone => (v === "approved" || v === "ready" ? "good" : v === "changes" || v === "archive_failed" ? "bad" : v === "in_review" || v === "quality" || v === "final_check" ? "review" : v === "not_started" || v === "waiting_text" || v === "not_yet" ? "neutral" : "progress");

/** قائمةُ منشورات المرحلة: بطاقةٌ لكل منشور بأعمدته المطلوبة — الحملة، ورقمُ المنشور فيها، وعنوانه،
 *  وحالاتُ المحتوى والتصميم والاعتماد، ومن عليه الخطوة، وآخرُ تحديث، والإجراءُ التالي (رابطٌ إلى موضعه).
 *  بطاقاتٌ لا جدول: تُقرأ على الهاتف كما على الشاشة الواسعة. */
export function WorkQueueView({ mk, stage, items, total, page, pages }: { mk: Mk; stage: WorkStage; items: WorkItem[]; total: number; page: number; pages: number }) {
  const L = mk.work;
  return (
    <Section title={`${L.titles[stage]} — ${fmt(L.total, total)}`} hint={L.hints[stage]}>
      {items.length === 0 ? (
        <Muted>{L.empty}</Muted>
      ) : (
        <ul className="flex flex-col gap-3" data-work-queue={stage}>
          {items.map((it) => {
            const href = `/marketing/campaigns/${it.campaignId}/deliverables/${it.id}#${ANCHOR[it.next]}`;
            return (
              <li key={it.id} data-work-item={it.id} className={`rounded-xl border p-3 ${it.mine ? "border-[#c34900]/40 bg-[#c34900]/[0.03]" : "border-black/[0.08]"}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-md bg-[#1a0e1c] px-2 py-0.5 text-[11px] font-bold text-[#EEF6DF]">{it.seq != null ? fmt(L.seq, it.seq) : "—"}</span>
                  <Link href={href} className="text-sm font-bold hover:underline">{it.title}</Link>
                  <span className="text-xs text-black/55">{it.platform}{it.contentType ? ` · ${it.contentType}` : ""}</span>
                  {it.mine && <Pill tone="review">{L.mine}</Pill>}
                </div>
                <p className="mt-1 text-xs text-black/60">
                  {L.columns.campaign}: <Link href={`/marketing/campaigns/${it.campaignId}`} className="font-bold hover:underline">{it.campaignName}</Link>
                </p>
                <dl className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  <div className="flex items-center gap-2"><dt className="text-black/50">{L.columns.content}</dt><dd><Pill tone={toneOf(it.content)}>{L.contentState[it.content]}</Pill></dd></div>
                  <div className="flex items-center gap-2"><dt className="text-black/50">{L.columns.design}</dt><dd><Pill tone={toneOf(it.design)}>{L.designState[it.design]}</Pill></dd></div>
                  <div className="flex items-center gap-2"><dt className="text-black/50">{L.columns.approval}</dt><dd><Pill tone={toneOf(it.approval)}>{L.approvalState[it.approval]}</Pill></dd></div>
                </dl>
                {stage === "publishing" && <PublishingDetails mk={mk} it={it} />}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-black/5 pt-2 text-xs">
                  <span><span className="text-black/50">{L.columns.owner}: </span><span className="font-bold">{L.owner[it.ownerRole]}</span>{it.owners.length > 0 ? ` — ${it.owners.join("، ")}` : it.ownerRole !== "system" ? ` — ${L.unassigned}` : ""}</span>
                  <span className="text-black/50">{L.columns.updated}: {when(it.updatedAt)}</span>
                  <Link href={href} className="ms-auto rounded-lg border border-black/10 px-2.5 py-1 font-bold hover:bg-black/[0.04]">{L.columns.next}: {L.next[it.next]}</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3">
        <Pager page={page} pages={pages} href={(n) => `/marketing/${stage}?p=${n}`} labels={mk.common} />
      </div>
    </Section>
  );
}

/** «الاعتماد والنشر»: النصُّ والتصميمُ وروابطُهما وحالةُ الأرشفة — مقتطفاتٌ، والكاملُ في صفحة المنشور */
function PublishingDetails({ mk, it }: { mk: Mk; it: WorkItem }) {
  const L = mk.work;
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-black/[0.02] p-2 text-xs sm:grid-cols-2">
      <div>
        <p className="font-bold text-black/60">{L.text}</p>
        {it.text ? <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap leading-relaxed" dir="auto">{it.text}</p> : <Muted>{L.noText}</Muted>}
      </div>
      <div className="flex flex-col gap-1">
        {it.designLink && (
          <p><span className="font-bold text-black/60">{L.designLink}: </span><a href={it.designLink} target="_blank" rel="noopener noreferrer" className="break-all underline-offset-2 hover:underline" dir="ltr">{it.designLink}</a></p>
        )}
        {!it.designLink && it.designFileId && (
          <p><span className="font-bold text-black/60">{L.designFile}: </span><a href={`/api/marketing/files/${it.designFileId}`} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">{mk.common.download}</a></p>
        )}
        {it.designDescription && <p className="line-clamp-3" dir="auto"><span className="font-bold text-black/60">{L.designDescription}: </span>{it.designDescription}</p>}
        {it.postUrl && (
          <p><span className="font-bold text-black/60">{L.postLink}: </span><a href={it.postUrl} target="_blank" rel="noopener noreferrer" className="break-all underline-offset-2 hover:underline" dir="ltr">{it.postUrl}</a></p>
        )}
      </div>
      {it.approval === "archiving" && <p className="text-[#1a0e1c]/70 sm:col-span-2">{L.archivePending}</p>}
      {it.approval === "archive_failed" && (
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <p className="text-red-800">{fmt(L.archiveFailed, mk.archive.errors[(it.archiveError?.split(":")[0] ?? "sheet_error") as keyof typeof mk.archive.errors] ?? it.archiveError ?? "—")}</p>
          {it.mine && (
            <ActionForm op="post.archiveRetry" submit={L.retry} variant="outline" inline>
              <input type="hidden" name="deliverableId" value={it.id} />
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
