import type { MarketingJobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, requireCampaignRole, type MkActor } from "../access";
import { logEvent, logSystemEvent } from "../audit";
import { loadDeliverable, requireWorkable } from "../deliverables";
import { abort, fail, guarded, isUniqueViolation, type MkResult } from "../result";
import { LIMITS, ProviderError, type TextProvider, type TextRequest, type TextVariant } from "./provider";
import { aiStatus, textProvider, type AiStatus } from "./registry";

/** طابورُ التوليد — طلبٌ يُحفظ قبل أن يبدأ، ويُعالَج خارج طلب الواجهة.
 *
 *  - **محفوظٌ قبل التنفيذ:** الطلبُ صفٌّ في القاعدة بمدخلاته كاملة (الموجز
 *    والمسودة لحظةَ الطلب)، فلا يضيع بانقطاع الصفحة، ويُعاد بالمدخلات نفسها.
 *  - **لا يعالجه اثنان:** العاملُ يحجزه بشرطٍ ذرّي (`updateMany` على الحالة
 *    والمهلة)، والمهلةُ المنقضية تُحرّره لعاملٍ آخر — ونتيجةُ عاملٍ فقد حجزه
 *    تُرمى ولا تُكتب (شرطُ رقم المحاولة).
 *  - **الفشلُ مصنَّف:** حدُّ الطلبات والعطلُ المؤقت والمهلة تُعاد بتأخيرٍ متزايدٍ
 *    حتى حدٍّ معلوم؛ والرفضُ والطلبُ الخاطئ لا يُعادان. والمهلةُ لا تصير نجاحاً.
 *  - **الناتجُ اقتراح:** لا يُنشئ نسخةً ولا اعتماداً. الكاتبُ يتبنّى نسخةً في
 *    مسودته (`adoptSuggestion`) ثم يقدّمها كأي نصٍّ فتمرّ بالمراجعة نفسها.
 *  - **والفشلُ لا يمسّ المسودة:** المهمّةُ لا تكتب على المخرج إلا عند التبنّي. */

const LEASE_MS = 90_000;
/** حدٌّ صلبٌ للمحاولة الواحدة — أقصرُ من الحجز، فلا تتجاوز محاولةٌ حجزَها */
const ATTEMPT_TIMEOUT_MS = 60_000;
const BACKOFF_BASE_MS = 20_000;
const BACKOFF_CAP_MS = 10 * 60_000;
/** حصّةُ العضو اليومية — سقفٌ للتكلفة لا يتجاوزه خطأٌ في الواجهة ولا نقراتٌ متتالية */
export const DAILY_QUOTA = 30;
const ACTIVE: MarketingJobStatus[] = ["queued", "running"];
/** ما لا تُفيد إعادتُه: المزوّدُ رفض المحتوى، أو الطلبُ نفسه خاطئ */
const FINAL_ERRORS = new Set(["refused", "invalid_request"]);

export type JobDeps = {
  /** حالةُ المزوّد — تُحقن في الاختبار؛ وإلا فمن الإعدادات */
  status?: () => AiStatus["text"];
  /** المزوّدُ بمعرّفه — تُحقن في الاختبار؛ وإلا فمن السجلّ */
  providerFor?: (id: string) => TextProvider | null;
  now?: () => Date;
  /** حدُّ المحاولة — يُقصَّر في الاختبار */
  attemptTimeoutMs?: number;
};

const nowOf = (deps?: JobDeps) => deps?.now?.() ?? new Date();

function backoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0), BACKOFF_CAP_MS);
  // تذبذبٌ صغير حتى لا تعود المهامُّ المتعثّرة كلُّها في اللحظة نفسها
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export type JobResult = { variants: TextVariant[]; model: string; simulated: boolean; usage?: { inputTokens: number; outputTokens: number } };

// ── الطلب ──────────────────────────────────────────────────────────────

export async function requestTextSuggestion(
  actor: MkActor,
  deliverableId: string,
  input: { instructions?: string; variants?: number; locale?: "ar" | "en"; requestId?: string },
  deps?: JobDeps
): Promise<MkResult<{ jobId: string; duplicate?: boolean }>> {
  return guarded(async () => {
    const key = input.requestId?.slice(0, 80) || null;
    if (!key) return fail("invalid_input", { field: "requestId" });
    const prior = await prisma.marketingGenerationJob.findUnique({ where: { idempotencyKey: key }, select: { id: true, deliverableId: true } });
    if (prior) {
      if (prior.deliverableId !== deliverableId) return fail("invalid_input", { field: "requestId" });
      return { ok: true, jobId: prior.id, duplicate: true };
    }
    const status = deps?.status?.() ?? aiStatus().text;
    if (status.state !== "ready" || !status.provider) return fail("integration_not_configured", { reason: status.reason ?? "not_ready" });

    try {
      return await prisma.$transaction(async (tx) => {
        const d = await loadDeliverable(tx, deliverableId);
        const { memberId } = await requireCampaignRole(actor, d.campaignId, "writer", tx);
        requireWorkable(d);
        // مهمّةٌ واحدةٌ نشطةٌ لكل مخرج — النقرُ المكرّر لا يضاعف التكلفة
        const active = await tx.marketingGenerationJob.count({ where: { deliverableId: d.id, status: { in: ACTIVE } } });
        if (active > 0) abort("job_active");
        const since = new Date(nowOf(deps).getTime() - 24 * 3600_000);
        const used = await tx.marketingGenerationJob.count({ where: { requestedById: memberId, createdAt: { gte: since } } });
        if (used >= DAILY_QUOTA) abort("job_quota", { limit: DAILY_QUOTA });

        const campaign = await tx.marketingCampaign.findUniqueOrThrow({
          where: { id: d.campaignId },
          select: { name: true, objective: true, audience: true, keyMessage: true },
        });
        const request: TextRequest = {
          brief: { campaign: campaign.name, objective: campaign.objective, audience: campaign.audience, keyMessage: campaign.keyMessage },
          deliverable: { title: d.title, platform: d.platform, width: d.width, height: d.height },
          draft: d.contentDraft.slice(0, LIMITS.draft),
          instructions: String(input.instructions ?? "").trim().slice(0, LIMITS.instructions),
          variants: Math.min(Math.max(Math.trunc(Number(input.variants) || 2), 1), LIMITS.variantsMax),
          locale: input.locale === "en" ? "en" : "ar",
        };
        const job = await tx.marketingGenerationJob.create({
          data: {
            deliverableId: d.id,
            kind: "text",
            provider: status.provider!,
            model: status.model,
            input: request as unknown as Prisma.InputJsonValue,
            idempotencyKey: key,
            requestedById: memberId,
            nextAttemptAt: nowOf(deps),
          },
          select: { id: true },
        });
        await logEvent(tx, actor, {
          action: "job.queued",
          campaignId: d.campaignId,
          deliverableId: d.id,
          details: { jobId: job.id, provider: status.provider!, simulated: status.simulated },
        });
        return { ok: true as const, jobId: job.id };
      });
    } catch (e) {
      // طلبان بالمفتاح نفسه في اللحظة نفسها: الثاني يُعيد ما أنشأه الأول
      if (isUniqueViolation(e)) {
        const again = await prisma.marketingGenerationJob.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
        if (again) return { ok: true as const, jobId: again.id, duplicate: true };
      }
      throw e;
    }
  });
}

// ── المعالجة ───────────────────────────────────────────────────────────

export type ProcessOutcome = "not_claimed" | "succeeded" | "retry_scheduled" | "failed" | "cancelled" | "discarded";

/** يحجز المهمّة ويعالجها مرةً واحدة. يُستدعى بعد ردّ الطلب (`after()`) وعند
 *  المتابعة، ولا ضررَ من استدعائه مرتين: الحجزُ الذرّي يُدخل عاملاً واحداً. */
export async function processJob(jobId: string, deps?: JobDeps): Promise<ProcessOutcome> {
  const now = nowOf(deps);
  const J = prisma.marketingGenerationJob;
  const claimed = await J.updateMany({
    where: {
      id: jobId,
      attempts: { lt: J.fields.maxAttempts },
      OR: [
        { status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        // عاملٌ سابقٌ انقطع قبل أن يُنهي — حجزُه انقضى فتُستأنف
        { status: "running", leaseUntil: { lt: now } },
      ],
    },
    data: { status: "running", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, startedAt: now, error: null },
  });
  if (claimed.count === 0) {
    await failExhausted(jobId, now);
    return "not_claimed";
  }
  const job = await J.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true, attempts: true, maxAttempts: true, provider: true, input: true, requestedById: true,
      deliverable: { select: { id: true, campaignId: true, status: true, campaign: { select: { status: true } } } },
      requestedBy: { select: { active: true, capabilities: true } },
    },
  });
  const { deliverable: d } = job;
  // شرطُ كلِّ كتابةٍ بعد الحجز: ما زالت المهمّةُ لنا (لم تُلغَ ولم يحجزها غيرُنا)
  const ours = { id: job.id, status: "running" as const, attempts: job.attempts };

  // لا تكلفةَ لما لم يعد له معنى: حملةٌ أُغلقت، أو مخرجٌ نُشر أو أُوقف، أو طالبٌ سُحبت منه الكتابة
  const stopReason =
    d.campaign.status !== "in_progress" || d.status === "published" || d.status === "blocked"
      ? "deliverable_closed"
      : !job.requestedBy.active || !job.requestedBy.capabilities.includes("writer") ||
          !(await prisma.marketingCampaignMember.count({ where: { campaignId: d.campaignId, memberId: job.requestedById, role: "writer" } }))
        ? "requester_revoked"
        : null;
  if (stopReason) {
    return finish(ours, d, { status: "cancelled", error: stopReason }, "job.cancelled", now);
  }

  const provider = deps?.providerFor ? deps.providerFor(job.provider) : registryProvider(job.provider);
  if (!provider) return finish(ours, d, { status: "failed", error: "not_configured" }, "job.failed", now);

  try {
    const out = await withTimeout((signal) => provider.generate(job.input as unknown as TextRequest, signal), deps?.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS);
    const result: JobResult = { variants: out.variants, model: out.model, simulated: provider.simulated, ...(out.usage ? { usage: out.usage } : {}) };
    return finish(
      ours, d,
      { status: "succeeded", result: result as unknown as Prisma.InputJsonValue, model: out.model },
      "job.succeeded", nowOf(deps),
      { variants: out.variants.length, simulated: provider.simulated }
    );
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : "unknown";
    const retryable = e instanceof ProviderError && e.retryable;
    if (!(e instanceof ProviderError)) console.error("[marketing/jobs] خطأٌ غيرُ مصنَّف في التوليد:", e instanceof Error ? e.name : typeof e);
    const at = nowOf(deps);
    if (retryable && job.attempts < job.maxAttempts) {
      const res = await J.updateMany({
        where: ours,
        data: { status: "queued", leaseUntil: null, error: kind, nextAttemptAt: new Date(at.getTime() + backoffMs(job.attempts)) },
      });
      return res.count ? "retry_scheduled" : "discarded";
    }
    return finish(ours, d, { status: "failed", error: kind }, "job.failed", at, { error: kind, attempts: job.attempts });
  }
}

function registryProvider(id: string): TextProvider | null {
  const p = textProvider();
  return p && p.id === id ? p : null;
}

/** يُنهي المهمّة إن كانت ما زالت لنا — وإلا رُمي الناتج (أُلغيت أو حجزها عاملٌ آخر) */
async function finish(
  ours: { id: string; status: "running"; attempts: number },
  d: { id: string; campaignId: string },
  data: Prisma.MarketingGenerationJobUncheckedUpdateManyInput & { status: MarketingJobStatus },
  action: "job.succeeded" | "job.failed" | "job.cancelled",
  at: Date,
  details: Record<string, string | number | boolean> = {}
): Promise<ProcessOutcome> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.marketingGenerationJob.updateMany({ where: ours, data: { ...data, leaseUntil: null, finishedAt: at } });
    if (res.count === 0) return "discarded" as const;
    await logSystemEvent(tx, {
      action,
      campaignId: d.campaignId,
      deliverableId: d.id,
      details: { jobId: ours.id, ...(data.error ? { error: String(data.error) } : {}), ...details },
    });
    return data.status as "succeeded" | "failed" | "cancelled";
  });
}

/** مهمّةٌ استنفدت محاولاتها وانقضى حجزُها (انقطع عاملُها في المحاولة الأخيرة) — تُختم فاشلة */
async function failExhausted(jobId: string, now: Date) {
  const J = prisma.marketingGenerationJob;
  const job = await J.findUnique({ where: { id: jobId }, select: { attempts: true, deliverable: { select: { id: true, campaignId: true } } } });
  if (!job) return;
  await prisma.$transaction(async (tx) => {
    const res = await tx.marketingGenerationJob.updateMany({
      where: { id: jobId, status: "running", leaseUntil: { lt: now }, attempts: { gte: J.fields.maxAttempts } },
      data: { status: "failed", error: "timeout", leaseUntil: null, finishedAt: now },
    });
    if (res.count) {
      await logSystemEvent(tx, { action: "job.failed", campaignId: job.deliverable.campaignId, deliverableId: job.deliverable.id, details: { jobId, error: "timeout", attempts: job.attempts } });
    }
  });
}

/** حدٌّ صلب: يُلغي الطلب عند انقضائه، ولا ينتظر مزوّداً يتجاهل الإلغاء */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new ProviderError("timeout", "attempt_timeout"));
    }, ms);
  });
  try {
    return await Promise.race([run(ctrl.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** ما حان من المهامّ — لمخرجٍ بعينه عند متابعته، أو للكلّ — في حدود وقتٍ وعدد */
export async function processDue(opts: { deliverableId?: string; limit?: number; budgetMs?: number } = {}, deps?: JobDeps) {
  const started = Date.now();
  const now = nowOf(deps);
  const due = await prisma.marketingGenerationJob.findMany({
    where: {
      ...(opts.deliverableId ? { deliverableId: opts.deliverableId } : {}),
      OR: [
        { status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "running", leaseUntil: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(opts.limit ?? 3, 10),
    select: { id: true },
  });
  const outcomes: ProcessOutcome[] = [];
  for (const j of due) {
    if (Date.now() - started > (opts.budgetMs ?? 50_000)) break;
    outcomes.push(await processJob(j.id, deps));
  }
  return outcomes;
}

// ── الإلغاء وإعادة المحاولة والتبنّي ───────────────────────────────────

async function loadJob(jobId: string) {
  const job = await prisma.marketingGenerationJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, status: true, error: true, attempts: true, provider: true, input: true, result: true, adoptedAt: true,
      deliverableId: true, deliverable: { select: { campaignId: true } },
    },
  });
  if (!job) abort("not_found");
  return job;
}

export async function cancelJob(actor: MkActor, jobId: string): Promise<MkResult> {
  return guarded(async () => {
    const job = await loadJob(jobId);
    await requireCampaignRole(actor, job.deliverable.campaignId, "writer");
    return prisma.$transaction(async (tx) => {
      const res = await tx.marketingGenerationJob.updateMany({
        where: { id: jobId, status: { in: ACTIVE } },
        data: { status: "cancelled", leaseUntil: null, finishedAt: new Date(), error: "cancelled" },
      });
      if (res.count === 0) abort("invalid_state", { from: job.status });
      await logEvent(tx, actor, { action: "job.cancelled", campaignId: job.deliverable.campaignId, deliverableId: job.deliverableId, details: { jobId } });
      return { ok: true as const };
    });
  });
}

/** إعادةٌ يدويةٌ لمهمّةٍ فشلت — محاولةٌ واحدةٌ إضافية، بالمدخلات نفسها */
export async function retryJob(actor: MkActor, jobId: string, deps?: JobDeps): Promise<MkResult> {
  return guarded(async () => {
    const job = await loadJob(jobId);
    await requireCampaignRole(actor, job.deliverable.campaignId, "writer");
    if (job.status !== "failed") return fail("invalid_state", { from: job.status });
    if (job.error && FINAL_ERRORS.has(job.error)) return fail("job_not_retryable", { error: job.error });
    const status = deps?.status?.() ?? aiStatus().text;
    if (status.state !== "ready" || status.provider !== job.provider) return fail("integration_not_configured", { reason: status.reason ?? "provider_changed" });
    return prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, job.deliverableId);
      requireWorkable(d);
      const active = await tx.marketingGenerationJob.count({ where: { deliverableId: d.id, status: { in: ACTIVE } } });
      if (active > 0) abort("job_active");
      const res = await tx.marketingGenerationJob.updateMany({
        where: { id: jobId, status: "failed", attempts: job.attempts },
        data: { status: "queued", maxAttempts: job.attempts + 1, nextAttemptAt: nowOf(deps), error: null, finishedAt: null },
      });
      if (res.count === 0) abort("stale");
      await logEvent(tx, actor, { action: "job.retried", campaignId: d.campaignId, deliverableId: d.id, details: { jobId } });
      return { ok: true as const };
    });
  });
}

/** يضع نسخةً مقترحةً في المسودة — ولا شيءَ غير ذلك: لا نسخة، ولا اعتماد، ولا تغييرَ حالة.
 *  وإن عدّل الكاتبُ مسودته بعد الطلب لم تُستبدل إلا بتأكيده (`replaceEdited`). */
export async function adoptSuggestion(
  actor: MkActor,
  jobId: string,
  input: { variant: number; replaceEdited?: boolean }
): Promise<MkResult> {
  return guarded(async () => {
    const job = await loadJob(jobId);
    if (job.status !== "succeeded") return fail("invalid_state", { from: job.status });
    const result = job.result as unknown as JobResult | null;
    const chosen = result?.variants?.[Math.trunc(Number(input.variant))];
    if (!chosen) return fail("invalid_input", { field: "variant" });
    return prisma.$transaction(async (tx) => {
      const d = await loadDeliverable(tx, job.deliverableId);
      await requireCampaignRole(actor, d.campaignId, "writer", tx);
      requireWorkable(d);
      const requestedDraft = (job.input as unknown as TextRequest).draft;
      if (!input.replaceEdited && d.contentDraft.slice(0, LIMITS.draft) !== requestedDraft) abort("draft_changed");
      // شرطُ المراجعة: لا يُكتب فوق تغييرٍ وقع بين القراءة والكتابة
      const res = await tx.marketingDeliverable.updateMany({
        where: { id: d.id, revision: d.revision, contentDraft: d.contentDraft },
        data: { contentDraft: chosen.text, draftUpdatedAt: new Date() },
      });
      if (res.count === 0) abort("stale");
      await tx.marketingGenerationJob.update({ where: { id: jobId }, data: { adoptedAt: new Date() } });
      await logEvent(tx, actor, {
        action: "job.adopted",
        campaignId: d.campaignId,
        deliverableId: d.id,
        details: { jobId, variant: Math.trunc(Number(input.variant)), simulated: !!result?.simulated },
      });
      return { ok: true as const };
    });
  });
}

// ── القراءة ────────────────────────────────────────────────────────────

/** مهامُّ المخرج الأخيرة — لمن يرى الحملة؛ والأفعالُ للكاتب وحده (تُفحص في كل فعل) */
export async function deliverableJobs(actor: MkActor, deliverableId: string) {
  const d = await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { campaignId: true } });
  if (!d) return null;
  const access = await campaignAccess(actor, d.campaignId);
  if (!access.canView) return null;
  const jobs = await prisma.marketingGenerationJob.findMany({
    where: { deliverableId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, kind: true, provider: true, model: true, status: true, error: true, attempts: true, maxAttempts: true,
      result: true, adoptedAt: true, nextAttemptAt: true, createdAt: true, finishedAt: true,
      requestedBy: { select: { id: true } },
    },
  });
  return {
    canRequest: access.roles.has("writer"),
    jobs: jobs.map((j) => ({
      ...j,
      result: j.result as unknown as JobResult | null,
      retryable: j.status === "failed" && !(j.error && FINAL_ERRORS.has(j.error)),
    })),
  };
}
