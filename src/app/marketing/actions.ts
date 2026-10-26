"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDictionary, getLocale } from "@/i18n/server";
import { marketingActor, type MkActor } from "@/lib/marketing/access";
import { mkMessage } from "@/lib/marketing/messages";
import type { MkResult } from "@/lib/marketing/result";
import { createCampaign, updateBrief, transitionCampaign, addCampaignMember, removeCampaignMember } from "@/lib/marketing/campaigns";
import { createDeliverable, changeFormat, setDeliverableBlocked } from "@/lib/marketing/deliverables";
import { saveDraft, submitContent, decideContent, keepApprovedContent } from "@/lib/marketing/content";
import { uploadDesign, submitDesign, decideDesign, returnToWriter } from "@/lib/marketing/design";
import { sendToQuality, recordQuality, recordPublication, recordResults, QUALITY_ITEMS, METRIC_KEYS } from "@/lib/marketing/review";
import { createTask, setTaskStatus, deleteTask, addComment, attachToTask } from "@/lib/marketing/tasks";
import { addTeamMember, setCapabilities, setMemberActive, updateSettings } from "@/lib/marketing/team";
import { createFormat, updateFormat } from "@/lib/marketing/formats";
import { requestTextSuggestion, processJob, processDue, cancelJob, retryJob, adoptSuggestion, deliverableJobs } from "@/lib/marketing/ai/jobs";
import { aiStatus } from "@/lib/marketing/ai/registry";
import { serializeJobs } from "@/lib/marketing/ai/view";
import type { MarketingCampaignRole, MarketingCampaignStatus } from "@prisma/client";

/** إجراءاتُ وكيل التسويق — بابٌ واحدٌ تُسمّى فيه العمليةُ (`op`).
 *
 *  **والحرسُ ليس هنا:** كلُّ عمليةٍ تستدعي خدمتَها في `@/lib/marketing`، وهي
 *  تفحص المسؤوليةَ في الحملة والحالةَ والإصدار في معاملتها. فلو استُدعي هذا
 *  البابُ بنموذجٍ مصطنع لم يتجاوز شيئاً — النموذجُ في الواجهة راحةٌ لا حماية.
 *
 *  والنتيجةُ رمزٌ يُترجَم بلغة صاحب الطلب (`mkMessage`)، لا استثناءٌ يبلغ
 *  حاجزَ الأخطاء العام فيُقال «تعذّر» بلا سبب. */

export type OpState = { ok: boolean | null; message: string | null; at: number };

type Fd = FormData;
type Handler = (actor: MkActor, fd: Fd, locale: "ar" | "en") => Promise<MkResult<object> & { redirectTo?: string }>;

const s = (fd: Fd, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const on = (fd: Fd, k: string) => fd.get(k) === "on" || fd.get(k) === "1" || fd.get(k) === "true";
const all = (fd: Fd, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");

/** أوقاتُ النماذج بلا منطقة (`date` و`datetime-local`) تُقرأ بتوقيت الرياض — توقيتِ المنصة */
const riyadhDate = (v: string, endOfDay = true) => (v ? `${v}T${endOfDay ? "23:59:00" : "12:00:00"}+03:00` : null);
const riyadhDateTime = (v: string) => (v ? `${v.length === 16 ? v + ":00" : v}+03:00` : "");

async function fileOf(fd: Fd, k: string) {
  const f = fd.get(k);
  if (!f || typeof f === "string" || f.size === 0) return null;
  return { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) };
}

const brief = (fd: Fd) => ({
  name: s(fd, "name"),
  description: s(fd, "description"),
  objective: s(fd, "objective"),
  audience: s(fd, "audience"),
  keyMessage: s(fd, "keyMessage"),
  channels: s(fd, "channels").split(/[,،\s]+/),
  deadline: riyadhDate(s(fd, "deadline")),
  priority: s(fd, "priority"),
});

const OPS: Record<string, Handler> = {
  "campaign.create": async (a, fd) => {
    const r = await createCampaign(a, brief(fd));
    return r.ok ? { ...r, redirectTo: `/marketing/campaigns/${r.campaignId}` } : r;
  },
  "campaign.brief": (a, fd) => updateBrief(a, s(fd, "campaignId"), brief(fd)),
  "campaign.transition": (a, fd) =>
    transitionCampaign(a, s(fd, "campaignId"), s(fd, "to") as MarketingCampaignStatus, {
      reason: s(fd, "reason"),
      expectedRevision: fd.has("revision") ? Number(s(fd, "revision")) : undefined,
    }),
  "campaign.member.add": (a, fd) =>
    addCampaignMember(a, s(fd, "campaignId"), { marketingMemberId: s(fd, "memberId"), role: s(fd, "role") as MarketingCampaignRole }),
  "campaign.member.remove": (a, fd) => removeCampaignMember(a, s(fd, "campaignId"), s(fd, "rowId")),

  "deliverable.create": (a, fd) => createDeliverable(a, s(fd, "campaignId"), { title: s(fd, "title"), platform: s(fd, "platform"), formatKey: s(fd, "formatKey") }),
  "deliverable.format": (a, fd) => changeFormat(a, s(fd, "deliverableId"), s(fd, "formatKey")),
  "deliverable.block": (a, fd) => setDeliverableBlocked(a, s(fd, "deliverableId"), s(fd, "blocked") === "1", s(fd, "reason")),

  "content.draft": (a, fd) => saveDraft(a, s(fd, "deliverableId"), s(fd, "body")),
  "content.submit": (a, fd) =>
    submitContent(a, s(fd, "deliverableId"), { body: s(fd, "body"), changeNote: s(fd, "changeNote"), sources: s(fd, "sources"), requestId: s(fd, "requestId") }),
  "content.decide": (a, fd) =>
    decideContent(a, s(fd, "deliverableId"), { versionId: s(fd, "versionId"), decision: s(fd, "decision") === "approved" ? "approved" : "changes_requested", note: s(fd, "note") }),
  "content.keep": (a, fd) => keepApprovedContent(a, s(fd, "deliverableId")),

  "design.upload": async (a, fd) =>
    uploadDesign(a, s(fd, "deliverableId"), { file: await fileOf(fd, "file"), changeNote: s(fd, "changeNote"), requestId: s(fd, "requestId") }),
  "design.submit": (a, fd) => submitDesign(a, s(fd, "deliverableId"), s(fd, "versionId")),
  "design.decide": (a, fd) =>
    decideDesign(a, s(fd, "deliverableId"), { designVersionId: s(fd, "versionId"), decision: s(fd, "decision") === "approved" ? "approved" : "changes_requested", note: s(fd, "note") }),
  "design.return": (a, fd) => returnToWriter(a, s(fd, "deliverableId"), s(fd, "note")),

  "quality.send": (a, fd) => sendToQuality(a, s(fd, "deliverableId")),
  "quality.record": (a, fd) =>
    recordQuality(a, s(fd, "deliverableId"), {
      contentVersionId: s(fd, "contentVersionId"),
      designVersionId: s(fd, "designVersionId"),
      items: QUALITY_ITEMS.map((key) => ({ key, passed: on(fd, `item.${key}`), note: s(fd, `note.${key}`) })),
      blocking: on(fd, "blocking"),
      note: s(fd, "note"),
    }),
  "publish.record": (a, fd) =>
    recordPublication(a, s(fd, "deliverableId"), {
      url: s(fd, "url"),
      publishedAt: riyadhDateTime(s(fd, "publishedAt")),
      confirmedLive: on(fd, "confirmedLive"),
      requestId: s(fd, "requestId"),
    }),
  "publish.results": (a, fd) =>
    recordResults(a, s(fd, "publicationId"), {
      metrics: Object.fromEntries(METRIC_KEYS.map((k) => [k, s(fd, `metric.${k}`)])),
      asOf: riyadhDate(s(fd, "asOf"), false) ?? "",
      source: s(fd, "source"),
    }),

  "task.create": (a, fd) =>
    createTask(a, s(fd, "campaignId"), {
      title: s(fd, "title"),
      description: s(fd, "description"),
      kind: s(fd, "kind"),
      deliverableId: s(fd, "deliverableId") || null,
      assigneeId: s(fd, "assigneeId") || null,
      dueAt: riyadhDate(s(fd, "dueAt")),
      priority: s(fd, "priority"),
      dependsOn: all(fd, "dependsOn"),
    }),
  "task.status": (a, fd) => setTaskStatus(a, s(fd, "taskId"), s(fd, "status")),
  "task.delete": (a, fd) => deleteTask(a, s(fd, "taskId")),
  "task.attach": async (a, fd) => attachToTask(a, s(fd, "taskId"), await fileOf(fd, "file")),
  "comment.add": (a, fd) =>
    addComment(a, s(fd, "campaignId"), { body: s(fd, "body"), deliverableId: s(fd, "deliverableId") || null, taskId: s(fd, "taskId") || null }),

  "team.add": (a, fd) => {
    const [kind, id] = s(fd, "person").split(":");
    return addTeamMember(a, { kind: kind === "member" ? "member" : "user", id: id ?? "", capabilities: all(fd, "capabilities") });
  },
  "team.caps": (a, fd) => setCapabilities(a, s(fd, "memberId"), all(fd, "capabilities")),
  "team.active": (a, fd) => setMemberActive(a, s(fd, "memberId"), s(fd, "active") === "1"),
  "settings.policy": (a, fd) => updateSettings(a, { requireSeparateApprover: on(fd, "requireSeparateApprover") }),
  "format.create": (a, fd) => createFormat(a, formatInput(fd)),
  "format.update": (a, fd) => updateFormat(a, s(fd, "formatId"), formatInput(fd)),

  "ai.request": async (a, fd, locale) => {
    const r = await requestTextSuggestion(a, s(fd, "deliverableId"), {
      instructions: s(fd, "instructions"),
      variants: Number(s(fd, "variants")),
      locale: s(fd, "language") === "en" ? "en" : s(fd, "language") === "ar" ? "ar" : locale,
      requestId: s(fd, "requestId"),
    });
    // يُعالَج بعد خروج الردّ في الطلب نفسه — فلا ينتظره أحد، ولا يضيع إن أُغلقت الصفحة
    if (r.ok) after(() => processJob(r.jobId).then(() => undefined));
    return r;
  },
  "ai.cancel": (a, fd) => cancelJob(a, s(fd, "jobId")),
  "ai.retry": async (a, fd) => {
    const r = await retryJob(a, s(fd, "jobId"));
    if (r.ok) after(() => processJob(s(fd, "jobId")).then(() => undefined));
    return r;
  },
  "ai.adopt": (a, fd) => adoptSuggestion(a, s(fd, "jobId"), { variant: Number(s(fd, "variant")), replaceEdited: on(fd, "replaceEdited") }),
};

function formatInput(fd: Fd) {
  return {
    key: s(fd, "key"),
    nameAr: s(fd, "nameAr"),
    nameEn: s(fd, "nameEn"),
    width: s(fd, "width"),
    height: s(fd, "height"),
    safeTop: s(fd, "safeTop"),
    safeRight: s(fd, "safeRight"),
    safeBottom: s(fd, "safeBottom"),
    safeLeft: s(fd, "safeLeft"),
    platforms: s(fd, "platforms").split(/[,،\s]+/),
    active: fd.has("activeField") ? on(fd, "active") : undefined,
  };
}

export async function runMarketingOp(_prev: OpState, fd: FormData): Promise<OpState> {
  const locale = await getLocale();
  const mk = getDictionary(locale).mk;
  const at = Date.now();
  let redirectTo: string | undefined;
  try {
    const session = await auth();
    if (!session) return { ok: false, message: mk.errors.unauthenticated, at };
    const actor = await marketingActor(session);
    if (!actor) return { ok: false, message: mk.errors.no_access, at };
    const handler = OPS[s(fd, "op")];
    if (!handler) return { ok: false, message: mk.errors.invalid_state, at };
    const r = await handler(actor, fd, locale);
    if (!r.ok) return { ok: false, message: mkMessage(mk, r, locale), at };
    revalidatePath("/marketing", "layout");
    redirectTo = r.redirectTo;
  } catch (err) {
    // لا يُعرض نصُّ الاستثناء: قد يحمل تفاصيلَ قاعدةٍ أو مسار
    console.error("[marketing] تعذّرت العملية:", s(fd, "op"), err instanceof Error ? err.name : typeof err);
    return { ok: false, message: mk.errors.unknown, at };
  }
  // خارج `try`: `redirect` يُرمى ليُنفَّذ، ولو التُقط لصار خطأً
  if (redirectTo) redirect(redirectTo);
  return { ok: true, message: mk.common.saved, at };
}

/** متابعةُ طلبات التوليد لمخرج — تقرأ الحالة، وتُشغّل ما حان (إعادةً مجدولة) بعد الردّ */
export async function pollAiJobs(deliverableId: string) {
  const session = await auth();
  if (!session) return null;
  const actor = await marketingActor(session);
  if (!actor) return null;
  const view = await deliverableJobs(actor, deliverableId);
  if (!view) return null;
  const now = Date.now();
  const due = view.jobs.some(
    (j) => j.status === "queued" && (!j.nextAttemptAt || j.nextAttemptAt.getTime() <= now)
  );
  if (due) after(() => processDue({ deliverableId, limit: 2 }).then(() => undefined));
  return { status: aiStatus().text, ...serializeJobs(view) };
}
