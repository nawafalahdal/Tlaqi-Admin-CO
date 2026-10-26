import type { MarketingDeliverableStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCampaignRole, type MkActor } from "./access";
import { logEvent } from "./audit";
import { deliverableFacts, invalidateStale, loadDeliverable, reopenTasks, requireWorkable, settingsFor, writeDeliverable } from "./deliverables";
import { abort, guarded, isUniqueViolation, type MkResult } from "./result";

/** النص: مسودةٌ تُحفظ ← نسخةٌ تُقدَّم (لا تُعدَّل) ← قرارُ كاتبٍ على تلك النسخة بعينها.
 *
 *  - **الحفظُ ليس تقديماً:** المسودةُ تتغيّر كلما حُفظت، ولا يعتمدها أحد.
 *  - **التقديمُ نسخةٌ جديدة** برقمٍ يزيد، تصير الحاليّة، وتُسقط كلَّ اعتمادٍ
 *    لنسخةٍ سابقة — ومعه اعتمادُ أيِّ تصميمٍ بُني عليها، وفحصُ الجودة.
 *  - **القرارُ يُسمّي النسخة:** من اعتمد النسخة ٣ والحاليّةُ صارت ٤ رُدّ —
 *    فلا يمرّ اعتمادُ نسخةٍ قديمة لأن صاحبه ضغط متأخراً.
 *  - **ومن كتب لا يعتمد ما كتب** ما دامت سياسةُ الفصل قائمة. */

export const MAX_BODY = 20_000;
export const MAX_SOURCES = 4_000;

export async function saveDraft(actor: MkActor, deliverableId: string, body: string): Promise<MkResult> {
  return guarded(async () => {
    const text = String(body ?? "").slice(0, MAX_BODY);
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      await requireCampaignRole(actor, d.campaignId, "writer", tx);
      requireWorkable(d);
      // المسودةُ لا تمسّ الحالة ولا الاعتمادات — ولا تتطلّب تزامناً متفائلاً: آخرُ حفظٍ يغلب
      await tx.marketingDeliverable.update({ where: { id: d.id }, data: { contentDraft: text, draftUpdatedAt: new Date() } });
    });
    return { ok: true };
  });
}

const SUBMITTABLE: MarketingDeliverableStatus[] = [
  "draft",
  "revision_required",
  "content_review",
  "content_approved",
  "design_review",
  "design_approved",
  "quality_review",
  "ready_to_publish",
];

export async function submitContent(
  actor: MkActor,
  deliverableId: string,
  input: { body?: string; changeNote?: string; sources?: string; requestId?: string }
): Promise<MkResult<{ versionId: string; number: number; duplicate?: boolean }>> {
  return guarded(async () => {
    const key = input.requestId?.slice(0, 80) || null;
    if (key) {
      // إعادةُ المحاولة بالطلب نفسه لا تُنشئ نسخةً ثانية
      const prior = await prisma.marketingContentVersion.findUnique({ where: { idempotencyKey: key }, select: { id: true, number: true, deliverableId: true } });
      if (prior && prior.deliverableId === deliverableId) return { ok: true, versionId: prior.id, number: prior.number, duplicate: true };
    }
    try {
      return await submitContentTx(actor, deliverableId, input, key);
    } catch (e) {
      // طلبان بالمفتاح نفسه في اللحظة نفسها: الثاني يُعيد ما أنشأه الأول
      if (key && isUniqueViolation(e)) {
        const prior = await prisma.marketingContentVersion.findUnique({ where: { idempotencyKey: key }, select: { id: true, number: true } });
        if (prior) return { ok: true as const, versionId: prior.id, number: prior.number, duplicate: true };
      }
      throw e;
    }
  });
}

async function submitContentTx(
  actor: MkActor,
  deliverableId: string,
  input: { body?: string; changeNote?: string; sources?: string },
  key: string | null
) {
    return prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      const { memberId } = await requireCampaignRole(actor, d.campaignId, "writer", tx);
      requireWorkable(d);
      if (!SUBMITTABLE.includes(d.status)) abort("invalid_state", { from: d.status });
      const body = (input.body ?? d.contentDraft).trim().slice(0, MAX_BODY);
      if (!body) abort("invalid_input", { field: "body" });
      // نسخةٌ مطابقةٌ للحاليّة ليست تغييراً — لا تُسقط اعتماداً بلا سبب
      if (d.currentContentVersion && d.currentContentVersion.body === body) abort("invalid_input", { field: "unchanged" });

      const last = await tx.marketingContentVersion.findFirst({ where: { deliverableId: d.id }, orderBy: { number: "desc" }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      const v = await tx.marketingContentVersion.create({
        data: {
          deliverableId: d.id,
          number,
          body,
          changeNote: input.changeNote?.trim().slice(0, 1000) || null,
          sources: input.sources?.trim().slice(0, MAX_SOURCES) || null,
          authorId: memberId,
          idempotencyKey: key,
        },
        select: { id: true },
      });
      await writeDeliverable(tx, d, {
        currentContentVersionId: v.id,
        contentDraft: body,
        draftUpdatedAt: new Date(),
        status: "content_review",
        revisionTarget: null,
        revisionNote: null,
      });
      await invalidateStale(tx, actor, d.id, `content_v${number}`);
      await logEvent(tx, actor, { action: "content.submitted", campaignId: d.campaignId, deliverableId: d.id, details: { version: number } });
      return { ok: true as const, versionId: v.id, number };
    });
}

export async function decideContent(
  actor: MkActor,
  deliverableId: string,
  input: { versionId: string; decision: "approved" | "changes_requested"; note?: string }
): Promise<MkResult> {
  return guarded(async () => {
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      const { memberId } = await requireCampaignRole(actor, d.campaignId, "writer", tx);
      requireWorkable(d);
      if (d.status !== "content_review") abort("invalid_state", { from: d.status });
      if (!d.currentContentVersion || d.currentContentVersion.id !== input.versionId) abort("version_not_current");
      const { requireSeparateApprover } = await settingsFor(tx);
      if (input.decision === "approved" && requireSeparateApprover && d.currentContentVersion.authorId === memberId) {
        abort("separate_approver_required");
      }
      const note = input.note?.trim().slice(0, 1000) || null;
      if (input.decision === "changes_requested" && !note) abort("invalid_input", { field: "note" });

      await writeDeliverable(tx, d, input.decision === "approved"
        ? { status: "content_approved" }
        : { status: "revision_required", revisionTarget: "content", revisionNote: note });
      await tx.marketingApproval.create({
        data: { deliverableId: d.id, kind: "content", contentVersionId: d.currentContentVersion.id, decision: input.decision, note, deciderId: memberId },
      });
      if (input.decision === "changes_requested") await reopenTasks(tx, actor, d, "content");
      await logEvent(tx, actor, {
        action: input.decision === "approved" ? "content.approved" : "content.changes_requested",
        campaignId: d.campaignId,
        deliverableId: d.id,
        details: { version: d.currentContentVersion.number, ...(note ? { note } : {}) },
      });
    });
    return { ok: true };
  });
}

/** المصمّمُ أعاد النصَّ والكاتبُ يرى أنه يبقى كما هو — واعتمادُه ما زال قائماً */
export async function keepApprovedContent(actor: MkActor, deliverableId: string): Promise<MkResult> {
  return guarded(async () => {
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      await requireCampaignRole(actor, d.campaignId, "writer", tx);
      requireWorkable(d);
      if (d.status !== "revision_required" || d.revisionTarget !== "content") abort("invalid_state", { from: d.status });
      const facts = await deliverableFacts(tx, d.id);
      if (!facts.contentApproved) abort("content_not_approved");
      await writeDeliverable(tx, d, { status: "content_approved", revisionTarget: null, revisionNote: null });
      await logEvent(tx, actor, { action: "content.approved", campaignId: d.campaignId, deliverableId: d.id, details: { kept: true, version: d.currentContentVersion?.number ?? 0 } });
    });
    return { ok: true };
  });
}

// ─── الفحص الآلي المساعد للنص — اقتراحاتٌ تُعرض، لا قرارات ─────────────

/** حدودُ طولٍ معروفةٌ عن المنصات — للتنبيه وحده، والمراجعُ يحكم */
const LENGTH_HINT: Record<string, number> = { x: 280, instagram: 2200, linkedin: 3000, tiktok: 2200, facebook: 5000, snapchat: 250 };

export type TextCheck = { key: string; level: "ok" | "warn"; params?: Record<string, string | number> };

export function contentChecks(body: string, sources: string | null, platform: string): TextCheck[] {
  const out: TextCheck[] = [];
  const limit = LENGTH_HINT[platform.toLowerCase()];
  if (limit) out.push(body.length > limit ? { key: "length_over", level: "warn", params: { length: body.length, limit } } : { key: "length_ok", level: "ok", params: { length: body.length, limit } });
  const urls = body.match(/\bhttps?:\/\/[^\s)]+/gi) ?? [];
  const insecure = urls.filter((u) => u.toLowerCase().startsWith("http://"));
  const broken = urls.filter((u) => {
    try {
      new URL(u);
      return false;
    } catch {
      return true;
    }
  });
  if (insecure.length) out.push({ key: "link_insecure", level: "warn", params: { count: insecure.length } });
  if (broken.length) out.push({ key: "link_malformed", level: "warn", params: { count: broken.length } });
  if (/\bwww\.[^\s]+/i.test(body) && urls.length === 0) out.push({ key: "link_no_scheme", level: "warn" });
  // رقمٌ أو نسبةٌ بلا مصدر: ادّعاءٌ يحتاج من يتحقق منه
  if (/[0-9٠-٩]+\s*[%٪]|[0-9٠-٩]{2,}/.test(body) && !sources?.trim()) out.push({ key: "claim_without_source", level: "warn" });
  if (!out.some((c) => c.level === "warn")) out.push({ key: "no_issues", level: "ok" });
  return out;
}
