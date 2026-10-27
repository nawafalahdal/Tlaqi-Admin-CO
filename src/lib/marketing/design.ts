import { createHash } from "node:crypto";
import sharp from "sharp";
import type { MarketingDeliverableStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, requireCampaignRole, type MkActor } from "./access";
import { logEvent } from "./audit";
import { checksPass, deliverableFacts, invalidateStale, loadDeliverable, reopenTasks, requireWorkable, settingsFor, writeDeliverable } from "./deliverables";
import { requireBriefComplete } from "./designBrief";
import { abort, fail, guarded, isUniqueViolation, type MkResult } from "./result";

/** التصميم: ملفٌّ يرفعه المصمّم لمقاسٍ بعينه، مبنيٌّ على نسخة نصٍّ معتمدةٍ بعينها.
 *
 *  - **لا تصميمَ قبل نصٍّ معتمد:** الرفعُ يشترط اعتمادَ النسخة الحاليّة، ويحفظ
 *    رقمها مع التصميم. فإن تغيّر النص بعد ذلك صار التصميمُ «مبنياً على نسخةٍ
 *    قديمة» وسقط اعتمادُه.
 *  - **الرفعُ مسودة، والتقديمُ للمراجعة خطوةٌ ثانية** — ولا يُقدَّم تصميمٌ فشل
 *    في فحصٍ مانع (مقاسٌ غيرُ مطابق، دقةٌ أقلّ من المطلوب، ملفٌّ تالف).
 *  - **الملفُّ لا يُستبدل في مكانه:** كلُّ رفعٍ ملفٌّ جديدٌ ونسخةٌ برقمٍ جديد.
 *  - **ونجاحُ الفحص الآلي ليس اعتماداً:** يقول إن المقاس صحيح والملف سليم، لا
 *    إن التصميم جيد. ذلك قرارُ المصمّم المراجع، ثم فحصُ الجودة. */

export const DESIGN_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** أقلُّ من حدّ جسم الإجراء (ثمانيةُ ميغابايت) ليُرفض داخله برسالةٍ مفهومة */
export const MAX_DESIGN_BYTES = 7 * 1024 * 1024;
/** حدُّ البكسلات عند فكّ الصورة — يحمي الخادم من صورةٍ ضخمةٍ صغيرةِ الحجم */
const MAX_PIXELS = 64_000_000;
const RATIO_TOLERANCE = 0.005;

export type DesignCheck = { key: string; level: "ok" | "warn" | "fail"; params?: Record<string, string | number> };

/** يفحص الملف فعلاً: يُفكّ كاملاً (فيُكشف التالفُ والمقطوع)، ويُقرأ نوعُه من محتواه لا من اسمه */
export async function inspectDesign(
  bytes: Uint8Array,
  target: { width: number; height: number }
): Promise<{ ok: true; format: string; width: number; height: number; checks: DesignCheck[] } | { ok: false; code: "file_type" | "file_corrupt" }> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  let stats: Awaited<ReturnType<ReturnType<typeof sharp>["stats"]>>;
  try {
    const img = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "truncated" });
    meta = await img.metadata();
    if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format)) return { ok: false, code: "file_type" };
    stats = await img.stats();
  } catch {
    return { ok: false, code: "file_corrupt" };
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return { ok: false, code: "file_corrupt" };

  const checks: DesignCheck[] = [];
  const want = target.width / target.height;
  const got = width / height;
  if (width === target.width && height === target.height) {
    checks.push({ key: "dimensions_exact", level: "ok", params: { width, height } });
  } else if (Math.abs(got - want) / want > RATIO_TOLERANCE) {
    checks.push({ key: "aspect_mismatch", level: "fail", params: { width, height, targetWidth: target.width, targetHeight: target.height } });
  } else if (width < target.width) {
    checks.push({ key: "resolution_low", level: "fail", params: { width, height, targetWidth: target.width, targetHeight: target.height } });
  } else {
    checks.push({ key: "dimensions_scaled", level: "warn", params: { width, height, targetWidth: target.width, targetHeight: target.height } });
  }
  // صورةٌ بلونٍ واحدٍ تقريباً: غالباً تصديرٌ فارغ
  if (stats.channels.slice(0, 3).every((c: { stdev: number }) => c.stdev < 2)) checks.push({ key: "image_blank", level: "warn" });
  if (meta.hasAlpha && meta.format === "jpeg") checks.push({ key: "alpha_jpeg", level: "warn" });
  checks.push({ key: "file_integrity", level: "ok", params: { format: meta.format } });
  return { ok: true, format: meta.format, width, height, checks };
}

/** يطابق المقاسَ الحالي: النسبةُ نفسها، والدقةُ لا تقلّ عنه */
export function fitsFormat(v: { width: number; height: number }, target: { width: number; height: number }) {
  const want = target.width / target.height;
  return Math.abs(v.width / v.height - want) / want <= RATIO_TOLERANCE && v.width >= target.width;
}

const DESIGNABLE: MarketingDeliverableStatus[] = ["content_approved", "design_review", "design_approved", "quality_review", "ready_to_publish", "revision_required"];

function requireDesignPhase(d: { status: MarketingDeliverableStatus; revisionTarget: string | null }) {
  if (!DESIGNABLE.includes(d.status)) abort("invalid_state", { from: d.status });
  // النصُّ أُعيد للكاتب: لا يُبنى تصميمٌ عليه حتى يُحسم
  if (d.status === "revision_required" && d.revisionTarget !== "design") abort("invalid_state", { from: d.status });
}

export async function uploadDesign(
  actor: MkActor,
  deliverableId: string,
  input: { file: { name: string; type: string; bytes: Uint8Array } | null; changeNote?: string; requestId?: string }
): Promise<MkResult<{ versionId: string; number: number; checks: DesignCheck[]; duplicate?: boolean }>> {
  return guarded(async () => {
    const key = input.requestId?.slice(0, 80) || null;
    if (key) {
      const prior = await prisma.marketingDesignVersion.findUnique({ where: { idempotencyKey: key }, select: { id: true, number: true, deliverableId: true, checks: true } });
      if (prior && prior.deliverableId === deliverableId) return { ok: true, versionId: prior.id, number: prior.number, checks: prior.checks as DesignCheck[], duplicate: true };
    }
    const file = input.file;
    if (!file || file.bytes.byteLength === 0) return fail("invalid_input", { field: "file" });
    if (file.bytes.byteLength > MAX_DESIGN_BYTES) return fail("file_too_large", { maxMb: 7 });
    if (!(DESIGN_TYPES as readonly string[]).includes(file.type)) return fail("file_type");

    // الصلاحيةُ قبل فكّ الصورة: لا يُشغَّل فحصٌ ثقيلٌ لمن لا يملك الرفع
    const head = await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { campaignId: true, width: true, height: true } });
    if (!head) return fail("not_found");
    await requireCampaignRole(actor, head.campaignId, "designer");
    const inspected = await inspectDesign(file.bytes, head);
    if (!inspected.ok) return fail(inspected.code);
    // النوعُ المُعلَن يجب أن يطابق المحتوى — لا PNG باسم JPEG
    const declared = file.type.split("/")[1];
    if (declared !== inspected.format) return fail("file_type");

    try {
      return await prisma.$transaction(async (tx) => {
        const d = await loadDeliverable(tx, deliverableId);
        const { memberId } = await requireCampaignRole(actor, d.campaignId, "designer", tx);
        requireWorkable(d);
        requireDesignPhase(d);
        const facts = await deliverableFacts(tx, d.id);
        if (!facts.contentApproved || !d.currentContentVersion) abort("content_not_approved");
        // لا تصميمَ قبل موجزٍ مكتمل — يُفرض هنا لا في إخفاء النموذج
        await requireBriefComplete(tx, d.id);
        // المقاسُ تغيّر منذ قُرئ: يُعاد الفحصُ على المقاس الحالي
        if (d.width !== head.width || d.height !== head.height) abort("stale");

        const last = await tx.marketingDesignVersion.findFirst({ where: { deliverableId: d.id }, orderBy: { number: "desc" }, select: { number: true } });
        const number = (last?.number ?? 0) + 1;
        const stored = await tx.marketingFile.create({
          data: {
            campaignId: d.campaignId,
            deliverableId: d.id,
            kind: "design",
            fileName: file.name.slice(0, 200) || `design-v${number}.${inspected.format}`,
            mimeType: file.type,
            byteSize: file.bytes.byteLength,
            sha256: createHash("sha256").update(file.bytes).digest("hex"),
            data: Buffer.from(file.bytes),
            width: inspected.width,
            height: inspected.height,
            uploadedById: memberId,
          },
          select: { id: true },
        });
        const v = await tx.marketingDesignVersion.create({
          data: {
            deliverableId: d.id,
            number,
            basedOnContentVersionId: d.currentContentVersion.id,
            fileId: stored.id,
            width: inspected.width,
            height: inspected.height,
            checks: inspected.checks,
            changeNote: input.changeNote?.trim().slice(0, 1000) || null,
            authorId: memberId,
            idempotencyKey: key,
          },
          select: { id: true },
        });
        await logEvent(tx, actor, {
          action: "design.uploaded",
          campaignId: d.campaignId,
          deliverableId: d.id,
          details: { version: number, basedOnContent: d.currentContentVersion.number, width: inspected.width, height: inspected.height, passed: checksPass(inspected.checks) },
        });
        return { ok: true as const, versionId: v.id, number, checks: inspected.checks };
      });
    } catch (e) {
      if (key && isUniqueViolation(e)) {
        const prior = await prisma.marketingDesignVersion.findUnique({ where: { idempotencyKey: key }, select: { id: true, number: true, checks: true } });
        if (prior) return { ok: true as const, versionId: prior.id, number: prior.number, checks: prior.checks as DesignCheck[], duplicate: true };
      }
      throw e;
    }
  });
}

export async function submitDesign(actor: MkActor, deliverableId: string, designVersionId: string): Promise<MkResult> {
  return guarded(async () => {
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      await requireCampaignRole(actor, d.campaignId, "designer", tx);
      requireWorkable(d);
      requireDesignPhase(d);
      const v = await tx.marketingDesignVersion.findFirst({ where: { id: designVersionId, deliverableId: d.id } });
      if (!v) abort("not_found");
      if (v.submittedAt) abort("invalid_state", { from: "submitted" });
      if (!d.currentContentVersion || v.basedOnContentVersionId !== d.currentContentVersion.id) abort("design_not_current_content");
      const facts = await deliverableFacts(tx, d.id);
      if (!facts.contentApproved) abort("content_not_approved");
      if (!checksPass(v.checks)) abort("design_checks_failed");
      // نسخةٌ رُفعت لمقاسٍ سابق لا تُقدَّم بعد تغيير المقاس — يُعاد الحكمُ على المقاس الحالي
      if (!fitsFormat(v, d)) abort("design_checks_failed");
      await tx.marketingDesignVersion.update({ where: { id: v.id }, data: { submittedAt: new Date() } });
      await writeDeliverable(tx, d, { currentDesignVersionId: v.id, status: "design_review", revisionTarget: null, revisionNote: null });
      await invalidateStale(tx, actor, d.id, `design_v${v.number}`);
      await logEvent(tx, actor, { action: "design.submitted", campaignId: d.campaignId, deliverableId: d.id, details: { version: v.number } });
    });
    return { ok: true };
  });
}

export async function decideDesign(
  actor: MkActor,
  deliverableId: string,
  input: { designVersionId: string; decision: "approved" | "changes_requested"; note?: string }
): Promise<MkResult> {
  return guarded(async () => {
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      const { memberId } = await requireCampaignRole(actor, d.campaignId, "designer", tx);
      requireWorkable(d);
      if (d.status !== "design_review") abort("invalid_state", { from: d.status });
      if (!d.currentDesignVersion || d.currentDesignVersion.id !== input.designVersionId) abort("version_not_current");
      const facts = await deliverableFacts(tx, d.id);
      if (!facts.designOnCurrentContent) abort("design_not_current_content");
      if (!facts.contentApproved) abort("content_not_approved");
      const { requireSeparateApprover } = await settingsFor(tx);
      if (input.decision === "approved" && requireSeparateApprover && d.currentDesignVersion.authorId === memberId) abort("separate_approver_required");
      const note = input.note?.trim().slice(0, 1000) || null;
      if (input.decision === "changes_requested" && !note) abort("invalid_input", { field: "note" });

      await writeDeliverable(tx, d, input.decision === "approved"
        ? { status: "design_approved" }
        : { status: "revision_required", revisionTarget: "design", revisionNote: note });
      await tx.marketingApproval.create({
        data: { deliverableId: d.id, kind: "design", designVersionId: d.currentDesignVersion.id, contentVersionId: null, decision: input.decision, note, deciderId: memberId },
      });
      if (input.decision === "changes_requested") await reopenTasks(tx, actor, d, "design");
      await logEvent(tx, actor, {
        action: input.decision === "approved" ? "design.approved" : "design.changes_requested",
        campaignId: d.campaignId,
        deliverableId: d.id,
        details: { version: d.currentDesignVersion.number, ...(note ? { note } : {}) },
      });
    });
    return { ok: true };
  });
}

/** المصمّمُ يرى أن النصَّ يحتاج تغييراً مؤثراً: يعيده للكاتب، ولا يغيّره بيده */
export async function returnToWriter(actor: MkActor, deliverableId: string, note: string): Promise<MkResult> {
  return guarded(async () => {
    const text = note?.trim().slice(0, 1000);
    if (!text) return fail("invalid_input", { field: "note" });
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      await requireCampaignRole(actor, d.campaignId, "designer", tx);
      requireWorkable(d);
      if (!["content_approved", "design_review", "design_approved"].includes(d.status)) abort("invalid_state", { from: d.status });
      await writeDeliverable(tx, d, { status: "revision_required", revisionTarget: "content", revisionNote: text });
      await reopenTasks(tx, actor, d, "content");
      await logEvent(tx, actor, { action: "design.returned_to_writer", campaignId: d.campaignId, deliverableId: d.id, details: { note: text } });
    });
    return { ok: true };
  });
}

/** ملفُّ تصميمٍ أو مرفقٍ — لمن يرى حملته وحده */
export async function readCampaignFile(actor: MkActor, fileId: string) {
  const f = await prisma.marketingFile.findUnique({
    where: { id: fileId },
    select: { campaignId: true, fileName: true, mimeType: true, data: true, kind: true },
  });
  if (!f) return null;
  const access = await campaignAccess(actor, f.campaignId);
  if (!access.canView) return null;
  return { fileName: f.fileName, mimeType: f.mimeType, bytes: f.data, kind: f.kind };
}
