import type { MarketingDeliverableStatus, MarketingRevisionTarget, MarketingTaskKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, requireCampaignRole, type MkActor } from "./access";
import { logEvent, logSystemEvent } from "./audit";
import { invalidatePlanIfChanged, planEditable } from "./plan";
import { abort, fail, guarded, type MkResult } from "./result";

type Tx = Prisma.TransactionClient;

/** المخرج: منصةٌ ومقاسٌ بعينهما، ويمرّ بآلة حالاتٍ يفرضها الخادم:
 *
 *    draft → content_review → content_approved → design_review → design_approved
 *          → quality_review → ready_to_publish → published
 *    وأيٌّ منها ← revision_required (طلبُ تعديلٍ أو فحصٌ لم يجتز) ← تقديمٌ جديد
 *    و blocked (مانعٌ جوهري) يرفعه المنسّق فيعود إلى ما كان.
 *
 *  **والحالةُ وحدها لا تكفي للنشر.** قبل `ready_to_publish` وقبل النشر تُعاد
 *  قراءةُ الحقائق (`publishBlockers`): اعتمادُ النص الحالي، واعتمادُ التصميم
 *  الحالي، وأن التصميم مبنيٌّ على النص الحالي، وفحصُ جودةٍ ناجحٌ على الزوج
 *  الحالي نفسه. فلا تُعبَر بحالةٍ عالقةٍ من إصدارٍ سابق. */

const CLOSED: MarketingDeliverableStatus[] = ["published"];

/** يقرأ المخرج مع حالة حملته — داخل المعاملة */
export async function loadDeliverable(tx: Tx, deliverableId: string) {
  const d = await tx.marketingDeliverable.findUnique({
    where: { id: deliverableId },
    include: {
      campaign: { select: { id: true, status: true } },
      currentContentVersion: { select: { id: true, number: true, body: true, authorId: true } },
      currentDesignVersion: { select: { id: true, number: true, basedOnContentVersionId: true, authorId: true, submittedAt: true, checks: true } },
    },
  });
  if (!d) abort("not_found");
  return d;
}
export type LoadedDeliverable = Awaited<ReturnType<typeof loadDeliverable>>;

/** العملُ على المخرج لا يجري إلا والحملةُ قيد التنفيذ والمخرجُ غيرُ منشور */
export function requireWorkable(d: LoadedDeliverable) {
  if (d.campaign.status !== "in_progress") abort("campaign_closed", { status: d.campaign.status });
  if (CLOSED.includes(d.status)) abort("invalid_state", { from: d.status });
  if (d.status === "blocked") abort("invalid_state", { from: d.status });
}

/** يكتب على المخرج بشرط أن أحداً لم يغيّره منذ قُرئ — وإلا «تغيّر في أثناء طلبك» */
export async function writeDeliverable(tx: Tx, d: { id: string; revision: number }, data: Prisma.MarketingDeliverableUncheckedUpdateManyInput) {
  const res = await tx.marketingDeliverable.updateMany({
    where: { id: d.id, revision: d.revision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (res.count === 0) abort("stale");
  if (typeof data.status === "string") await syncStageTasks(tx, d.id);
}

const STAGES = ["content", "design", "quality", "publishing"] as const;

/** المرحلةُ المفتوحة من حالة القطعة — وما قبلها منجز، وما بعدها لم يبدأ. `null` = لا يُمسّ (موقوفة) */
function openStage(status: MarketingDeliverableStatus, target: MarketingRevisionTarget | null): number | null {
  if (status === "blocked") return null;
  if (status === "draft" || status === "content_review") return 0;
  if (status === "revision_required") return target === "design" ? 1 : 0;
  if (status === "content_approved" || status === "design_review") return 1;
  if (status === "design_approved" || status === "quality_review") return 2;
  if (status === "ready_to_publish") return 3;
  return STAGES.length; // published
}

/** مهامُّ القطعة المولَّدة من الخطة المعتمدة تتبع مرحلتها: ما اكتمل يُنجَز، وما عاد إليه العملُ
 *  (ردٌّ للتعديل) يُعاد فتحه. المهامُّ اليدويةُ والملغاةُ لا تُمسّ. فيبقى «مهمّةٌ نشطة» — شرطُ شات
 *  الكاتب والمصمّم والناشر، وشرطُ الأرشفة — مطابقاً لما يجري فعلاً. */
export async function syncStageTasks(tx: Tx, deliverableId: string) {
  const d = await tx.marketingDeliverable.findUniqueOrThrow({ where: { id: deliverableId }, select: { campaignId: true, status: true, revisionTarget: true } });
  const open = openStage(d.status, d.revisionTarget);
  if (open === null) return;
  const tasks = await tx.marketingTask.findMany({
    where: { deliverableId, planVersionId: { not: null }, kind: { in: [...STAGES] }, status: { not: "cancelled" } },
    select: { id: true, kind: true, status: true },
  });
  let changed = 0;
  for (const t of tasks) {
    const i = STAGES.indexOf(t.kind as (typeof STAGES)[number]);
    const done = t.status === "done";
    if (i < open && !done) {
      await tx.marketingTask.update({ where: { id: t.id }, data: { status: "done", completedAt: new Date() } });
      changed++;
    } else if (i >= open && done) {
      await tx.marketingTask.update({ where: { id: t.id }, data: { status: "todo", completedAt: null, reopenCount: { increment: 1 } } });
      changed++;
    }
  }
  if (changed) await logSystemEvent(tx, { action: "tasks.synced", campaignId: d.campaignId, deliverableId, details: { changed, stage: STAGES[open] ?? "published" } });
}

/** يُسقط كلَّ اعتمادٍ أو فحصٍ لم يعد يطابق الإصدارين الحاليين — بعد أي تغييرٍ لهما.
 *  القرارُ لا يُحذف: يُختم بوقت إبطاله وسببه، فيبقى في السجلّ. */
export async function invalidateStale(tx: Tx, actor: MkActor, deliverableId: string, reason: string) {
  const d = await tx.marketingDeliverable.findUniqueOrThrow({
    where: { id: deliverableId },
    select: { campaignId: true, currentContentVersionId: true, currentDesignVersionId: true, currentDesignVersion: { select: { basedOnContentVersionId: true } } },
  });
  const now = new Date();
  const content = d.currentContentVersionId;
  const design = d.currentDesignVersionId;
  const designOnCurrent = !!design && d.currentDesignVersion?.basedOnContentVersionId === content;

  const [a1, a2, q] = await Promise.all([
    tx.marketingApproval.updateMany({
      where: { deliverableId, kind: "content", invalidatedAt: null, NOT: content ? { contentVersionId: content } : undefined },
      data: { invalidatedAt: now, invalidatedReason: reason },
    }),
    tx.marketingApproval.updateMany({
      where: {
        deliverableId,
        kind: "design",
        invalidatedAt: null,
        ...(designOnCurrent && design ? { NOT: { designVersionId: design } } : {}),
      },
      data: { invalidatedAt: now, invalidatedReason: reason },
    }),
    tx.marketingQualityCheck.updateMany({
      where: {
        deliverableId,
        invalidatedAt: null,
        ...(designOnCurrent && design && content ? { NOT: { AND: [{ contentVersionId: content }, { designVersionId: design }] } } : {}),
      },
      data: { invalidatedAt: now, invalidatedReason: reason },
    }),
  ]);
  // وفحصُ الناشر الأخير على زوجٍ لم يعد حالياً يسقط معه — لا نشرَ بفحصٍ قديم
  const fc = await tx.marketingFinalCheck.updateMany({
    where: {
      deliverableId,
      invalidatedAt: null,
      ...(designOnCurrent && design && content ? { NOT: { AND: [{ contentVersionId: content }, { designVersionId: design }] } } : {}),
    },
    data: { invalidatedAt: now, invalidatedReason: reason },
  });
  const total = a1.count + a2.count + q.count + fc.count;
  if (total > 0) {
    await logEvent(tx, actor, {
      action: "approvals.invalidated",
      campaignId: d.campaignId,
      deliverableId,
      details: { reason, content: a1.count, design: a2.count, quality: q.count, final: fc.count },
    });
  }
  return total;
}

/** طلبُ تعديلٍ يُعيد فتحَ مهامّ المخرج من نوعه — فلا تبقى «منجزة» وعملُها مرفوض */
export async function reopenTasks(tx: Tx, actor: MkActor, d: { id: string; campaignId: string }, target: MarketingRevisionTarget) {
  const kind: MarketingTaskKind = target === "content" ? "content" : "design";
  const tasks = await tx.marketingTask.findMany({
    where: { deliverableId: d.id, kind, status: "done" },
    select: { id: true, title: true },
  });
  for (const t of tasks) {
    await tx.marketingTask.update({ where: { id: t.id }, data: { status: "todo", completedAt: null, reopenCount: { increment: 1 } } });
    await logEvent(tx, actor, { action: "task.reopened", campaignId: d.campaignId, deliverableId: d.id, details: { taskId: t.id, title: t.title } });
  }
}

/** الحقائقُ التي يُحكم بها على المخرج — تُقرأ من القاعدة لا من الحالة */
export async function deliverableFacts(db: Tx | typeof prisma, deliverableId: string) {
  const d = await db.marketingDeliverable.findUniqueOrThrow({
    where: { id: deliverableId },
    select: {
      currentContentVersionId: true,
      currentDesignVersionId: true,
      currentDesignVersion: { select: { basedOnContentVersionId: true, submittedAt: true, checks: true } },
    },
  });
  const content = d.currentContentVersionId;
  const design = d.currentDesignVersionId;
  const [contentApproval, designApproval, quality, final] = await Promise.all([
    content
      ? db.marketingApproval.findFirst({ where: { deliverableId, kind: "content", contentVersionId: content, decision: "approved", invalidatedAt: null }, select: { id: true } })
      : null,
    design
      ? db.marketingApproval.findFirst({ where: { deliverableId, kind: "design", designVersionId: design, decision: "approved", invalidatedAt: null }, select: { id: true } })
      : null,
    content && design
      ? db.marketingQualityCheck.findFirst({
          where: { deliverableId, contentVersionId: content, designVersionId: design, invalidatedAt: null },
          orderBy: { createdAt: "desc" },
          select: { passed: true, blocking: true },
        })
      : null,
    content && design
      ? db.marketingFinalCheck.findFirst({
          where: { deliverableId, contentVersionId: content, designVersionId: design, invalidatedAt: null },
          orderBy: { createdAt: "desc" },
          select: { passed: true },
        })
      : null,
  ]);
  return {
    contentVersionId: content,
    designVersionId: design,
    contentApproved: !!contentApproval,
    designSubmitted: !!d.currentDesignVersion?.submittedAt,
    designOnCurrentContent: !!design && d.currentDesignVersion?.basedOnContentVersionId === content,
    designChecksPassed: !!design && checksPass(d.currentDesignVersion?.checks),
    designApproved: !!designApproval,
    qualityPassed: !!quality?.passed,
    qualityBlocking: !!quality && !quality.passed && quality.blocking,
    finalPassed: !!final?.passed,
  };
}
export type DeliverableFacts = Awaited<ReturnType<typeof deliverableFacts>>;

/** ما يمنع النشر — بترتيب المسار، وأسماءٌ تترجمها الواجهة. فارغةٌ = جاهز */
export function publishBlockers(f: DeliverableFacts): string[] {
  const out: string[] = [];
  if (!f.contentVersionId) out.push("content_missing");
  else if (!f.contentApproved) out.push("content_not_approved");
  if (!f.designVersionId) out.push("design_missing");
  else {
    if (!f.designOnCurrentContent) out.push("design_outdated");
    if (!f.designChecksPassed) out.push("design_checks_failed");
    if (!f.designSubmitted) out.push("design_not_submitted");
    else if (!f.designApproved) out.push("design_not_approved");
  }
  if (f.qualityBlocking) out.push("quality_blocking");
  else if (!f.qualityPassed) out.push("quality_missing");
  return out;
}

/** ما يمنع النشر نفسه: شروطُ الجاهزية، ثم فحصُ الناشر الأخير على الزوج الحالي */
export function publicationBlockers(f: DeliverableFacts): string[] {
  const out = publishBlockers(f);
  if (out.length === 0 && !f.finalPassed) out.push("final_check_missing");
  return out;
}

/** نتائجُ الفحص الآلي محفوظةٌ مع الإصدار: يجتاز ما لم يفشل فيه بندٌ مانع */
export function checksPass(checks: unknown): boolean {
  if (!Array.isArray(checks)) return false;
  return !checks.some((c) => c && typeof c === "object" && (c as { level?: string }).level === "fail");
}

async function settingsFor(tx: Tx) {
  const s = await tx.marketingSettings.findUnique({ where: { id: "default" }, select: { requireSeparateApprover: true } });
  return { requireSeparateApprover: s?.requireSeparateApprover ?? true };
}
export { settingsFor };

// ─── إنشاءُ المخرج وتغييرُ مقاسه وإيقافُه ─────────────────────────────

export async function createDeliverable(
  actor: MkActor,
  campaignId: string,
  input: { title: string; platform: string; formatKey: string }
): Promise<MkResult<{ deliverableId: string }>> {
  return guarded(async () => {
    await requireCampaignRole(actor, campaignId, "coordinator");
    const title = input.title?.trim().slice(0, 160);
    const platform = input.platform?.trim().slice(0, 40);
    if (!title) return fail("invalid_input", { field: "title" });
    if (!platform) return fail("invalid_input", { field: "platform" });
    const format = await prisma.marketingFormat.findFirst({ where: { key: input.formatKey, active: true } });
    if (!format) return fail("invalid_input", { field: "format" });
    return prisma.$transaction(async (tx) => {
      const c = await tx.marketingCampaign.findUnique({ where: { id: campaignId }, select: { status: true, statusBeforeBlock: true } });
      if (!c || !["idea", "briefing", "ready_for_planning", "in_progress", "blocked"].includes(c.status)) abort("campaign_closed");
      // مخرجٌ جديدٌ يغيّر نطاقَ الخطة المعتمدة — لا يُضاف تحت تنفيذٍ جارٍ
      if (!planEditable(c)) abort("plan_locked");
      // رقمُ المنشور في حملته: التالي بعد أكبرها — بقفلٍ على الحملة فلا يأخذ منشوران الرقمَ نفسه
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mk-seq:${campaignId}`}))`;
      const top = await tx.marketingDeliverable.aggregate({ where: { campaignId }, _max: { seq: true } });
      const seq = (top._max.seq ?? 0) + 1;
      const d = await tx.marketingDeliverable.create({
        data: {
          campaignId,
          seq,
          title,
          platform,
          formatKey: format.key,
          formatRevision: format.revision,
          width: format.width,
          height: format.height,
          safeTop: format.safeTop,
          safeRight: format.safeRight,
          safeBottom: format.safeBottom,
          safeLeft: format.safeLeft,
        },
        select: { id: true },
      });
      await logEvent(tx, actor, {
        action: "deliverable.created",
        campaignId,
        deliverableId: d.id,
        details: { title, seq, platform, format: format.key, width: format.width, height: format.height },
      });
      await invalidatePlanIfChanged(tx, actor, campaignId);
      return { ok: true as const, deliverableId: d.id };
    });
  });
}

/** تغييرُ المقاس يُسقط التصميمَ الحالي واعتمادَه وفحصَه — لا يُنقل تصميمٌ إلى مقاسٍ آخر بالتمطيط */
export async function changeFormat(actor: MkActor, deliverableId: string, formatKey: string): Promise<MkResult> {
  return guarded(async () => {
    const campaignId = (await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { campaignId: true } }))?.campaignId;
    if (!campaignId) return fail("not_found");
    await requireCampaignRole(actor, campaignId, "coordinator");
    const format = await prisma.marketingFormat.findFirst({ where: { key: formatKey, active: true } });
    if (!format) return fail("invalid_input", { field: "format" });
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      if (d.status === "published") abort("invalid_state", { from: d.status });
      const facts = await deliverableFacts(tx, d.id);
      const beyondContent: MarketingDeliverableStatus[] = ["design_review", "design_approved", "quality_review", "ready_to_publish"];
      const status: MarketingDeliverableStatus =
        beyondContent.includes(d.status) || (d.status === "revision_required" && d.revisionTarget === "design")
          ? facts.contentApproved
            ? "content_approved"
            : "content_review"
          : d.status;
      await writeDeliverable(tx, d, {
        formatKey: format.key,
        formatRevision: format.revision,
        width: format.width,
        height: format.height,
        safeTop: format.safeTop,
        safeRight: format.safeRight,
        safeBottom: format.safeBottom,
        safeLeft: format.safeLeft,
        currentDesignVersionId: null,
        status,
        ...(status !== d.status ? { revisionTarget: null, revisionNote: null } : {}),
      });
      await invalidateStale(tx, actor, d.id, "format_changed");
      await logEvent(tx, actor, {
        action: "deliverable.format_changed",
        campaignId,
        deliverableId: d.id,
        details: { from: { key: d.formatKey, width: d.width, height: d.height }, to: { key: format.key, width: format.width, height: format.height } },
      });
    });
    return { ok: true };
  });
}

export async function setDeliverableBlocked(actor: MkActor, deliverableId: string, blocked: boolean, reason?: string): Promise<MkResult> {
  return guarded(async () => {
    const campaignId = (await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { campaignId: true } }))?.campaignId;
    if (!campaignId) return fail("not_found");
    await requireCampaignRole(actor, campaignId, "coordinator");
    const note = reason?.trim().slice(0, 500) ?? "";
    await prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, deliverableId);
      if (blocked) {
        if (d.status === "blocked" || d.status === "published") abort("invalid_state", { from: d.status });
        if (!note) abort("invalid_input", { field: "reason" });
        await writeDeliverable(tx, d, { status: "blocked", statusBeforeBlock: d.status, revisionNote: note });
      } else {
        if (d.status !== "blocked") abort("invalid_state", { from: d.status });
        await writeDeliverable(tx, d, { status: d.statusBeforeBlock ?? "draft", statusBeforeBlock: null });
      }
      await logEvent(tx, actor, {
        action: blocked ? "deliverable.blocked" : "deliverable.unblocked",
        campaignId,
        deliverableId,
        details: blocked ? { reason: note } : {},
      });
    });
    return { ok: true };
  });
}

// ─── القراءة ─────────────────────────────────────────────────────────

const VERSIONS_TAKE = 50;

/** كلُّ ما تحتاجه صفحةُ المخرج — أو `null` لمن لا يرى حملته */
export async function deliverableWorkspace(actor: MkActor, deliverableId: string) {
  const head = await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { campaignId: true } });
  if (!head) return null;
  const access = await campaignAccess(actor, head.campaignId);
  if (!access.canView) return null;

  const who = { select: { id: true, user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } };
  const d = await prisma.marketingDeliverable.findUniqueOrThrow({
    where: { id: deliverableId },
    include: {
      campaign: { select: { id: true, name: true, status: true, audience: true, keyMessage: true, objective: true } },
      contentVersions: { orderBy: { number: "desc" }, take: VERSIONS_TAKE, include: { author: who } },
      designVersions: {
        orderBy: { number: "desc" },
        take: VERSIONS_TAKE,
        select: { id: true, number: true, width: true, height: true, checks: true, changeNote: true, submittedAt: true, createdAt: true, basedOnContentVersionId: true, fileId: true, linkUrl: true, description: true, author: who, basedOnContentVersion: { select: { number: true } } },
      },
      approvals: { orderBy: { createdAt: "desc" }, take: VERSIONS_TAKE, include: { decider: who, contentVersion: { select: { number: true } }, designVersion: { select: { number: true } } } },
      qualityChecks: { orderBy: { createdAt: "desc" }, take: VERSIONS_TAKE, include: { reviewer: who, contentVersion: { select: { number: true } }, designVersion: { select: { number: true } } } },
      publications: { orderBy: { createdAt: "desc" }, include: { publisher: who, contentVersion: { select: { number: true } }, designVersion: { select: { number: true } } } },
      finalChecks: { orderBy: { createdAt: "desc" }, take: VERSIONS_TAKE, include: { publisher: who, contentVersion: { select: { number: true } }, designVersion: { select: { number: true } } } },
      designBrief: true,
      postArchive: { select: { id: true, status: true, attempts: true, maxAttempts: true, lastError: true, nextAttemptAt: true, completedAt: true } },
      writer: who,
      designer: who,
    },
  });
  const facts = await deliverableFacts(prisma, deliverableId);
  return { deliverable: d, roles: [...access.roles], facts, blockers: publicationBlockers(facts) };
}
