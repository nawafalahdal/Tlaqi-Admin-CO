import type { MarketingChatStatus, Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { marketingActor, type MkActor } from "../access";
import { logEvent, logSystemEvent } from "../audit";
import { buildContext, chatGate, scopeKeyOf, systemPromptFor, versionFingerprint, type ChatScope } from "../chatRules";
import { abort, fail, guarded, isUniqueViolation, type MkFail, type MkResult } from "../result";
import { backoffMs, withTimeout } from "./jobs";
import { CHAT_LIMITS, ProviderError, type TextProvider } from "./provider";
import { aiStatus, textProvider, type AiStatus } from "./registry";

/** الشات — رسالةٌ تُحفظ قبل أن تُرسَل، وردٌّ يُعالَج خارج طلب الواجهة.
 *
 *  المسار: المستخدم ← الواجهة ← الجلسة والمسؤولية (`chatGate`) ← نطاقُ المهمّة وسياقُها
 *  (`buildContext`) ← المزوّد ← فحصُ الرد وصلاحيته ← الحفظ ← العرض.
 *
 *  - **محفوظٌ قبل التنفيذ:** رسالةُ المستخدم وردٌّ «منتظَر» يُكتبان في معاملةٍ واحدة. الردُّ هو
 *    المهمّة: يُحجز ذرّياً بمهلة، ويُعاد على الفشل المؤقت وحده بتأخيرٍ متزايدٍ وحدٍّ معلوم،
 *    والمهلةُ لا تصير نجاحاً، ونتيجةُ عاملٍ فقد حجزه تُرمى.
 *  - **لا يُكرَّر الطلبُ المكلف:** مفتاحُ تكرارٍ لكل إرسال، وردٌّ واحدٌ منتظرٌ لكل محادثة، وحصّةٌ
 *    يومية لكل عضو، وقفلان للمعاملة (العضوُ ثم المحادثة) فلا يجتاز طلبان متزامنان الفحصَ معاً.
 *  - **الشرطُ يُعاد قبل المزوّد:** من سُحبت مسؤوليتُه أو انتهت مهمّتُه أو أُوقف المساعدُ في
 *    الانتظار لا يُكلَّف طلبُه (يُلغى بسببه).
 *  - **الردُّ القديم لا يُعرض كأنه حالي:** إن تغيّرت المهمّةُ أو نسختُها قبل اكتمال الرد صار
 *    «قديماً» (`stale`) — يُحفظ ويُعلَّم، ولا يُحسب جواباً على الحال الجديدة.
 *  - **لا أسرارَ ولا محتوى في السجلّ:** السجلُّ يحفظ المعرّفاتِ والحالةَ وعدَّ الرموز، لا النص. */

const LEASE_MS = 90_000;
const ATTEMPT_TIMEOUT_MS = 60_000;
/** سقفُ التكلفة اليوميُّ لكل عضو — رسائلُ لا رموز */
export const CHAT_DAILY_QUOTA = 60;
const PENDING: MarketingChatStatus[] = ["queued", "running"];
const FINAL_ERRORS = new Set(["refused", "invalid_request", "auth"]);
const VIEW_TAKE = 60;

export type ChatDeps = {
  status?: () => AiStatus["text"];
  providerFor?: (id: string) => TextProvider | null;
  now?: () => Date;
  attemptTimeoutMs?: number;
};
const nowOf = (deps?: ChatDeps) => deps?.now?.() ?? new Date();

/** إيقافٌ مركزيٌّ بيد قائد التسويق — يُقرأ في كل طلبٍ وقبل كل استدعاء */
export async function aiPaused(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  const s = await db.marketingSettings.findUnique({ where: { id: "default" }, select: { aiPaused: true } });
  return !!s?.aiPaused;
}

async function threadFor(tx: Prisma.TransactionClient, scope: ChatScope) {
  const scopeKey = scopeKeyOf(scope);
  const found = await tx.marketingChatThread.findUnique({ where: { scopeKey }, select: { id: true } });
  if (found) return found.id;
  try {
    const t = await tx.marketingChatThread.create({
      data: { kind: scope.kind, campaignId: scope.campaignId, deliverableId: scope.deliverableId ?? null, scopeKey },
      select: { id: true },
    });
    return t.id;
  } catch (e) {
    if (isUniqueViolation(e)) abort("stale");
    throw e;
  }
}

// ── الإرسال ─────────────────────────────────────────────────────────────

export async function sendChatMessage(
  actor: MkActor,
  scope: ChatScope,
  input: { body: string; requestId?: string },
  deps?: ChatDeps
): Promise<MkResult<{ threadId: string; replyId: string; duplicate?: boolean }>> {
  return guarded(async () => {
    const key = input.requestId?.slice(0, 80) || null;
    if (!key) return fail("invalid_input", { field: "requestId" });
    const body = String(input.body ?? "").trim();
    if (!body) return fail("invalid_input", { field: "body" });
    if (body.length > CHAT_LIMITS.message) return fail("invalid_input", { field: "body" });
    const prior = await prisma.marketingChatMessage.findUnique({ where: { idempotencyKey: key }, select: { id: true, threadId: true, thread: { select: { scopeKey: true } } } });
    if (prior) {
      if (prior.thread.scopeKey !== scopeKeyOf(scope)) return fail("invalid_input", { field: "requestId" });
      const reply = await prisma.marketingChatMessage.findFirst({ where: { replyToId: prior.id }, select: { id: true } });
      return { ok: true, threadId: prior.threadId, replyId: reply?.id ?? prior.id, duplicate: true };
    }
    const status = deps?.status?.() ?? aiStatus().text;
    if (status.state !== "ready" || !status.provider) return fail("integration_not_configured", { reason: status.reason ?? "not_ready" });
    if (await aiPaused()) return fail("ai_paused");

    try {
      return await prisma.$transaction(async (tx) => {
        const gate = await chatGate(tx, actor, scope);
        if (!gate.ok) abort(gate.code, gate.params);
        const threadId = await threadFor(tx, scope);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mk-chat:member:${gate.memberId}`}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mk-chat:thread:${threadId}`}))`;
        const raced = await tx.marketingChatMessage.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
        if (raced) {
          const reply = await tx.marketingChatMessage.findFirst({ where: { replyToId: raced.id }, select: { id: true } });
          return { ok: true as const, threadId, replyId: reply?.id ?? raced.id, duplicate: true };
        }
        // ردٌّ واحدٌ منتظرٌ لكل محادثة — لا تتراكم طلباتٌ مكلفة خلف بعضها
        if (await tx.marketingChatMessage.count({ where: { threadId, role: "assistant", status: { in: PENDING } } })) abort("chat_busy");
        const since = new Date(nowOf(deps).getTime() - 24 * 3600_000);
        const used = await tx.marketingChatMessage.count({ where: { authorId: gate.memberId, role: "user", createdAt: { gte: since } } });
        if (used >= CHAT_DAILY_QUOTA) abort("chat_quota", { limit: CHAT_DAILY_QUOTA });

        const fingerprint = await versionFingerprint(tx, scope);
        const userMsg = await tx.marketingChatMessage.create({
          data: { threadId, role: "user", body, authorId: gate.memberId, status: "done", idempotencyKey: key, finishedAt: nowOf(deps) },
          select: { id: true },
        });
        const reply = await tx.marketingChatMessage.create({
          data: {
            threadId, role: "assistant", body: "", replyToId: userMsg.id, status: "queued", contextFingerprint: fingerprint,
            provider: status.provider!, model: status.model, nextAttemptAt: nowOf(deps),
          },
          select: { id: true },
        });
        await tx.marketingChatThread.update({ where: { id: threadId }, data: { updatedAt: nowOf(deps) } });
        await logEvent(tx, actor, {
          action: "chat.sent",
          campaignId: scope.campaignId,
          deliverableId: scope.deliverableId ?? null,
          details: { kind: scope.kind, threadId, replyId: reply.id, chars: body.length },
        });
        return { ok: true as const, threadId, replyId: reply.id };
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await prisma.marketingChatMessage.findUnique({ where: { idempotencyKey: key }, select: { id: true, threadId: true } });
        if (again) {
          const reply = await prisma.marketingChatMessage.findFirst({ where: { replyToId: again.id }, select: { id: true } });
          return { ok: true as const, threadId: again.threadId, replyId: reply?.id ?? again.id, duplicate: true };
        }
      }
      throw e;
    }
  });
}

// ── المعالجة ────────────────────────────────────────────────────────────

export type ChatOutcome = "not_claimed" | "done" | "stale" | "retry_scheduled" | "failed" | "cancelled" | "discarded";

/** الفاعلُ الذي كتب الرسالة — يُعاد بناؤه من القاعدة ليُعاد فحصُ شرطه قبل المزوّد */
async function authorActor(authorId: string): Promise<MkActor | null> {
  const m = await prisma.marketingMember.findUnique({
    where: { id: authorId },
    select: { userId: true, memberId: true, user: { select: { role: true, fullName: true } }, member: { select: { fullName: true } } },
  });
  if (!m) return null;
  const session = m.userId
    ? { user: { id: m.userId, role: m.user?.role, name: m.user?.fullName } }
    : m.memberId
      ? { user: { id: m.memberId, role: "member", name: m.member?.fullName } }
      : null;
  return session ? marketingActor(session as unknown as Session) : null;
}

export async function processChatReply(replyId: string, deps?: ChatDeps): Promise<ChatOutcome> {
  const now = nowOf(deps);
  const M = prisma.marketingChatMessage;
  const claimed = await M.updateMany({
    where: {
      id: replyId,
      role: "assistant",
      attempts: { lt: M.fields.maxAttempts },
      OR: [
        { status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "running", leaseUntil: { lt: now } },
      ],
    },
    data: { status: "running", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, error: null },
  });
  if (claimed.count === 0) {
    await failExhausted(replyId, now);
    return "not_claimed";
  }
  const reply = await M.findUniqueOrThrow({
    where: { id: replyId },
    select: {
      id: true, attempts: true, maxAttempts: true, provider: true, contextFingerprint: true, replyToId: true, createdAt: true,
      thread: { select: { id: true, kind: true, campaignId: true, deliverableId: true } },
    },
  });
  const t = reply.thread;
  const scope: ChatScope = { kind: t.kind, campaignId: t.campaignId, deliverableId: t.deliverableId };
  const ours = { id: reply.id, status: "running" as const, attempts: reply.attempts };
  const question = reply.replyToId ? await M.findUnique({ where: { id: reply.replyToId }, select: { body: true, authorId: true } }) : null;
  if (!question?.authorId) return finish(ours, scope, { status: "failed", error: "orphaned" }, "chat.failed", now);

  // الشرطُ يُعاد قبل أي تكلفة: الإيقافُ المركزي، ثم مسؤوليةُ الكاتب وحالُ مهمّته الآن
  if (await aiPaused()) return finish(ours, scope, { status: "cancelled", error: "paused" }, "chat.cancelled", now);
  const author = await authorActor(question.authorId);
  const gate = author ? await chatGate(prisma, author, scope) : ({ ok: false, code: "forbidden" } as MkFail);
  if (!gate.ok) return finish(ours, scope, { status: "cancelled", error: gate.code }, "chat.cancelled", now);
  if ((await versionFingerprint(prisma, scope)) !== reply.contextFingerprint) {
    return finish(ours, scope, { status: "stale", error: "context_changed" }, "chat.stale", now);
  }

  const provider = deps?.providerFor ? deps.providerFor(reply.provider ?? "") : registryProvider(reply.provider);
  if (!provider?.chat) return finish(ours, scope, { status: "failed", error: "not_configured" }, "chat.failed", now);

  const history = await M.findMany({
    where: { threadId: t.id, createdAt: { lt: reply.createdAt }, status: "done", id: { not: reply.replyToId! } },
    orderBy: { createdAt: "desc" },
    take: CHAT_LIMITS.historyMessages,
    select: { role: true, body: true },
  });
  const context = await buildContext(prisma, scope);
  try {
    const out = await withTimeout(
      (signal) =>
        provider.chat!(
          { system: systemPromptFor(scope.kind), context: context.text, history: history.reverse().map((h) => ({ role: h.role, text: h.body })), message: question.body },
          signal
        ),
      deps?.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS
    );
    // تغيّرت المهمّةُ في أثناء الاستدعاء؟ يُحفظ الردُّ ويُعلَّم قديماً — لا يُعرض جواباً على الحال الجديدة
    const changed = (await versionFingerprint(prisma, scope)) !== reply.contextFingerprint;
    return finish(
      ours, scope,
      { status: changed ? "stale" : "done", body: out.text.slice(0, 20_000), model: out.model, inputTokens: out.usage?.inputTokens, outputTokens: out.usage?.outputTokens, error: changed ? "context_changed" : null },
      changed ? "chat.stale" : "chat.replied", nowOf(deps),
      { inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0, simulated: provider.simulated }
    );
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : "unknown";
    if (!(e instanceof ProviderError)) console.error("[marketing/chat] خطأٌ غيرُ مصنَّف:", e instanceof Error ? e.name : typeof e);
    const at = nowOf(deps);
    if (e instanceof ProviderError && e.retryable && reply.attempts < reply.maxAttempts) {
      const res = await M.updateMany({ where: ours, data: { status: "queued", leaseUntil: null, error: kind, nextAttemptAt: new Date(at.getTime() + backoffMs(reply.attempts)) } });
      return res.count ? "retry_scheduled" : "discarded";
    }
    return finish(ours, scope, { status: "failed", error: kind }, "chat.failed", at, { error: kind, attempts: reply.attempts });
  }
}

function registryProvider(id: string | null): TextProvider | null {
  const p = textProvider();
  return p && p.id === id ? p : null;
}

async function finish(
  ours: { id: string; status: "running"; attempts: number },
  scope: ChatScope,
  data: Prisma.MarketingChatMessageUncheckedUpdateManyInput & { status: MarketingChatStatus },
  action: "chat.replied" | "chat.failed" | "chat.cancelled" | "chat.stale",
  at: Date,
  details: Record<string, string | number | boolean> = {}
): Promise<ChatOutcome> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.marketingChatMessage.updateMany({ where: ours, data: { ...data, leaseUntil: null, finishedAt: at } });
    if (res.count === 0) return "discarded" as const;
    await logSystemEvent(tx, {
      action,
      campaignId: scope.campaignId,
      deliverableId: scope.deliverableId ?? null,
      details: { kind: scope.kind, replyId: ours.id, ...(data.error ? { error: String(data.error) } : {}), ...details },
    });
    return data.status as ChatOutcome;
  });
}

async function failExhausted(replyId: string, now: Date) {
  const M = prisma.marketingChatMessage;
  await M.updateMany({
    where: { id: replyId, status: "running", leaseUntil: { lt: now }, attempts: { gte: M.fields.maxAttempts } },
    data: { status: "failed", error: "timeout", leaseUntil: null, finishedAt: now },
  });
}

/** ما حان من الردود — لمحادثةٍ بعينها عند متابعتها، أو للكلّ في الكنس — في حدود وقتٍ وعدد */
export async function processDueChats(opts: { threadId?: string; limit?: number; budgetMs?: number } = {}, deps?: ChatDeps) {
  const started = Date.now();
  const now = nowOf(deps);
  const due = await prisma.marketingChatMessage.findMany({
    where: {
      role: "assistant",
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
      OR: [
        { status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "running", leaseUntil: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(opts.limit ?? 3, 10),
    select: { id: true },
  });
  const outcomes: ChatOutcome[] = [];
  for (const m of due) {
    if (Date.now() - started > (opts.budgetMs ?? 50_000)) break;
    outcomes.push(await processChatReply(m.id, deps));
  }
  return outcomes;
}

// ── إعادةُ المحاولة والإلغاء ─────────────────────────────────────────────

async function loadReply(replyId: string) {
  const r = await prisma.marketingChatMessage.findUnique({
    where: { id: replyId },
    select: { id: true, role: true, status: true, error: true, attempts: true, provider: true, replyToId: true, thread: { select: { id: true, kind: true, campaignId: true, deliverableId: true } } },
  });
  if (!r || r.role !== "assistant") abort("not_found");
  return r;
}

/** محاولةٌ إضافيةٌ واحدة لردٍّ فشل — بالسؤال نفسه، وبعد إعادة الشرط */
export async function retryChatReply(actor: MkActor, replyId: string, deps?: ChatDeps): Promise<MkResult> {
  return guarded(async () => {
    const r = await loadReply(replyId);
    if (r.status !== "failed") return fail("invalid_state", { from: r.status });
    if (r.error && FINAL_ERRORS.has(r.error)) return fail("job_not_retryable", { error: r.error });
    const status = deps?.status?.() ?? aiStatus().text;
    if (status.state !== "ready" || status.provider !== r.provider) return fail("integration_not_configured", { reason: status.reason ?? "provider_changed" });
    if (await aiPaused()) return fail("ai_paused");
    const scope: ChatScope = { kind: r.thread.kind, campaignId: r.thread.campaignId, deliverableId: r.thread.deliverableId };
    return prisma.$transaction(async (tx) => {
      const gate = await chatGate(tx, actor, scope);
      if (!gate.ok) abort(gate.code, gate.params);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mk-chat:thread:${r.thread.id}`}))`;
      if (await tx.marketingChatMessage.count({ where: { threadId: r.thread.id, role: "assistant", status: { in: PENDING } } })) abort("chat_busy");
      const res = await tx.marketingChatMessage.updateMany({
        where: { id: r.id, status: "failed", attempts: r.attempts },
        data: { status: "queued", maxAttempts: r.attempts + 1, nextAttemptAt: nowOf(deps), error: null, finishedAt: null, contextFingerprint: await versionFingerprint(tx, scope) },
      });
      if (res.count === 0) abort("stale");
      await logEvent(tx, actor, { action: "chat.sent", campaignId: scope.campaignId, deliverableId: scope.deliverableId ?? null, details: { kind: scope.kind, replyId: r.id, retry: true } });
      return { ok: true as const };
    });
  });
}

export async function cancelChatReply(actor: MkActor, replyId: string): Promise<MkResult> {
  return guarded(async () => {
    const r = await loadReply(replyId);
    const scope: ChatScope = { kind: r.thread.kind, campaignId: r.thread.campaignId, deliverableId: r.thread.deliverableId };
    const q = r.replyToId ? await prisma.marketingChatMessage.findUnique({ where: { id: r.replyToId }, select: { authorId: true } }) : null;
    // يلغيه صاحبُ السؤال وحده
    if (!actor.member || q?.authorId !== actor.member.id) return fail("forbidden", { role: "assignee" });
    return prisma.$transaction(async (tx) => {
      const res = await tx.marketingChatMessage.updateMany({ where: { id: r.id, status: { in: PENDING } }, data: { status: "cancelled", error: "cancelled", leaseUntil: null, finishedAt: new Date() } });
      if (res.count === 0) abort("invalid_state", { from: r.status });
      await logEvent(tx, actor, { action: "chat.cancelled", campaignId: scope.campaignId, deliverableId: scope.deliverableId ?? null, details: { kind: scope.kind, replyId: r.id } });
      return { ok: true as const };
    });
  });
}

// ── القراءة ────────────────────────────────────────────────────────────

/** المحادثةُ للعرض: رسائلُها الأخيرة، وهل يكتب فيها صاحبُ الطلب الآن ولماذا لا. للقراءة يكفي
 *  أن يرى الحملة؛ والكتابةُ بشرطها (`chatGate`). المحادثةُ المغلقة تُقرأ ولا تُحذف. */
export async function chatView(actor: MkActor, scope: ChatScope, deps?: Pick<ChatDeps, "status">) {
  const { campaignAccess } = await import("../access");
  const access = await campaignAccess(actor, scope.campaignId);
  if (!access.canView) return null;
  const thread = await prisma.marketingChatThread.findUnique({ where: { scopeKey: scopeKeyOf(scope) }, select: { id: true } });
  const messages = thread
    ? await prisma.marketingChatMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        take: VIEW_TAKE,
        select: { id: true, role: true, body: true, status: true, error: true, attempts: true, maxAttempts: true, model: true, createdAt: true, nextAttemptAt: true, authorId: true },
      })
    : [];
  const gate = await chatGate(prisma, actor, scope);
  const ai = deps?.status?.() ?? aiStatus().text;
  const paused = await aiPaused();
  return {
    threadId: thread?.id ?? null,
    messages: messages.reverse(),
    canWrite: gate.ok && ai.state === "ready" && !paused,
    blocked: gate.ok ? null : { code: gate.code, params: gate.params ?? null },
    ai: { state: ai.state, reason: ai.reason, simulated: ai.simulated },
    paused,
    me: actor.member?.id ?? null,
  };
}
