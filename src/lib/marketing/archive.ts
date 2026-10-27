import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MARKETING_ARCHIVE_HEADERS, marketingArchiveStore, type ArchiveStore } from "@/lib/googleSheets";
import { riyadhDateKey } from "@/lib/riyadh";
import { requireCampaignRole, type MkActor } from "./access";
import { logEvent, logSystemEvent } from "./audit";
import { personName } from "./campaigns";
import { completeKpis } from "./schedule";
import { abort, fail, guarded, type MkResult } from "./result";
import { backoffMs } from "./ai/jobs";
import { ACTIVE_ARCHIVE, assertNotArchiving } from "./archiveGuard";

/** أرشفةُ حملةٍ مكتملة في Google Sheets المرتبط بالمنصة، ثم حذفُها من النظام النشط — بهذا الترتيب وحده.
 *
 *    جاهزيةٌ ← طلب ← كتابةٌ للناقص ← قراءةٌ من الملف ← مطابقةٌ صفّاً صفّاً ← «تحقّق» ← حذفٌ في معاملة
 *
 *  - **لا حذفَ قبل التحقق:** إن فشلت الكتابةُ أو القراءةُ أو المطابقة، أو تعذّر الوصولُ إلى الملف،
 *    بقيت الحملةُ كما هي، وبقي السجلُّ «معلّقاً» يُعاد (بتأخيرٍ متزايدٍ وحدٍّ معلوم) أو «فاشلاً» بسببه.
 *  - **لا تكرار:** لكل صفٍّ مفتاحٌ ثابت (`معرّف الحملة:النوع:المعرّف`). كلُّ محاولةٍ تقرأ ما في الملف
 *    أولاً وتُلحق الناقصَ وحده — فانقطاعٌ بعد كتابةٍ نجحت لا يُضاعف الصفوف، وما كُتب لا يُعاد.
 *  - **لا تختلف القيمُ بين المحاولات:** «وقت الأرشفة» وقتُ الطلب لا وقتُ الكتابة، والقيمُ تُكتب `RAW`.
 *  - **الحذفُ لهذه الحملة وحدها، في معاملةٍ واحدة،** بترتيبٍ يحترم القيود: لا يُحذف عضوٌ في الفريق
 *    ولا مقاسٌ مشترك ولا حسابٌ ولا صلاحية. ويُختم السجلُّ «مكتملاً» في المعاملة نفسها — فإن فشل
 *    الحذفُ بقيت البياناتُ والسجلُّ «متحقَّقاً» يُستأنف منه.
 *  - **ما يبقى بعد الحذف:** سجلُّ الأرشفة (`MarketingArchiveRun`) بأعداده، وحدثٌ في السجلّ — لا نسخةٌ
 *    نشطةٌ من الحملة.
 *  - **ملفّاتُ التصميم نفسُها لا تُحفظ في الشيت:** يُحفظ اسمُها وأبعادُها وبصمتُها، والرابطُ الخارجيُّ
 *    إن وُجد، ورابطُ المنشور الفعلي. ويُقال ذلك صراحةً في صفّ القطعة.
 *  - **والمراجعةُ ممكنةٌ بعد الحذف** من الشيت نفسه (`searchArchive`، `archivedCampaign`)، بلا إعادة
 *    الحملة إلى القاعدة النشطة. */

type Tx = Prisma.TransactionClient;
const ACTIVE = ACTIVE_ARCHIVE;
/** محاولاتٌ آليةٌ بحدٍّ معلوم (مع الكنس اليومي ≈ أسبوع) — ثم «فاشلة» تنتظر إعادةً يدوية */
const MAX_ATTEMPTS = 8;
const LEASE_MS = 120_000;
const DETAILS_MAX = 45_000;
const COLS = MARKETING_ARCHIVE_HEADERS.length;

export type ArchiveDeps = { store?: ArchiveStore | null; now?: () => Date };
const storeOf = (deps?: ArchiveDeps) => (deps && "store" in deps ? deps.store ?? null : marketingArchiveStore());
const nowOf = (deps?: ArchiveDeps) => deps?.now?.() ?? new Date();

// ─── الجاهزية ────────────────────────────────────────────────────────

/** ما يمنع أرشفةَ الحملة الآن — فارغةٌ = جاهزة */
export async function archiveBlockers(db: Tx | typeof prisma, campaignId: string, now = new Date()): Promise<string[]> {
  const c = await db.marketingCampaign.findUnique({
    where: { id: campaignId },
    select: {
      status: true, deadline: true,
      deliverables: { select: { status: true, unpublishedReason: true } },
      _count: { select: { tasks: { where: { status: { in: ["todo", "in_progress", "blocked"] } } } } },
    },
  });
  if (!c) return ["not_found"];
  const out: string[] = [];
  if (c.status !== "published" && c.status !== "archived") out.push("not_closed");
  if (!c.deadline || c.deadline.getTime() > now.getTime()) out.push("not_ended");
  if (c._count.tasks > 0) out.push("open_tasks");
  if (c.deliverables.some((d) => d.status !== "published" && !d.unpublishedReason)) out.push("unpublished_undocumented");
  const running = await db.marketingArchiveRun.count({ where: { campaignId, status: { in: ACTIVE } } });
  if (running) out.push("archive_active");
  return out;
}

/** توثيقُ سبب عدم نشر قطعة — شرطٌ لأرشفة حملةٍ لم تُنشر كلُّ قطعها. المنسّقُ، والحملةُ مغلقة */
export async function documentUnpublished(actor: MkActor, deliverableId: string, reason: string): Promise<MkResult> {
  return guarded(async () => {
    const d = await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { id: true, campaignId: true, status: true, campaign: { select: { status: true } } } });
    if (!d) return fail("not_found");
    await requireCampaignRole(actor, d.campaignId, "coordinator");
    if (d.status === "published") return fail("invalid_state", { from: d.status });
    if (d.campaign.status !== "published" && d.campaign.status !== "archived") return fail("invalid_state", { from: d.campaign.status });
    const text = reason.trim().slice(0, 1000);
    if (text.length < 5) return fail("invalid_input", { field: "reason" });
    await prisma.$transaction(async (tx) => {
      if (await tx.marketingArchiveRun.count({ where: { campaignId: d.campaignId, status: { in: ACTIVE } } })) abort("archive_active");
      await tx.marketingDeliverable.update({ where: { id: d.id }, data: { unpublishedReason: text } });
      await logEvent(tx, actor, { action: "deliverable.unpublished_documented", campaignId: d.campaignId, deliverableId: d.id });
    });
    return { ok: true };
  });
}

export { assertNotArchiving };

// ─── الصفوف ──────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");
const day = (d: Date | null | undefined) => (d ? riyadhDateKey(d) : "");
const json = (v: unknown) => {
  const s = JSON.stringify(v ?? {});
  return s.length > DETAILS_MAX ? s.slice(0, DETAILS_MAX - 20) + "…[مقصوص]" : s;
};

/** صفوفُ الحملة كما تُكتب — بترتيبٍ ثابتٍ ومفاتيحَ ثابتة، فتُبنى في كل محاولةٍ بالقيم نفسها */
export async function archiveRows(db: Tx | typeof prisma, campaignId: string, archivedAt: Date): Promise<string[][]> {
  const c = await db.marketingCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      owner: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } },
      planVersions: { orderBy: { number: "asc" }, include: { decisions: { orderBy: { createdAt: "asc" } } } },
      scheduleChanges: { orderBy: { createdAt: "asc" } },
      files: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, fileName: true, byteSize: true, sha256: true, taskId: true, createdAt: true } },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } } } },
      // سجلُّ الحملة حتى طلب الأرشفة — وأحداثُ الأرشفة نفسها سجلٌّ تقنيٌّ لا تُكتب في صفوفها
      events: { where: { createdAt: { lt: archivedAt }, NOT: { action: { startsWith: "archive." } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      chatThreads: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, deliverableId: true, createdAt: true, _count: { select: { messages: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } },
      tasks: { orderBy: { createdAt: "asc" }, include: { assignee: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } } } },
      deliverables: {
        orderBy: { createdAt: "asc" },
        include: {
          writer: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } },
          designer: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } },
          currentContentVersion: { select: { number: true, body: true, sources: true } },
          currentDesignVersion: { select: { number: true, width: true, height: true, file: { select: { fileName: true, sha256: true, byteSize: true } } } },
          designBrief: true,
          approvals: { orderBy: { createdAt: "asc" }, include: { decider: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } }, contentVersion: { select: { number: true } }, designVersion: { select: { number: true } } } },
          qualityChecks: { orderBy: { createdAt: "asc" }, include: { reviewer: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } }, contentVersion: { select: { number: true } }, designVersion: { select: { number: true } } } },
          finalChecks: { orderBy: { createdAt: "asc" }, include: { publisher: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } }, contentVersion: { select: { number: true } }, designVersion: { select: { number: true } } } },
          publications: { orderBy: { publishedAt: "asc" }, include: { publisher: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } } } },
        },
      },
    },
  });
  const at = archivedAt.toISOString();
  const start = day(c.startDate);
  const end = day(c.deadline);
  const row = (key: string, type: string, o: Partial<Record<"platform" | "contentType" | "item" | "status" | "planned" | "actual" | "person" | "result" | "link", string>>, details: unknown) => [
    `${c.id}:${key}`, c.id, type, c.name, start, end, o.platform ?? "", o.contentType ?? "", o.item ?? "", o.status ?? "",
    o.planned ?? "", o.actual ?? "", o.person ?? "", o.result ?? "", o.link ?? "", json(details), at,
  ];
  const current = c.planVersions.find((v) => v.id === c.currentPlanVersionId) ?? null;
  const rows: string[][] = [
    row("campaign", "campaign", { item: c.name, status: c.status, person: personName(c.owner), result: current ? `خطة نسخة ${current.number}` : "بلا خطة معتمدة" }, {
      description: c.description, objective: c.objective, outcomes: c.outcomes, audience: c.audience, audienceSegments: c.audienceSegments,
      keyMessage: c.keyMessage, channels: c.channels, budget: c.budgetAmount ?? "غير محدّدة", budgetNote: c.budgetNote, kpis: completeKpis(c.kpis),
      measurement: c.measurement, references: c.references, risks: c.risks, timezone: c.timezone, priority: c.priority,
      approvedPlan: current ? { number: current.number, fingerprint: current.fingerprint, snapshot: current.snapshot } : null,
    }),
  ];
  for (const v of c.planVersions) {
    for (const dec of v.decisions) {
      rows.push(row(`plan:${v.number}:${dec.stage}`, "plan_decision", { item: `نسخة ${v.number} — ${dec.stage}`, status: v.invalidatedAt ? `أُبطلت: ${v.invalidatedReason ?? ""}` : "قائمة", actual: iso(dec.createdAt), person: `${dec.deciderName} (${dec.deciderRole})`, result: dec.decision }, { note: dec.note }));
    }
  }
  for (const d of c.deliverables) {
    const design = d.currentDesignVersion;
    rows.push(row(`piece:${d.id}`, "piece", {
      platform: d.platform, contentType: d.contentType ?? "", item: d.title, status: d.status, planned: iso(d.publishAt),
      actual: iso(d.publications[0]?.publishedAt), person: `كاتب: ${d.writer ? personName(d.writer) : "—"} · مصمّم: ${d.designer ? personName(d.designer) : "—"}`,
      result: d.status === "published" ? "نُشرت" : `لم تُنشر: ${d.unpublishedReason ?? "—"}`, link: d.publications[0]?.url ?? "",
    }, {
      topic: d.topic, message: d.message, cta: d.cta, kpi: d.kpi,
      schedule: { contentDueAt: iso(d.contentDueAt), designDueAt: iso(d.designDueAt), reviewDueAt: iso(d.reviewDueAt), publishAt: iso(d.publishAt), basis: d.publishBasis, basisNote: d.publishBasisNote },
      format: { key: d.formatKey, width: d.width, height: d.height, safe: [d.safeTop, d.safeRight, d.safeBottom, d.safeLeft] },
      finalText: d.currentContentVersion ? { version: d.currentContentVersion.number, body: d.currentContentVersion.body, sources: d.currentContentVersion.sources } : null,
      designBrief: d.designBrief ? Object.fromEntries(Object.entries(d.designBrief).filter(([k]) => !["id", "deliverableId", "createdAt", "updatedAt"].includes(k))) : null,
      design: design ? { version: design.number, width: design.width, height: design.height, fileName: design.file.fileName, sha256: design.file.sha256, bytes: design.file.byteSize, fileArchived: false, note: "ملفُّ التصميم نفسه لا يُحفظ في الشيت — يُحذف مع الحملة؛ المرجعُ المنشورُ الفعلي ورابطُ الموجز الخارجي إن وُجد" } : null,
    }));
    for (const a of d.approvals) {
      rows.push(row(`approval:${a.id}`, "approval", { platform: d.platform, item: `${d.title} — ${a.kind} ${a.kind === "content" ? a.contentVersion?.number ?? "" : a.designVersion?.number ?? ""}`, status: a.invalidatedAt ? `أُبطل: ${a.invalidatedReason ?? ""}` : "قائم", actual: iso(a.createdAt), person: personName(a.decider), result: a.decision }, { note: a.note }));
    }
    for (const q of d.qualityChecks) {
      rows.push(row(`quality:${q.id}`, "quality", { platform: d.platform, item: `${d.title} — نص ${q.contentVersion.number} / تصميم ${q.designVersion.number}`, status: q.invalidatedAt ? `أُبطل: ${q.invalidatedReason ?? ""}` : "قائم", actual: iso(q.createdAt), person: personName(q.reviewer), result: q.passed ? "اجتاز" : q.blocking ? "لم يجتز — مانع" : "لم يجتز" }, { items: q.items, note: q.note }));
    }
    for (const f of d.finalChecks) {
      rows.push(row(`final:${f.id}`, "final_check", { platform: d.platform, item: `${d.title} — نص ${f.contentVersion.number} / تصميم ${f.designVersion.number}`, status: f.invalidatedAt ? `أُبطل: ${f.invalidatedReason ?? ""}` : "قائم", actual: iso(f.createdAt), person: personName(f.publisher), result: f.passed ? "اجتاز" : `أُعيد: ${f.returnedTo ?? "—"}` }, { items: f.items, note: f.note }));
    }
    for (const p of d.publications) {
      rows.push(row(`publication:${p.id}`, "publication", { platform: p.platform, contentType: d.contentType ?? "", item: d.title, status: "منشور", planned: iso(d.publishAt), actual: iso(p.publishedAt), person: personName(p.publisher), result: p.metrics ? `نتائج حتى ${iso(p.metricsAsOf)}` : "لا نتائج مسجّلة", link: p.url }, { timezone: p.timezone, notes: p.notes, verifiedAt: iso(p.verifiedAt), metrics: p.metrics, metricsSource: p.metricsSource }));
    }
  }
  for (const t of c.tasks) {
    rows.push(row(`task:${t.id}`, "task", { item: t.title, status: t.status, planned: iso(t.dueAt), actual: iso(t.completedAt), person: t.assignee ? personName(t.assignee) : "—", result: t.kind }, { description: t.description, reopened: t.reopenCount, planVersionId: t.planVersionId }));
  }
  for (const s of c.scheduleChanges) {
    rows.push(row(`schedule:${s.id}`, "schedule_change", { item: s.field, actual: iso(s.createdAt), person: `${s.changedByName} — وافق: ${s.approvedByName}`, result: `${s.fromValue ?? "—"} ← ${s.toValue ?? "—"}` }, { reason: s.reason, deliverableId: s.deliverableId }));
  }
  // الملفّاتُ نفسها لا تُكتب في الشيت ولا تبقى بعد الحذف — يُحفظ وصفُها وبصمتُها فقط
  for (const f of c.files) {
    rows.push(row(`file:${f.id}`, "file", { item: f.fileName, status: f.kind, actual: iso(f.createdAt), result: `${f.byteSize} بايت` }, { sha256: f.sha256, taskId: f.taskId, fileArchived: false }));
  }
  for (const m of c.comments) {
    rows.push(row(`comment:${m.id}`, "comment", { item: m.deliverableId ? `قطعة ${m.deliverableId}` : m.taskId ? `مهمّة ${m.taskId}` : "الحملة", actual: iso(m.createdAt), person: personName(m.author) }, { body: m.body.slice(0, 4000) }));
  }
  // المحادثاتُ مع المساعد مسوداتُ عمل: يُحفظ وجودُها وعددُها ووقتُها، لا نصوصُها — والنصوصُ النهائيةُ
  // المعتمدةُ محفوظةٌ في صفوف القطع. ويُقال ذلك صراحةً في الصف.
  for (const t of c.chatThreads) {
    rows.push(row(`chat:${t.id}`, "chat", { item: t.kind, actual: iso(t.messages[0]?.createdAt ?? t.createdAt), result: `${t._count.messages} رسالة` }, { deliverableId: t.deliverableId, textsArchived: false, note: "نصوصُ المحادثة لا تُؤرشف — مسوداتُ عمل؛ النصُّ النهائيُّ في صفّ القطعة" }));
  }
  for (const e of c.events) {
    rows.push(row(`event:${e.id}`, "event", { item: e.action, actual: iso(e.createdAt), person: `${e.actorName} (${e.actorKind})` }, { deliverableId: e.deliverableId, details: e.details }));
  }
  // النواقصُ تُوثَّق ولا تُعوَّض بقيم
  const gaps: string[] = [];
  for (const d of c.deliverables) if (d.publications.length && d.publications.every((p) => !p.metrics)) gaps.push(`لا نتائج مسجّلة بعد النشر: ${d.title}`);
  if (!completeKpis(c.kpis).length) gaps.push("لا مؤشرات أداء مكتملة في الخطة");
  gaps.forEach((g, i) => rows.push(row(`gap:${i + 1}`, "gap", { item: g, status: "ناقص" }, {})));
  return rows;
}

const norm = (r: string[]) => {
  const out = r.slice(0, COLS).map((v) => v ?? "");
  while (out.length < COLS) out.push("");
  return out;
};
const rowHash = (r: string[]) => createHash("sha256").update(JSON.stringify(norm(r))).digest("hex");

// ─── الطلب والمعالجة ─────────────────────────────────────────────────

export async function requestArchive(actor: MkActor, campaignId: string, deps?: ArchiveDeps): Promise<MkResult<{ runId: string }>> {
  return guarded(async () => {
    await requireCampaignRole(actor, campaignId, "coordinator");
    if (!actor.isMarketingLead) return fail("forbidden", { role: "manager" });
    if (!storeOf(deps)) return fail("archive_unavailable");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mk-archive:${campaignId}`}))`;
      const blockers = await archiveBlockers(tx, campaignId, nowOf(deps));
      if (blockers.includes("archive_active")) abort("archive_active");
      if (blockers.length) abort("archive_not_ready", { missing: blockers.join(",") });
      const c = await tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { name: true, status: true } });
      // الحملةُ تُقفل نهائياً قبل كتابتها: ما يُؤرشف لا يتغيّر تحته
      if (c.status !== "archived") await tx.marketingCampaign.update({ where: { id: campaignId }, data: { status: "archived", revision: { increment: 1 } } });
      const run = await tx.marketingArchiveRun.create({
        data: { campaignId, campaignName: c.name, sheetName: storeOf(deps)!.sheet, requestedByName: actor.name, nextAttemptAt: nowOf(deps) },
        select: { id: true },
      });
      await logEvent(tx, actor, { action: "archive.requested", campaignId, details: { runId: run.id } });
      return { ok: true as const, runId: run.id };
    });
  });
}

export type ArchiveOutcome = "not_claimed" | "completed" | "retry_scheduled" | "failed";

/** خطوةُ أرشفةٍ واحدة — تُستأنف من حيث وقفت. لا تحذف إلا بعد مطابقةٍ تامّة لما في الملف. */
export async function processArchiveRun(runId: string, deps?: ArchiveDeps): Promise<ArchiveOutcome> {
  const now = nowOf(deps);
  const R = prisma.marketingArchiveRun;
  const claimed = await R.updateMany({
    where: {
      id: runId,
      OR: [
        { status: { in: ["pending", "verified"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: { in: ["writing", "deleting"] }, leaseUntil: { lt: now } },
      ],
    },
    data: { status: "writing", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, lastError: null },
  });
  if (claimed.count === 0) return "not_claimed";
  const run = await R.findUniqueOrThrow({ where: { id: runId } });
  const ours = { id: run.id, attempts: run.attempts };
  const failWith = async (code: string, retryable: boolean): Promise<ArchiveOutcome> => {
    const final = !retryable || run.attempts >= MAX_ATTEMPTS;
    await R.updateMany({
      where: { ...ours, status: { in: ["writing", "deleting"] } },
      data: final
        ? { status: "failed", lastError: code, leaseUntil: null }
        : { status: "pending", lastError: code, leaseUntil: null, nextAttemptAt: new Date(now.getTime() + backoffMs(run.attempts)) },
    });
    const exists = await prisma.marketingCampaign.count({ where: { id: run.campaignId } });
    await logSystemEvent(prisma, { action: "archive.failed", campaignId: exists ? run.campaignId : null, details: { runId: run.id, error: code, attempts: run.attempts, final } });
    return final ? "failed" : "retry_scheduled";
  };

  if (!(await prisma.marketingCampaign.count({ where: { id: run.campaignId } }))) return failWith("campaign_missing", false);
  const store = storeOf(deps);
  if (!store) return failWith("store_unavailable", true);

  let expected: string[][];
  try {
    expected = await archiveRows(prisma, run.campaignId, run.createdAt);
    await store.ensure();
    // ما كُتب في محاولةٍ سابقة لا يُعاد: يكفي عمودا المفتاح والحملة لمعرفته
    const present = new Set((await store.readRows(2)).filter((r) => r[1] === run.campaignId).map((r) => r[0]));
    const missing = expected.filter((r) => !present.has(r[0]));
    await store.appendRows(missing);
  } catch (e) {
    return failWith(sheetError(e), true);
  }

  // القراءةُ بعد الكتابة — ومنها وحدها يُحكم
  let written: string[][];
  try {
    written = await campaignRowsInSheet(store, run.campaignId);
  } catch (e) {
    return failWith(sheetError(e), true);
  }
  const byKey = new Map<string, string[][]>();
  for (const r of written) byKey.set(r[0], [...(byKey.get(r[0]) ?? []), r]);
  const duplicated = [...byKey.values()].some((rs) => rs.length > 1);
  const mismatched = expected.filter((r) => {
    const got = byKey.get(r[0]);
    return !got || got.length !== 1 || rowHash(got[0]) !== rowHash(r);
  });
  const extra = written.filter((r) => !expected.some((e) => e[0] === r[0]));
  if (duplicated || extra.length) return failWith("sheet_unexpected_rows", false);
  if (mismatched.length) return failWith(`sheet_mismatch:${mismatched.length}`, true);

  const counts = expected.reduce<Record<string, number>>((m, r) => ({ ...m, [r[2]]: (m[r[2]] ?? 0) + 1 }), {});
  await R.updateMany({
    where: { ...ours, status: "writing" },
    data: { status: "verified", expectedRows: expected.length, verifiedRows: written.length, verifiedAt: now, summary: { counts, rowHashes: expected.length } },
  });
  await logSystemEvent(prisma, { action: "archive.verified", campaignId: run.campaignId, details: { runId: run.id, rows: expected.length, ...counts } });

  try {
    await prisma.$transaction(async (tx) => {
      const claimedDelete = await tx.marketingArchiveRun.updateMany({ where: { ...ours, status: "verified" }, data: { status: "deleting" } });
      if (claimedDelete.count === 0) abort("stale");
      // ما تغيّر بعد التحقق لا يُحذف على صورةٍ قديمة
      const now2 = await archiveRows(tx, run.campaignId, run.createdAt);
      if (now2.length !== expected.length || now2.some((r, i) => rowHash(r) !== rowHash(expected[i]))) abort("archive_failed", { reason: "changed_after_verify" });
      await deleteCampaignData(tx, run.campaignId);
      await tx.marketingArchiveRun.update({ where: { id: run.id }, data: { status: "completed", deletedAt: new Date(), leaseUntil: null } });
      await logSystemEvent(tx, { action: "archive.completed", campaignId: null, details: { runId: run.id, campaignId: run.campaignId, name: run.campaignName, rows: expected.length } });
      // إعادةُ بناء الصفوف ومطابقتُها ثم الحذفُ في معاملةٍ واحدة — مهلةٌ تتّسع لحملةٍ كبيرة (لا الافتراضيةُ ٥ ثوانٍ)
    }, { timeout: 60_000, maxWait: 10_000 });
    return "completed";
  } catch (e) {
    // البياناتُ باقية (المعاملةُ لم تكتمل) — يُستأنف من التحقق
    await R.updateMany({ where: { id: run.id, status: { in: ["deleting", "verified"] } }, data: { status: "verified", leaseUntil: null, nextAttemptAt: new Date(now.getTime() + backoffMs(run.attempts)) } });
    const code = e && typeof e === "object" && "failure" in e ? "changed_after_verify" : "delete_failed";
    await logSystemEvent(prisma, { action: "archive.failed", campaignId: run.campaignId, details: { runId: run.id, error: code } });
    return "retry_scheduled";
  }
}

/** صفوفُ حملةٍ واحدة من الملف: فهرسٌ خفيفٌ (عمودان) يحدّد موضعها، ثم نافذتُها وحدها بكامل أعمدتها */
async function campaignRowsInSheet(store: ArchiveStore, campaignId: string): Promise<string[][]> {
  const at = (await store.readRows(2)).flatMap((r, i) => (r[1] === campaignId ? [i] : []));
  if (at.length === 0) return [];
  const rows = await store.readRows(COLS, { from: at[0], to: at[at.length - 1] });
  return rows.filter((r) => r[1] === campaignId);
}

function sheetError(e: unknown): string {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
  if (/ETIMEDOUT|ECONNRESET|ECONNABORTED|timeout/i.test(code) || (e instanceof Error && /timeout/i.test(e.message))) return "sheet_timeout";
  if (code === "403" || code === "401") return "sheet_permission";
  if (code === "429") return "sheet_rate_limited";
  return "sheet_error";
}

/** يحذف الحملةَ وما يخصّها وحدها — بترتيب القيود، في المعاملة نفسها. لا يمسّ الفريقَ ولا المقاسات
 *  ولا الحساباتِ ولا دوراتِ التخطيط ولا سجلّاتِ الأرشفة. */
async function deleteCampaignData(tx: Tx, campaignId: string) {
  const ids = (await tx.marketingDeliverable.findMany({ where: { campaignId }, select: { id: true } })).map((d) => d.id);
  const where = { deliverableId: { in: ids } };
  await tx.marketingCampaign.update({ where: { id: campaignId }, data: { currentPlanVersionId: null } });
  await tx.marketingDeliverable.updateMany({ where: { id: { in: ids } }, data: { currentContentVersionId: null, currentDesignVersionId: null } });
  await tx.marketingApproval.deleteMany({ where });
  await tx.marketingQualityCheck.deleteMany({ where });
  await tx.marketingFinalCheck.deleteMany({ where });
  await tx.marketingPublication.deleteMany({ where });
  await tx.marketingGenerationJob.deleteMany({ where });
  await tx.marketingChatThread.deleteMany({ where: { campaignId } });
  await tx.marketingDesignVersion.deleteMany({ where });
  await tx.marketingContentVersion.deleteMany({ where });
  await tx.marketingComment.deleteMany({ where: { campaignId } });
  await tx.marketingFile.deleteMany({ where: { campaignId } });
  await tx.marketingTaskDependency.deleteMany({ where: { task: { campaignId } } });
  await tx.marketingTask.deleteMany({ where: { campaignId } });
  await tx.marketingScheduleChange.deleteMany({ where: { campaignId } });
  await tx.marketingDesignBrief.deleteMany({ where });
  // سجلُّ التدقيق لا يُحذف: يُفصل عن الحملة المحذوفة ويبقى، ومعرّفُها محفوظٌ في تفاصيله
  await tx.$executeRaw`
    UPDATE "MarketingEvent"
       SET "details" = jsonb_set(COALESCE("details", '{}'::jsonb), '{archivedCampaignId}', to_jsonb(${campaignId}::text)),
           "campaignId" = NULL,
           "deliverableId" = NULL
     WHERE "campaignId" = ${campaignId} OR "deliverableId" = ANY(${ids}::text[])`;
  await tx.marketingDeliverable.deleteMany({ where: { campaignId } });
  await tx.marketingPlanVersion.deleteMany({ where: { campaignId } });
  await tx.marketingCampaignMember.deleteMany({ where: { campaignId } });
  await tx.marketingCampaign.delete({ where: { id: campaignId } });
}

/** ما حان من الأرشفة — للكنس المجدول، في حدود عددٍ ووقت */
export async function processDueArchives(opts: { limit?: number; budgetMs?: number } = {}, deps?: ArchiveDeps) {
  const started = Date.now();
  const now = nowOf(deps);
  const due = await prisma.marketingArchiveRun.findMany({
    where: {
      OR: [
        { status: { in: ["pending", "verified"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: { in: ["writing", "deleting"] }, leaseUntil: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(opts.limit ?? 2, 5),
    select: { id: true },
  });
  const out: ArchiveOutcome[] = [];
  for (const r of due) {
    if (Date.now() - started > (opts.budgetMs ?? 45_000)) break;
    out.push(await processArchiveRun(r.id, deps));
  }
  return out;
}

/** إعادةٌ يدويةٌ لأرشفةٍ فشلت نهائياً — قائدُ التسويق، والحملةُ ما زالت قائمة */
export async function retryArchive(actor: MkActor, runId: string): Promise<MkResult> {
  return guarded(async () => {
    const run = await prisma.marketingArchiveRun.findUnique({ where: { id: runId } });
    if (!run) return fail("not_found");
    await requireCampaignRole(actor, run.campaignId, "coordinator");
    if (!actor.isMarketingLead) return fail("forbidden", { role: "manager" });
    if (run.status !== "failed") return fail("invalid_state", { from: run.status });
    const res = await prisma.marketingArchiveRun.updateMany({ where: { id: run.id, status: "failed" }, data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    return res.count ? { ok: true } : fail("stale");
  });
}

/** سجلّاتُ أرشفة الحملة — للعرض */
export async function campaignArchiveRuns(campaignId: string) {
  return prisma.marketingArchiveRun.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" }, take: 10 });
}

// ─── البحثُ والاسترجاع ───────────────────────────────────────────────

/** من يبحث في الأرشيف: قائدُ التسويق، ومعتمِدا الخطة (التشغيلُ والتنفيذي). والمؤسسُ لا يدخل الوكيل */
export function canReadArchive(actor: MkActor) {
  return !actor.isFounder && (actor.isMarketingLead || !!actor.planStage);
}

export type ArchiveQuery = { text?: string; from?: string; to?: string; platform?: string; contentType?: string };
const SEARCH_COLS = 10; // حتى «الحالة» — البحثُ لا يحمّل التفاصيلَ ولا النصوص

/** يبحث في الأرشيف من الملف مباشرةً — يقرأ الأعمدةَ اللازمة وحدها، ولا يعيد شيئاً إلى القاعدة النشطة،
 *  ولا يخزّن نتيجةً تُعرض لاحقاً كأنها حديثة. وإن تعذّر الملفُّ قيل ذلك، ولا تُعرض نتيجةٌ قديمة. */
export async function searchArchive(actor: MkActor, q: ArchiveQuery, deps?: ArchiveDeps) {
  if (!canReadArchive(actor)) return fail("forbidden", { role: "manager" });
  const store = storeOf(deps);
  if (!store) return fail("archive_unavailable");
  let rows: string[][];
  try {
    rows = await store.readRows(SEARCH_COLS);
  } catch {
    return fail("archive_unavailable");
  }
  const text = q.text?.trim().toLowerCase() ?? "";
  const byCampaign = new Map<string, { campaignId: string; name: string; start: string; end: string; platforms: Set<string>; contentTypes: Set<string>; pieces: number; published: number }>();
  for (const r of rows) {
    const [, id, type, name, start, end, platform, contentType, , status] = norm(r);
    if (!id) continue;
    const e = byCampaign.get(id) ?? { campaignId: id, name, start, end, platforms: new Set<string>(), contentTypes: new Set<string>(), pieces: 0, published: 0 };
    if (type === "piece") {
      e.pieces++;
      if (status === "published") e.published++;
      if (platform) e.platforms.add(platform);
      if (contentType) e.contentTypes.add(contentType);
    }
    byCampaign.set(id, e);
  }
  const results = [...byCampaign.values()]
    .filter((e) => !text || e.campaignId.toLowerCase() === text || e.name.toLowerCase().includes(text))
    .filter((e) => !q.from || (e.end && e.end >= q.from))
    .filter((e) => !q.to || (e.start && e.start <= q.to))
    .filter((e) => !q.platform || e.platforms.has(q.platform))
    .filter((e) => !q.contentType || e.contentTypes.has(q.contentType))
    .sort((a, b) => (b.end || "").localeCompare(a.end || ""))
    .slice(0, 50)
    .map((e) => ({ ...e, platforms: [...e.platforms], contentTypes: [...e.contentTypes] }));
  return { ok: true as const, results, readAt: new Date().toISOString() };
}

/** تفاصيلُ حملةٍ مؤرشفة — صفوفُها من الملف كما هي. لا تُنشأ بها حملةٌ نشطة */
export async function archivedCampaign(actor: MkActor, campaignId: string, deps?: ArchiveDeps) {
  if (!canReadArchive(actor)) return fail("forbidden", { role: "manager" });
  const store = storeOf(deps);
  if (!store) return fail("archive_unavailable");
  let rows: string[][];
  try {
    rows = await campaignRowsInSheet(store, campaignId);
  } catch {
    return fail("archive_unavailable");
  }
  if (rows.length === 0) return fail("not_found");
  const parsed = rows.map((r) => {
    const v = norm(r);
    let details: unknown = null;
    try {
      details = JSON.parse(v[15] || "null");
    } catch {
      details = v[15];
    }
    return {
      key: v[0], type: v[2], name: v[3], start: v[4], end: v[5], platform: v[6], contentType: v[7], item: v[8], status: v[9],
      planned: v[10], actual: v[11], person: v[12], result: v[13], link: v[14], details, archivedAt: v[16],
    };
  });
  return { ok: true as const, rows: parsed, readAt: new Date().toISOString() };
}
