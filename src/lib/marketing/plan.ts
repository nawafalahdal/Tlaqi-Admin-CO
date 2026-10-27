import { createHash } from "node:crypto";
import type { MarketingCampaignStatus, MarketingPlanStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, requireCampaignRole, type MkActor } from "./access";
import { logEvent } from "./audit";
import { abort, fail, guarded, isUniqueViolation, type MkResult } from "./result";
import { campaignPlanGaps, gapKeys } from "./schedule";
import { closePlanningForApproval } from "./planningCycle";

/** خطةُ الحملة وسلسلةُ اعتمادها — يفرضها الخادم، والواجهةُ تعرضها فقط.
 *
 *    تقديمٌ (المنسّق أو قائد التسويق) ← قائدةُ القسم (مراجعةُ الحملة ومحتواها وتصاميمها)
 *    ← مسؤولُ التشغيل (جاهزيتُها وتنظيمُها واكتمالُ متطلباتها) ← ويُسمح عندها ببدء التنفيذ
 *
 *  - **الاعتمادُ النهائيُّ بموافقة الاثنين معاً** — ولا يملك الرئيسُ التنفيذيُّ مرحلةً فيه
 *    (قرارُ المالك، 27/10/2026): يطّلع على الخطة ولا يقرّر فيها، ودورُه التنفيذيُّ لا يتجاوز
 *    السلسلة. وقراراتُه السابقة في المرحلة الثالثة (`executive`) تبقى في السجلّ ولا تُحسب.
 *
 *  - **القرارُ على نسخةٍ بعينها:** التقديمُ صورةٌ من الموجز والمخرجات ببصمة.
 *    أيُّ تعديلٍ بعده يُبطل النسخة (يُختم ولا يُحذف) فيلزم تقديمٌ واعتمادٌ جديدان.
 *  - **الترتيبُ صارم:** لا تعتمد مرحلةٌ قبل أن تعتمد التي قبلها، ولا تُقرَّر مرحلةٌ مرتين.
 *  - **صاحبُ المرحلة من هيكل المنصة** (`planStage` في `access.ts`)، والمؤسسُ لا مرحلةَ له.
 *  - **الردُّ للتعديل** يحمل سبباً مكتوباً، ويُبطل النسخة، ويبقى في السجلّ باسم صاحبه.
 *  - **ولا يقرّر النظامُ عن أحد:** لا مسارَ يُنشئ قراراً إلا يدُ صاحب المرحلة. */

type Tx = Prisma.TransactionClient;

export const PLAN_STAGES: MarketingPlanStage[] = ["department", "operations"];
/** المرحلةُ الأخيرة — اعتمادُها يُتمّ الخطة */
export const FINAL_PLAN_STAGE: MarketingPlanStage = PLAN_STAGES[PLAN_STAGES.length - 1];

/** ما يُعدَّل فيه بعد التقديم يُبطله — وما لا يُعدَّل إلا قبل التنفيذ */
const EDITABLE: MarketingCampaignStatus[] = ["idea", "briefing", "ready_for_planning"];

export function planEditable(c: { status: MarketingCampaignStatus; statusBeforeBlock: MarketingCampaignStatus | null }) {
  return EDITABLE.includes(c.status) || (c.status === "blocked" && !!c.statusBeforeBlock && EDITABLE.includes(c.statusBeforeBlock));
}

/** ما يُعتمد — بصمتان:
 *  - **النطاق** (`fingerprint`): الموجزُ والخطةُ التنفيذية (الهدفُ والنتائجُ والجمهورُ والمؤشراتُ
 *    والقياسُ والمخاطرُ والتاريخان…) وقطعُ المحتوى بنوعها وموضوعها ورسالتها. تغيّرُها في أي
 *    وقتٍ يعني أن الاعتمادَ لم يعد لهذا.
 *  - **التقويم** (`scheduleFingerprint`): مواعيدُ كلِّ قطعةٍ ومسؤولاها. يُبطل النسخةَ قبل التنفيذ؛
 *    وتحته يُعدَّل بسجلٍّ وسببٍ (`schedule.ts`) ولا يُوقف التنفيذ.
 *  والمقاسُ تفصيلُ تنفيذٍ لا نطاق. والصورةُ المحفوظةُ في النسخة تحمل الاثنين معاً — فهي الخطةُ
 *  الرسمية وتقويمُها كما اعتُمدا. */
async function planContent(db: Tx | typeof prisma, campaignId: string) {
  const c = await db.marketingCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      name: true, description: true, objective: true, outcomes: true, audience: true, audienceSegments: true, keyMessage: true,
      channels: true, startDate: true, deadline: true, priority: true, budgetAmount: true, budgetNote: true, kpis: true,
      measurement: true, references: true, risks: true, timezone: true,
      deliverables: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, title: true, platform: true, contentType: true, topic: true, message: true, cta: true, kpi: true,
          writerId: true, designerId: true, contentDueAt: true, designDueAt: true, reviewDueAt: true, publishAt: true, publishBasis: true,
        },
      },
    },
  });
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const scope = {
    name: c.name,
    description: c.description,
    objective: c.objective,
    outcomes: c.outcomes,
    audience: c.audience,
    audienceSegments: c.audienceSegments,
    keyMessage: c.keyMessage,
    channels: [...c.channels].sort(),
    startDate: iso(c.startDate),
    deadline: iso(c.deadline),
    priority: c.priority,
    budgetAmount: c.budgetAmount,
    budgetNote: c.budgetNote,
    kpis: c.kpis ?? null,
    measurement: c.measurement,
    references: c.references,
    risks: c.risks,
    timezone: c.timezone,
    deliverables: c.deliverables.map((d) => ({ id: d.id, title: d.title, platform: d.platform, contentType: d.contentType, topic: d.topic, message: d.message, cta: d.cta, kpi: d.kpi })),
  };
  const schedule = c.deliverables.map((d) => ({
    id: d.id, writerId: d.writerId, designerId: d.designerId, contentDueAt: iso(d.contentDueAt), designDueAt: iso(d.designDueAt),
    reviewDueAt: iso(d.reviewDueAt), publishAt: iso(d.publishAt), publishBasis: d.publishBasis,
  }));
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return { snapshot: { ...scope, schedule }, fingerprint: hash(scope), scheduleFingerprint: hash(schedule) };
}

/** النسخةُ تطابق الحملةَ الآن؟ — النطاقُ دائماً، والتقويمُ ما لم يُطلب تجاهلُه (تحت التنفيذ).
 *  ونسخةٌ قديمةٌ بلا بصمة تقويمٍ لا يُحكم عليها بها. */
function matches(v: { fingerprint: string; scheduleFingerprint: string | null }, now: { fingerprint: string; scheduleFingerprint: string }, withSchedule: boolean) {
  if (v.fingerprint !== now.fingerprint) return false;
  return !withSchedule || v.scheduleFingerprint === null || v.scheduleFingerprint === now.scheduleFingerprint;
}

const versionSelect = {
  id: true,
  number: true,
  fingerprint: true,
  scheduleFingerprint: true,
  invalidatedAt: true,
  decisions: { select: { stage: true, decision: true } },
} as const;

type VersionFacts = { id: string; fingerprint: string; invalidatedAt: Date | null; decisions: { stage: MarketingPlanStage; decision: string }[] };

/** المرحلةُ التالية التي تنتظر قراراً — أو `null` إن اكتملت أو بطلت النسخة */
export function nextStage(v: VersionFacts | null): MarketingPlanStage | null {
  if (!v || v.invalidatedAt) return null;
  for (const s of PLAN_STAGES) {
    const d = v.decisions.find((x) => x.stage === s);
    if (!d) return s;
    if (d.decision !== "approved") return null;
  }
  return null;
}

export function fullyApproved(v: VersionFacts | null): boolean {
  return !!v && !v.invalidatedAt && PLAN_STAGES.every((s) => v.decisions.some((d) => d.stage === s && d.decision === "approved"));
}

/** يُبطل الخطةَ الحاليّة إن لم تعد تطابق الحملة — بعد كل تعديلٍ للموجز أو للنطاق */
export async function invalidatePlanIfChanged(tx: Tx, actor: MkActor, campaignId: string) {
  const c = await tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { currentPlanVersion: { select: versionSelect } } });
  const v = c.currentPlanVersion;
  if (!v || v.invalidatedAt) return false;
  if (matches(v, await planContent(tx, campaignId), true)) return false;
  await tx.marketingPlanVersion.update({ where: { id: v.id }, data: { invalidatedAt: new Date(), invalidatedReason: "plan_changed" } });
  await logEvent(tx, actor, { action: "plan.invalidated", campaignId, details: { version: v.number, reason: "plan_changed" } });
  return true;
}

/** شرطُ بدء التنفيذ: نسخةٌ حاليّةٌ قائمة، تطابق الحملةَ الآن، ومعتمدةٌ من قائدة القسم ومسؤول التشغيل */
export async function assertPlanApproved(tx: Tx, campaignId: string) {
  const c = await tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { currentPlanVersion: { select: versionSelect } } });
  const v = c.currentPlanVersion;
  if (!fullyApproved(v)) abort("plan_not_approved");
  // تحت التنفيذ تتغيّر المواعيدُ بسجلّها (`schedule.ts`) — والنطاقُ وحده شرطُ الاعتماد
  if (!matches(v!, await planContent(tx, campaignId), false)) abort("plan_stale");
}

export async function submitPlan(actor: MkActor, campaignId: string, input: { note?: string } = {}): Promise<MkResult<{ planVersionId: string; number: number }>> {
  return guarded(async () => {
    return prisma.$transaction(async (tx) => {
      const { memberId } = await requireCampaignRole(actor, campaignId, "coordinator", tx);
      const c = await tx.marketingCampaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: { status: true, revision: true, currentPlanVersion: { select: versionSelect } },
      });
      // تُقدَّم الخطةُ بعد اكتمال الموجز (`ready_for_planning` يشترطه) وقبل التنفيذ
      if (c.status !== "ready_for_planning") abort("invalid_state", { from: c.status });
      // لا تُقدَّم خطةٌ ناقصة — المسودةُ تُحفظ ناقصة، والتقديمُ يُرفض بما نقص
      const gaps = await campaignPlanGaps(tx, campaignId);
      if (gaps.length) abort("plan_incomplete", { missing: gapKeys(gaps), count: gaps.length });
      const content = await planContent(tx, campaignId);
      const { snapshot, fingerprint, scheduleFingerprint } = content;
      const current = c.currentPlanVersion;
      if (current && !current.invalidatedAt) {
        // نسخةٌ قائمةٌ تطابق الحملة: لا تقديمَ ثانٍ يمحو مراحلها
        if (matches(current, content, true)) abort("plan_live");
        await tx.marketingPlanVersion.update({ where: { id: current.id }, data: { invalidatedAt: new Date(), invalidatedReason: "plan_changed" } });
      }
      const number = (current?.number ?? 0) + 1;
      const v = await tx.marketingPlanVersion.create({
        data: {
          campaignId,
          number,
          snapshot: snapshot as Prisma.InputJsonValue,
          fingerprint,
          scheduleFingerprint,
          note: input.note?.trim().slice(0, 1000) || null,
          submittedById: memberId,
        },
        select: { id: true },
      });
      // ما سبقها يُختم «سُبقت» إن لم يكن مختوماً — فلا تبقى نسختان قائمتان
      await tx.marketingPlanVersion.updateMany({
        where: { campaignId, id: { not: v.id }, invalidatedAt: null },
        data: { invalidatedAt: new Date(), invalidatedReason: "superseded" },
      });
      const res = await tx.marketingCampaign.updateMany({
        where: { id: campaignId, revision: c.revision },
        data: { currentPlanVersionId: v.id, revision: { increment: 1 } },
      });
      if (res.count === 0) abort("stale");
      await logEvent(tx, actor, { action: "plan.submitted", campaignId, details: { version: number } });
      return { ok: true as const, planVersionId: v.id, number };
    });
  }).catch((e) => {
    if (isUniqueViolation(e)) return fail("stale");
    throw e;
  });
}

export async function decidePlan(
  actor: MkActor,
  campaignId: string,
  input: { planVersionId: string; stage: string; decision: "approved" | "changes_requested"; note?: string }
): Promise<MkResult> {
  return guarded(async () => {
    if (actor.isFounder) return fail("founder_excluded");
    const stage = PLAN_STAGES.find((s) => s === input.stage);
    if (!stage) return fail("invalid_input", { field: "stage" });
    // صاحبُ المرحلة وحده — والمرحلةُ من دوره في المنصة الآن، لا مما يُرسله النموذج
    if (actor.planStage !== stage) return fail("forbidden", { role: `plan_${stage}` });
    const note = input.note?.trim().slice(0, 1000) || null;
    if (input.decision === "changes_requested" && !note) return fail("invalid_input", { field: "note" });

    return prisma.$transaction(async (tx) => {
      const access = await campaignAccess(actor, campaignId, tx);
      if (!access.canViewPlan) abort("not_found");
      const c = await tx.marketingCampaign.findUnique({
        where: { id: campaignId },
        select: { status: true, currentPlanVersion: { select: versionSelect } },
      });
      if (!c) abort("not_found");
      if (c.status !== "ready_for_planning") abort("invalid_state", { from: c.status });
      const v = c.currentPlanVersion;
      if (!v || v.id !== input.planVersionId) abort("version_not_current");
      if (v.invalidatedAt) abort("plan_stale");
      if (!matches(v, await planContent(tx, campaignId), true)) abort("plan_stale");
      // الترتيب: هذه المرحلةُ هي التالية بعينها — لا قبلها ولا بعدها، ولا تُقرَّر مرتين
      if (nextStage(v) !== stage) abort("invalid_state", { from: `plan_${nextStage(v) ?? "done"}` });

      try {
        await tx.marketingPlanDecision.create({
          data: {
            planVersionId: v.id,
            stage,
            decision: input.decision,
            note,
            deciderId: actor.principalId,
            deciderName: actor.name,
            deciderRole: actor.orgRole ?? "—",
          },
        });
      } catch (e) {
        // قراران متزامنان للمرحلة نفسها: الأولُ يغلب
        if (isUniqueViolation(e)) abort("stale");
        throw e;
      }
      if (input.decision === "changes_requested") {
        await tx.marketingPlanVersion.update({ where: { id: v.id }, data: { invalidatedAt: new Date(), invalidatedReason: "returned_for_revision" } });
      }
      // الاعتمادُ الأخير يُغلق شاتَ التخطيط حتى قبل نهاية الحملة بسبعة أيام (`planningCycle.ts`)
      if (input.decision === "approved" && stage === FINAL_PLAN_STAGE) await closePlanningForApproval(tx, actor, campaignId);
      await logEvent(tx, actor, {
        action: input.decision === "approved" ? "plan.approved" : "plan.changes_requested",
        campaignId,
        details: { version: v.number, stage, ...(note ? { note } : {}) },
      });
      return { ok: true as const };
    });
  });
}

// ─── القراءة ─────────────────────────────────────────────────────────

/** خطةُ الحملة للعرض: النسخُ وقراراتُها، والحاليّةُ وحالتها — لمن يرى الحملة */
export async function campaignPlan(actor: MkActor, campaignId: string) {
  const access = await campaignAccess(actor, campaignId);
  if (!access.canViewPlan) return null;
  const [versions, content] = await Promise.all([
    prisma.marketingPlanVersion.findMany({
      where: { campaignId },
      orderBy: { number: "desc" },
      take: 20,
      include: {
        decisions: { orderBy: { createdAt: "asc" } },
        submittedBy: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } },
      },
    }),
    planContent(prisma, campaignId),
  ]);
  const c = await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { currentPlanVersionId: true, status: true, statusBeforeBlock: true } });
  const current = versions.find((v) => v.id === c.currentPlanVersionId) ?? null;
  const stale = !!current && !current.invalidatedAt && !matches(current, content, planEditable(c));
  const gaps = planEditable(c) ? await campaignPlanGaps(prisma, campaignId) : [];
  return {
    versions,
    current,
    stale,
    approved: !stale && fullyApproved(current),
    next: stale ? null : nextStage(current),
    canSubmit: access.roles.has("coordinator"),
    gaps,
  };
}

/** خططٌ تنتظر قرارَ صاحبها في مرحلته — للوحة */
export async function plansAwaiting(actor: MkActor) {
  if (!actor.planStage || actor.isFounder) return [];
  const rows = await prisma.marketingCampaign.findMany({
    where: { status: "ready_for_planning", currentPlanVersion: { invalidatedAt: null } },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: { id: true, name: true, deadline: true, currentPlanVersion: { select: { ...versionSelect, createdAt: true } } },
  });
  return rows.filter((r) => nextStage(r.currentPlanVersion) === actor.planStage);
}
