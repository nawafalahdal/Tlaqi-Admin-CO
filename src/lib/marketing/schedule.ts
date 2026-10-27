import { Prisma, type MarketingDeliverableStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RIYADH_TZ, toRiyadh } from "@/lib/riyadh";
import { campaignAccess, requireCampaignRole, type MkActor } from "./access";
import { logEvent } from "./audit";
import { invalidatePlanIfChanged, planEditable } from "./plan";
import { abort, fail, guarded, type MkResult } from "./result";
import { syncStageTasks } from "./deliverables";

/** الخطةُ التنفيذية وتقويمُ النشر — ما يكتمل به التخطيط، وما يُرصد في التنفيذ.
 *
 *  - **مواعيدُ بتاريخٍ ووقتٍ بعينهما:** كلُّ قطعةٍ لها موعدُ نصٍّ وتصميمٍ ومراجعةٍ
 *    ونشر، تُخزَّن UTC وتُعرض بتوقيت المنصة (`Asia/Riyadh` — `riyadh.ts`). و«الأسبوع
 *    القادم» أو «مساءً» ليست مواعيد: النموذجُ لا يقبل إلا تاريخاً وساعةً ودقيقة.
 *  - **الاكتمالُ يُفحص في الخادم** عند تقديم الخطة (`planMissing`): المسودةُ تُحفظ
 *    ناقصة، والتقديمُ يُرفض بقائمة ما نقص — ولا يتجاوزه شاتٌ ولا نموذجٌ مصطنع.
 *  - **وبعد الاعتماد لا تتغيّر المواعيدُ بصمت:** قائدُ التسويق وحده يعدّلها، بسببٍ
 *    مكتوب، ويُحفظ لكل حقلٍ قيمتُه الأصلية والجديدة ومن عدّل ومن وافق
 *    (`MarketingScheduleChange`). والموضوعُ والرسالةُ ونوعُ المحتوى نطاقٌ لا موعد:
 *    لا تُعدَّل تحت التنفيذ إلا بإعادة الحملة إلى التخطيط واعتمادها من جديد. */

type Tx = Prisma.TransactionClient;

export const PLATFORM_TZ = RIYADH_TZ;

export const CONTENT_TYPES = ["post", "carousel", "story", "reel", "video", "article", "thread", "announcement"] as const;
export const PUBLISH_BASES = ["history", "estimate", "manual"] as const;

/** حقولُ القطعة التي هي مواعيدُ ومسؤوليات — تُعدَّل بعد الاعتماد بسجلّ */
export const SCHEDULE_FIELDS = ["writerId", "designerId", "contentDueAt", "designDueAt", "reviewDueAt", "publishAt"] as const;
type ScheduleField = (typeof SCHEDULE_FIELDS)[number];

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const opt = (s: unknown, max: number) => clip(s, max) || null;

function parseAt(v: unknown, field: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) abort("invalid_input", { field });
  return d;
}

// ─── الاكتمال ────────────────────────────────────────────────────────

export type Kpi = { name: string; target: string; unit: string | null; source: string };

/** مؤشراتٌ مكتملة: اسمٌ وهدفٌ ومصدر — وما سواها لا يُعدّ مؤشراً */
export function completeKpis(raw: unknown): Kpi[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((k): k is Record<string, unknown> => !!k && typeof k === "object")
    .map((k) => ({ name: clip(k.name, 120), target: clip(k.target, 60), unit: opt(k.unit, 30), source: clip(k.source, 200) }))
    .filter((k) => k.name && k.target && k.source);
}

type PlanCampaign = {
  name: string;
  description: string | null;
  objective: string | null;
  outcomes: string | null;
  audience: string | null;
  keyMessage: string | null;
  channels: string[];
  startDate: Date | null;
  deadline: Date | null;
  kpis: unknown;
  measurement: string | null;
  risks: string | null;
};
type PlanPiece = {
  title: string;
  contentType: string | null;
  topic: string | null;
  message: string | null;
  writerId: string | null;
  designerId: string | null;
  contentDueAt: Date | null;
  designDueAt: Date | null;
  reviewDueAt: Date | null;
  publishAt: Date | null;
};

export type PlanGap = { scope: "campaign" | "piece"; piece?: string; field: string };

/** ما ينقص الخطةَ لتُقدَّم للاعتماد — فارغةٌ = مكتملة.
 *  والميزانيةُ والشرائحُ والمراجعُ اختيارية: لا تُفرض، ولا تُخمَّن إن غابت. */
export function planMissing(c: PlanCampaign, pieces: PlanPiece[], team: { writers: Set<string>; designers: Set<string> }): PlanGap[] {
  const gaps: PlanGap[] = [];
  const need = (ok: unknown, field: string) => {
    if (!ok) gaps.push({ scope: "campaign", field });
  };
  need(c.description, "description");
  need(c.objective, "objective");
  need(c.outcomes, "outcomes");
  need(c.audience, "audience");
  need(c.keyMessage, "keyMessage");
  need(c.channels.length > 0, "channels");
  need(c.startDate, "startDate");
  need(c.deadline, "deadline");
  need(completeKpis(c.kpis).length > 0, "kpis");
  need(c.measurement, "measurement");
  need(c.risks, "risks");
  if (c.startDate && c.deadline && c.startDate.getTime() >= c.deadline.getTime()) gaps.push({ scope: "campaign", field: "dateOrder" });
  if (pieces.length === 0) gaps.push({ scope: "campaign", field: "deliverables" });
  for (const p of pieces) {
    const pg = (ok: unknown, field: string) => {
      if (!ok) gaps.push({ scope: "piece", piece: p.title, field });
    };
    pg(p.contentType, "contentType");
    pg(p.topic, "topic");
    pg(p.message, "message");
    pg(p.writerId && team.writers.has(p.writerId), "writerId");
    pg(p.designerId && team.designers.has(p.designerId), "designerId");
    pg(p.contentDueAt, "contentDueAt");
    pg(p.designDueAt, "designDueAt");
    pg(p.reviewDueAt, "reviewDueAt");
    pg(p.publishAt, "publishAt");
    const order = [p.contentDueAt, p.designDueAt, p.reviewDueAt, p.publishAt];
    if (order.every(Boolean) && order.some((d, i) => i > 0 && d!.getTime() < order[i - 1]!.getTime())) pg(false, "scheduleOrder");
    if (p.publishAt && c.startDate && c.deadline && (p.publishAt < c.startDate || p.publishAt > c.deadline)) pg(false, "publishOutside");
  }
  return gaps;
}

/** يقرأ الحملةَ وقطعها وفريقها ويحسب ما ينقص — داخل معاملةٍ أو خارجها */
export async function campaignPlanGaps(db: Tx | typeof prisma, campaignId: string): Promise<PlanGap[]> {
  const c = await db.marketingCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      name: true, description: true, objective: true, outcomes: true, audience: true, keyMessage: true, channels: true,
      startDate: true, deadline: true, kpis: true, measurement: true, risks: true,
      members: { select: { role: true, memberId: true, member: { select: { active: true, capabilities: true } } } },
      deliverables: {
        orderBy: { createdAt: "asc" },
        select: { title: true, contentType: true, topic: true, message: true, writerId: true, designerId: true, contentDueAt: true, designDueAt: true, reviewDueAt: true, publishAt: true },
      },
    },
  });
  const live = (role: "writer" | "designer") =>
    new Set(c.members.filter((m) => m.role === role && m.member.active && m.member.capabilities.includes(role)).map((m) => m.memberId));
  return planMissing(c, c.deliverables, { writers: live("writer"), designers: live("designer") });
}

/** للرسائل: «حقل» أو «قطعة/حقل» — مفصولةٌ بفواصل، ويُقصّ الطويل */
export const gapKeys = (gaps: PlanGap[]) =>
  gaps
    .slice(0, 12)
    .map((g) => (g.scope === "piece" ? `piece.${g.field}` : g.field))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(",");

// ─── تقويمُ النشر ────────────────────────────────────────────────────

export type CalendarIssue =
  | "overdue_content"
  | "overdue_design"
  | "overdue_review"
  | "overdue_publish"
  | "schedule_order"
  | "publish_outside"
  | "unassigned";

const BEFORE_CONTENT_DONE: MarketingDeliverableStatus[] = ["draft", "content_review"];
const BEFORE_DESIGN_DONE: MarketingDeliverableStatus[] = [...BEFORE_CONTENT_DONE, "content_approved", "design_review"];
const BEFORE_REVIEW_DONE: MarketingDeliverableStatus[] = [...BEFORE_DESIGN_DONE, "design_approved", "quality_review"];

/** ما يُرصد على القطعة الآن: تأخّرٌ في مرحلةٍ لم تُنجز، أو مواعيدُ متعارضة، أو مسؤولٌ غائب */
export function pieceIssues(
  p: PlanPiece & { status: MarketingDeliverableStatus; revisionTarget?: string | null },
  campaign: { startDate: Date | null; deadline: Date | null },
  now: Date
): CalendarIssue[] {
  const out: CalendarIssue[] = [];
  const late = (at: Date | null) => !!at && at.getTime() < now.getTime();
  const reworkingContent = p.status === "revision_required" && p.revisionTarget === "content";
  const reworkingDesign = p.status === "revision_required" && p.revisionTarget === "design";
  if (late(p.contentDueAt) && (BEFORE_CONTENT_DONE.includes(p.status) || reworkingContent)) out.push("overdue_content");
  if (late(p.designDueAt) && (BEFORE_DESIGN_DONE.includes(p.status) || reworkingContent || reworkingDesign)) out.push("overdue_design");
  if (late(p.reviewDueAt) && (BEFORE_REVIEW_DONE.includes(p.status) || p.status === "revision_required")) out.push("overdue_review");
  if (late(p.publishAt) && p.status !== "published") out.push("overdue_publish");
  const order = [p.contentDueAt, p.designDueAt, p.reviewDueAt, p.publishAt];
  if (order.every(Boolean) && order.some((d, i) => i > 0 && d!.getTime() < order[i - 1]!.getTime())) out.push("schedule_order");
  if (p.publishAt && campaign.startDate && campaign.deadline && (p.publishAt < campaign.startDate || p.publishAt > campaign.deadline)) out.push("publish_outside");
  if (!p.writerId || !p.designerId) out.push("unassigned");
  return out;
}

const personSelect = { id: true, user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } as const;

/** تقويمُ الحملة: كلُّ قطعةٍ بمواعيدها ومسؤوليها وحالتها وما يُرصد عليها، مرتّبةً بموعد النشر،
 *  وسجلُّ تعديل المواعيد بعد الاعتماد. لمن يرى الحملة، أو لمعتمِد خطتها (اطّلاعاً). */
export async function campaignCalendar(actor: MkActor, campaignId: string, now = new Date()) {
  const access = await campaignAccess(actor, campaignId);
  if (!access.canView && !access.canViewPlan) return null;
  const c = await prisma.marketingCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true, status: true, statusBeforeBlock: true, startDate: true, deadline: true, timezone: true,
      deliverables: {
        orderBy: [{ publishAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        select: {
          id: true, title: true, platform: true, status: true, revisionTarget: true, contentType: true, topic: true, message: true, cta: true, kpi: true,
          writerId: true, designerId: true, contentDueAt: true, designDueAt: true, reviewDueAt: true, publishAt: true, publishBasis: true, publishBasisNote: true,
          writer: { select: personSelect }, designer: { select: personSelect },
        },
      },
      scheduleChanges: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!c) return null;
  const rows = c.deliverables.map((d) => ({ ...d, issues: pieceIssues(d, c, now) }));
  return {
    campaign: { id: c.id, status: c.status, startDate: c.startDate, deadline: c.deadline, timezone: c.timezone },
    rows,
    changes: c.scheduleChanges,
    editable: access.roles.has("coordinator") && planEditable(c),
    /** تعديلٌ بسجلٍّ وسبب: قائدُ التسويق وحده، والحملةُ قيد التنفيذ */
    amendable: actor.isMarketingLead && (c.status === "in_progress" || (c.status === "blocked" && c.statusBeforeBlock === "in_progress")),
  };
}

// ─── توصيةُ وقت النشر ────────────────────────────────────────────────

/** أوقاتٌ أوّليةٌ عامّة بتوقيت الرياض — **تقديريةٌ لا تستند إلى بيانات المنصة**، وتُعرض كذلك */
const ESTIMATE_HOUR: Record<string, number> = {
  instagram: 20, tiktok: 21, snapchat: 19, x: 12, linkedin: 10, facebook: 19, youtube: 18, website: 10,
};
const MIN_SAMPLES = 3;

/** ساعةُ نشرٍ مقترحة لمنصة: من نتائج منشوراتٍ سابقةٍ عليها إن كفت (٣ فأكثر بأرقام تفاعل)، وإلا
 *  تقديرٌ عامٌّ موسومٌ بأنه تقدير. ولا يُدّعى «أفضل وقت» بلا دليل: الأساسُ يُعاد مع التوصية. */
export async function recommendPublishHour(platform: string, db: Tx | typeof prisma = prisma) {
  const pubs = await db.marketingPublication.findMany({
    where: { platform, metrics: { not: Prisma.DbNull } },
    orderBy: { publishedAt: "desc" },
    take: 200,
    select: { publishedAt: true, metrics: true },
  });
  const byHour = new Map<number, { total: number; n: number }>();
  for (const p of pubs) {
    const m = p.metrics as Record<string, unknown> | null;
    const engagements = Number(m?.engagements ?? m?.clicks ?? NaN);
    if (!Number.isFinite(engagements)) continue;
    const h = toRiyadh(p.publishedAt).getUTCHours();
    const cur = byHour.get(h) ?? { total: 0, n: 0 };
    byHour.set(h, { total: cur.total + engagements, n: cur.n + 1 });
  }
  const samples = [...byHour.values()].reduce((s, v) => s + v.n, 0);
  if (samples >= MIN_SAMPLES) {
    const [hour, v] = [...byHour.entries()].sort((a, b) => b[1].total / b[1].n - a[1].total / a[1].n)[0];
    return { hour, basis: "history" as const, samples, average: Math.round(v.total / v.n) };
  }
  return { hour: ESTIMATE_HOUR[platform] ?? 19, basis: "estimate" as const, samples, average: null };
}

// ─── تعديلُ مواعيد القطعة ────────────────────────────────────────────

export type PieceScheduleInput = {
  contentType?: string;
  topic?: string;
  message?: string;
  cta?: string;
  kpi?: string;
  writerId?: string | null;
  designerId?: string | null;
  contentDueAt?: string | Date | null;
  designDueAt?: string | Date | null;
  reviewDueAt?: string | Date | null;
  publishAt?: string | Date | null;
  publishBasis?: string;
  publishBasisNote?: string;
  /** إلزاميٌّ لتعديلٍ تحت التنفيذ */
  reason?: string;
};

const SCOPE_FIELDS = ["contentType", "topic", "message", "cta", "kpi"] as const;

/** يحفظ مواعيدَ القطعة ومسؤوليها.
 *  - **قبل التنفيذ** (التخطيط): المنسّقُ يعدّل بحرّية، وأيُّ تغييرٍ يُبطل الخطةَ المقدَّمة.
 *  - **تحت التنفيذ:** قائدُ التسويق وحده، والمواعيدُ والمسؤولون وحدهم، بسببٍ مكتوب — ويُسجَّل
 *    كلُّ حقلٍ بأصله وجديده، وتتبعه مهامُّ القطعة (موعداً ومُسنَداً). والنطاقُ لا يُمسّ. */
export async function updatePieceSchedule(actor: MkActor, deliverableId: string, input: PieceScheduleInput): Promise<MkResult<{ changes: number }>> {
  return guarded(async () => {
    const d0 = await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { campaignId: true } });
    if (!d0) return fail("not_found");
    await requireCampaignRole(actor, d0.campaignId, "coordinator");
    return prisma.$transaction(async (tx) => {
      const d = await tx.marketingDeliverable.findUniqueOrThrow({
        where: { id: deliverableId },
        include: { campaign: { select: { id: true, status: true, statusBeforeBlock: true, members: { select: { role: true, memberId: true, member: { select: { active: true, capabilities: true } } } } } } },
      });
      if (d.status === "published") abort("invalid_state", { from: d.status });
      const c = d.campaign;
      const roleMember = (role: "writer" | "designer", id: string | null | undefined) => {
        if (!id) return null;
        const ok = c.members.some((m) => m.role === role && m.memberId === id && m.member.active && m.member.capabilities.includes(role));
        if (!ok) abort("invalid_input", { field: role === "writer" ? "writer" : "designer" });
        return id;
      };
      const next: Record<ScheduleField, string | Date | null> = {
        writerId: input.writerId === undefined ? d.writerId : roleMember("writer", input.writerId),
        designerId: input.designerId === undefined ? d.designerId : roleMember("designer", input.designerId),
        contentDueAt: input.contentDueAt === undefined ? d.contentDueAt : parseAt(input.contentDueAt, "contentDueAt"),
        designDueAt: input.designDueAt === undefined ? d.designDueAt : parseAt(input.designDueAt, "designDueAt"),
        reviewDueAt: input.reviewDueAt === undefined ? d.reviewDueAt : parseAt(input.reviewDueAt, "reviewDueAt"),
        publishAt: input.publishAt === undefined ? d.publishAt : parseAt(input.publishAt, "publishAt"),
      };
      const basis = (PUBLISH_BASES as readonly string[]).includes(String(input.publishBasis)) ? input.publishBasis! : input.publishBasis === undefined ? d.publishBasis : null;
      const contentType = input.contentType === undefined ? d.contentType : (CONTENT_TYPES as readonly string[]).includes(String(input.contentType)) ? input.contentType! : null;
      const scope = {
        contentType,
        topic: input.topic === undefined ? d.topic : opt(input.topic, 300),
        message: input.message === undefined ? d.message : opt(input.message, 1000),
        cta: input.cta === undefined ? d.cta : opt(input.cta, 200),
        kpi: input.kpi === undefined ? d.kpi : opt(input.kpi, 300),
      };
      const same = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime() : a === b);
      const changed = SCHEDULE_FIELDS.filter((f) => !same(d[f], next[f]));
      const scopeChanged = SCOPE_FIELDS.filter((f) => !same(d[f], scope[f]));

      if (planEditable(c)) {
        await tx.marketingDeliverable.update({
          where: { id: d.id },
          data: { ...scope, ...(next as Record<string, Date | string | null>), publishBasis: basis, publishBasisNote: input.publishBasisNote === undefined ? d.publishBasisNote : opt(input.publishBasisNote, 300), revision: { increment: 1 } },
        });
        if (changed.length || scopeChanged.length) {
          await logEvent(tx, actor, { action: "schedule.updated", campaignId: c.id, deliverableId: d.id, details: { fields: [...scopeChanged, ...changed].join(",") } });
          await invalidatePlanIfChanged(tx, actor, c.id);
        }
        return { ok: true as const, changes: changed.length + scopeChanged.length };
      }

      const executing = c.status === "in_progress" || (c.status === "blocked" && c.statusBeforeBlock === "in_progress");
      if (!executing) abort("campaign_closed", { status: c.status });
      // النطاقُ المعتمد لا يتغيّر تحت التنفيذ — يُعاد إلى التخطيط ويُعتمد من جديد
      if (scopeChanged.length) abort("plan_locked");
      if (!actor.isMarketingLead) abort("forbidden", { role: "manager" });
      const reason = clip(input.reason, 500);
      if (reason.length < 5) abort("invalid_input", { field: "reason" });
      if (changed.length === 0) return { ok: true as const, changes: 0 };

      const str = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
      for (const f of changed) {
        await tx.marketingScheduleChange.create({
          data: { campaignId: c.id, deliverableId: d.id, field: f, fromValue: str(d[f]), toValue: str(next[f]), reason, changedById: actor.principalId, changedByName: actor.name, approvedByName: actor.name },
        });
      }
      await tx.marketingDeliverable.update({ where: { id: d.id }, data: { ...(next as Record<string, Date | string | null>), publishBasis: basis, revision: { increment: 1 } } });
      // مهامُّ القطعة تتبع مواعيدها ومسؤوليها — فلا يبقى تقويمٌ ومهامُّ متناقضان
      const follow: [string, { dueAt?: Date | null; assigneeId?: string | null }][] = [
        ["content", { dueAt: next.contentDueAt as Date | null, assigneeId: next.writerId as string | null }],
        ["design", { dueAt: next.designDueAt as Date | null, assigneeId: next.designerId as string | null }],
        ["quality", { dueAt: next.reviewDueAt as Date | null }],
        ["publishing", { dueAt: next.publishAt as Date | null }],
      ];
      for (const [kind, data] of follow) {
        await tx.marketingTask.updateMany({ where: { deliverableId: d.id, kind: kind as "content", status: { in: ["todo", "in_progress", "blocked"] } }, data });
      }
      // فحصُ الناشر الأخير شمل «صحةَ المنصة وموعد النشر» — موعدٌ جديدٌ يستلزم فحصاً جديداً
      if (changed.includes("publishAt")) {
        await tx.marketingFinalCheck.updateMany({ where: { deliverableId: d.id, invalidatedAt: null }, data: { invalidatedAt: new Date(), invalidatedReason: "schedule_changed" } });
      }
      await logEvent(tx, actor, { action: "schedule.changed", campaignId: c.id, deliverableId: d.id, details: { fields: changed.join(","), reason } });
      return { ok: true as const, changes: changed.length };
    });
  });
}

/** تاريخا الحملة تحت التنفيذ — قائدُ التسويق وحده بسببٍ مكتوب، ويُسجَّلان، ويتبعهما موعدُ إعادة
 *  فتح التخطيط (`planningCycle.ts`). وقبل التنفيذ يُعدَّلان مع الموجز ويُبطلان الخطة. */
export async function amendCampaignDates(
  actor: MkActor,
  campaignId: string,
  input: { startDate?: string | Date | null; deadline?: string | Date | null; reason?: string }
): Promise<MkResult> {
  return guarded(async () => {
    await requireCampaignRole(actor, campaignId, "coordinator");
    if (!actor.isMarketingLead) return fail("forbidden", { role: "manager" });
    const reason = clip(input.reason, 500);
    if (reason.length < 5) return fail("invalid_input", { field: "reason" });
    const { syncCycleDates } = await import("./planningCycle");
    return prisma.$transaction(async (tx) => {
      const c = await tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { status: true, statusBeforeBlock: true, startDate: true, deadline: true, timezone: true } });
      const executing = c.status === "in_progress" || (c.status === "blocked" && c.statusBeforeBlock === "in_progress");
      if (!executing) abort("invalid_state", { from: c.status });
      const startDate = input.startDate === undefined ? c.startDate : parseAt(input.startDate, "startDate");
      const deadline = input.deadline === undefined ? c.deadline : parseAt(input.deadline, "deadline");
      if (!deadline) abort("invalid_input", { field: "deadline" });
      if (startDate && startDate.getTime() >= deadline.getTime()) abort("invalid_input", { field: "deadline" });
      const changes: [string, Date | null, Date | null][] = [];
      if (startDate?.getTime() !== c.startDate?.getTime()) changes.push(["startDate", c.startDate, startDate]);
      if (deadline.getTime() !== c.deadline?.getTime()) changes.push(["deadline", c.deadline, deadline]);
      if (changes.length === 0) return { ok: true as const };
      for (const [field, from, to] of changes) {
        await tx.marketingScheduleChange.create({
          data: { campaignId, field, fromValue: from?.toISOString() ?? null, toValue: to?.toISOString() ?? null, reason, changedById: actor.principalId, changedByName: actor.name, approvedByName: actor.name },
        });
      }
      await tx.marketingCampaign.update({ where: { id: campaignId }, data: { startDate, deadline, revision: { increment: 1 } } });
      await syncCycleDates(tx, campaignId, { startDate, endDate: deadline });
      await logEvent(tx, actor, { action: "schedule.changed", campaignId, details: { fields: changes.map((x) => x[0]).join(","), reason } });
      return { ok: true as const };
    });
  });
}

// ─── مهامُّ التنفيذ من الخطة المعتمدة ─────────────────────────────────

/** عند بدء التنفيذ: لكل قطعةٍ أربعُ مهامّ (نصٌّ ← تصميمٌ ← مراجعةٌ ← نشر) بمواعيدها ومسؤوليها من
 *  التقويم المعتمد، مربوطةً بنسخة الخطة، وكلٌّ ينتظر ما قبله. لا تُنشأ مرّتين للنسخة نفسها. */
export async function createExecutionTasks(tx: Tx, actor: MkActor, campaignId: string, planVersionId: string, creatorId: string) {
  const c = await tx.marketingCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      members: { select: { role: true, memberId: true, member: { select: { active: true, capabilities: true } } }, orderBy: { addedAt: "asc" } },
      deliverables: { select: { id: true, title: true, writerId: true, designerId: true, contentDueAt: true, designDueAt: true, reviewDueAt: true, publishAt: true } },
    },
  });
  const first = (role: "reviewer" | "publisher") =>
    c.members.find((m) => m.role === role && m.member.active && m.member.capabilities.includes(role))?.memberId ?? null;
  const reviewer = first("reviewer");
  const publisher = first("publisher");
  let created = 0;
  for (const d of c.deliverables) {
    const exists = await tx.marketingTask.count({ where: { deliverableId: d.id, planVersionId } });
    if (exists) continue;
    const steps = [
      { kind: "content" as const, assigneeId: d.writerId, dueAt: d.contentDueAt },
      { kind: "design" as const, assigneeId: d.designerId, dueAt: d.designDueAt },
      { kind: "quality" as const, assigneeId: reviewer, dueAt: d.reviewDueAt },
      { kind: "publishing" as const, assigneeId: publisher, dueAt: d.publishAt },
    ];
    let previous: string | null = null;
    for (const st of steps) {
      const t: { id: string } = await tx.marketingTask.create({
        data: {
          campaignId, deliverableId: d.id, kind: st.kind, title: `${d.title} — ${st.kind}`, assigneeId: st.assigneeId, dueAt: st.dueAt,
          createdById: creatorId, planVersionId, ...(previous ? { dependsOn: { create: [{ dependsOnId: previous }] } } : {}),
        },
        select: { id: true },
      });
      previous = t.id;
      created++;
    }
  }
  if (created) {
    // قطعةٌ تجاوزت مرحلةً قبل التوليد (نصٌّ معتمدٌ من دورةٍ سابقة) تُنجَز مهمّتُها فوراً
    for (const d of c.deliverables) await syncStageTasks(tx, d.id);
    await logEvent(tx, actor, { action: "tasks.generated", campaignId, details: { count: created } });
  }
  return created;
}
