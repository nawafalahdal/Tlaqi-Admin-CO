import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, requireCampaignRole, type MkActor } from "./access";
import { logEvent } from "./audit";
import { completeIfAllPublished } from "./campaigns";
import { deliverableFacts, loadDeliverable, publishBlockers, reopenTasks, requireWorkable, writeDeliverable } from "./deliverables";
import { abort, fail, guarded, isUniqueViolation, type MkResult } from "./result";

/** فحصُ الجودة والنشر.
 *
 *  - **الفحصُ على زوجٍ بعينه:** نسخةُ النص ونسخةُ التصميم الحاليّتان، بأرقامهما.
 *    فإن تغيّر أحدُهما بعده سقط الفحص (`invalidateStale`).
 *  - **بنودُ الفحص كلُّها تُجاب** — ولا يجتاز المخرجُ ببندٍ لم يُنظر فيه.
 *  - **والمانعُ الجوهريّ يوقف المخرج** حتى يرفعه المنسّق بعد الحلّ.
 *  - **النشرُ يدويّ:** يُسجَّل بعد أن يؤكّد الناشرُ أنه رآه منشوراً، برابطه
 *    ووقته. ويُعاد قبله فحصُ كل الشروط من القاعدة، لا من الحالة وحدها. */

export const QUALITY_ITEMS = [
  "facts_sources",
  "language_tone",
  "links",
  "brand_identity",
  "arabic_legibility",
  "safe_area_text",
  "dimensions_quality",
  "text_design_consistency",
  "usage_rights",
] as const;
export type QualityItemKey = (typeof QUALITY_ITEMS)[number];
const CONTENT_ITEMS: QualityItemKey[] = ["facts_sources", "language_tone", "links"];

export async function sendToQuality(actor: MkActor, deliverableId: string): Promise<MkResult> {
  return guarded(async () => {
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      const access = await campaignAccess(actor, d.campaignId, tx);
      if (!access.canView) abort("not_found");
      if (!access.roles.has("designer") && !access.roles.has("coordinator")) abort("forbidden", { role: "designer" });
      requireWorkable(d);
      if (d.status !== "design_approved") abort("invalid_state", { from: d.status });
      const f = await deliverableFacts(tx, d.id);
      if (!f.contentApproved) abort("content_not_approved");
      if (!f.designOnCurrentContent) abort("design_not_current_content");
      if (!f.designApproved) abort("invalid_state", { from: d.status });
      await writeDeliverable(tx, d, { status: "quality_review" });
      await logEvent(tx, actor, { action: "quality.started", campaignId: d.campaignId, deliverableId: d.id });
    });
    return { ok: true };
  });
}

export async function recordQuality(
  actor: MkActor,
  deliverableId: string,
  input: {
    contentVersionId: string;
    designVersionId: string;
    items: { key: string; passed: boolean; note?: string }[];
    blocking?: boolean;
    note?: string;
  }
): Promise<MkResult<{ passed: boolean }>> {
  return guarded(async () => {
    const byKey = new Map(input.items.map((i) => [i.key, i]));
    const items = QUALITY_ITEMS.map((key) => {
      const i = byKey.get(key);
      if (!i) abort("invalid_input", { field: key });
      return { key, passed: !!i.passed, note: i.note?.trim().slice(0, 500) || null };
    });
    const passed = items.every((i) => i.passed);
    const note = input.note?.trim().slice(0, 1000) || null;
    if (!passed && !note) return fail("invalid_input", { field: "note" });
    const blocking = !passed && !!input.blocking;

    return prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      const { memberId } = await requireCampaignRole(actor, d.campaignId, "reviewer", tx);
      requireWorkable(d);
      if (d.status !== "quality_review") abort("invalid_state", { from: d.status });
      if (d.currentContentVersion?.id !== input.contentVersionId || d.currentDesignVersion?.id !== input.designVersionId) abort("version_not_current");
      const f = await deliverableFacts(tx, d.id);
      if (!f.contentApproved || !f.designApproved || !f.designOnCurrentContent) abort("invalid_state", { from: d.status });

      await tx.marketingQualityCheck.create({
        data: {
          deliverableId: d.id,
          contentVersionId: input.contentVersionId,
          designVersionId: input.designVersionId,
          items: items as Prisma.InputJsonValue,
          passed,
          blocking,
          note,
          reviewerId: memberId,
        },
      });
      if (passed) {
        await writeDeliverable(tx, d, { status: "ready_to_publish" });
      } else {
        const target = items.some((i) => !i.passed && CONTENT_ITEMS.includes(i.key)) ? "content" : "design";
        await writeDeliverable(tx, d, blocking
          ? { status: "blocked", statusBeforeBlock: "revision_required", revisionTarget: target, revisionNote: note }
          : { status: "revision_required", revisionTarget: target, revisionNote: note });
        await reopenTasks(tx, actor, d, target);
      }
      await logEvent(tx, actor, {
        action: passed ? "quality.passed" : "quality.failed",
        campaignId: d.campaignId,
        deliverableId: d.id,
        details: {
          content: d.currentContentVersion?.number ?? 0,
          design: d.currentDesignVersion?.number ?? 0,
          failed: items.filter((i) => !i.passed).map((i) => i.key),
          blocking,
        },
      });
      return { ok: true as const, passed };
    });
  });
}

function validUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** يُسجّل نشراً تمّ فعلاً — بعد أن يؤكّد الناشرُ أنه رآه حيّاً، وبعد إعادة فحص كل الشروط */
export async function recordPublication(
  actor: MkActor,
  deliverableId: string,
  input: { url: string; publishedAt: string | Date; confirmedLive: boolean; requestId?: string }
): Promise<MkResult<{ publicationId: string; duplicate?: boolean }>> {
  return guarded(async () => {
    const key = input.requestId?.slice(0, 80) || null;
    if (key) {
      const prior = await prisma.marketingPublication.findUnique({ where: { idempotencyKey: key }, select: { id: true, deliverableId: true } });
      if (prior && prior.deliverableId === deliverableId) return { ok: true, publicationId: prior.id, duplicate: true };
    }
    if (!input.confirmedLive) return fail("not_verified");
    const url = validUrl(String(input.url ?? ""));
    if (!url) return fail("url_invalid");
    const at = input.publishedAt instanceof Date ? input.publishedAt : new Date(String(input.publishedAt));
    // وقتُ نشرٍ في المستقبل ليس نشراً — مهلةُ خمس دقائق لفارق الساعات
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 5 * 60_000) return fail("invalid_input", { field: "publishedAt" });

    try {
      return await prisma.$transaction(async (tx) => {
        const d = await loadDeliverable(tx, deliverableId);
        const { memberId } = await requireCampaignRole(actor, d.campaignId, "publisher", tx);
        requireWorkable(d);
        if (d.status !== "ready_to_publish") abort("invalid_state", { from: d.status });
        const blockers = publishBlockers(await deliverableFacts(tx, d.id));
        if (blockers.length) abort("quality_not_passed", { missing: blockers.join(",") });
        if (at < d.createdAt) abort("invalid_input", { field: "publishedAt" });

        const p = await tx.marketingPublication.create({
          data: {
            deliverableId: d.id,
            contentVersionId: d.currentContentVersion!.id,
            designVersionId: d.currentDesignVersion!.id,
            platform: d.platform,
            url,
            publishedAt: at,
            verifiedAt: new Date(),
            publisherId: memberId,
            idempotencyKey: key,
          },
          select: { id: true },
        });
        await writeDeliverable(tx, d, { status: "published" });
        await logEvent(tx, actor, {
          action: "publication.recorded",
          campaignId: d.campaignId,
          deliverableId: d.id,
          details: { url, platform: d.platform, content: d.currentContentVersion!.number, design: d.currentDesignVersion!.number },
        });
        await completeIfAllPublished(tx, actor, d.campaignId);
        return { ok: true as const, publicationId: p.id };
      });
    } catch (e) {
      if (key && isUniqueViolation(e)) {
        const prior = await prisma.marketingPublication.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
        if (prior) return { ok: true as const, publicationId: prior.id, duplicate: true };
      }
      throw e;
    }
  });
}

export const METRIC_KEYS = ["reach", "impressions", "engagements", "clicks", "saves", "shares"] as const;

/** نتائجُ فعلية بمصدرها وتاريخها — يُدخلها الناشر، ولا يولّدها شيء */
export async function recordResults(
  actor: MkActor,
  publicationId: string,
  input: { metrics: Record<string, string | number | null | undefined>; asOf: string | Date; source: string }
): Promise<MkResult> {
  return guarded(async () => {
    const pub = await prisma.marketingPublication.findUnique({ where: { id: publicationId }, select: { id: true, deliverableId: true, publishedAt: true, deliverable: { select: { campaignId: true } } } });
    if (!pub) return fail("not_found");
    await requireCampaignRole(actor, pub.deliverable.campaignId, "publisher");
    const metrics: Record<string, number> = {};
    for (const k of METRIC_KEYS) {
      const raw = input.metrics[k];
      if (raw === undefined || raw === null || raw === "") continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) return fail("invalid_input", { field: k });
      metrics[k] = n;
    }
    if (Object.keys(metrics).length === 0) return fail("invalid_input", { field: "metrics" });
    const asOf = input.asOf instanceof Date ? input.asOf : new Date(String(input.asOf));
    if (Number.isNaN(asOf.getTime()) || asOf.getTime() > Date.now() + 5 * 60_000 || asOf < pub.publishedAt) return fail("invalid_input", { field: "asOf" });
    const source = input.source?.trim().slice(0, 200);
    if (!source) return fail("invalid_input", { field: "source" });
    await prisma.$transaction(async (tx) => {
      await tx.marketingPublication.update({ where: { id: pub.id }, data: { metrics, metricsAsOf: asOf, metricsSource: source } });
      await logEvent(tx, actor, {
        action: "publication.results_recorded",
        campaignId: pub.deliverable.campaignId,
        deliverableId: pub.deliverableId,
        details: { metrics, asOf: asOf.toISOString(), source },
      });
    });
    return { ok: true };
  });
}
