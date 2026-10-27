import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromRiyadhParts, toRiyadh } from "@/lib/riyadh";
import { logEvent, logSystemEvent } from "./audit";
import type { MkActor } from "./access";
import { fail, guarded, type MkResult } from "./result";

/** دورةُ التخطيط — متى يُغلَق شاتُ التخطيط ومتى يُعاد فتحُه.
 *
 *  - **يُغلَق باعتماد الخطة اعتمادَها الأخير** (الرئيس التنفيذي): يتفرّغ قائدُ التسويق
 *    لقيادة القسم ومتابعة التنفيذ. لا تُحذف المحادثة؛ تُقرأ ولا يُكتب فيها.
 *  - **ويُعاد فتحُه قبل نهاية الحملة بسبعة أيامٍ تقويمية كاملة:** منتصفَ ليل ذلك اليوم
 *    بتوقيت الرياض. نهايةُ ٣٠ ديسمبر ← فتحٌ في ٢٣ ديسمبر ٠٠:٠٠ (٢٢ ديسمبر ٢١:٠٠ UTC).
 *  - **لا يحتاج أحداً يفتح الصفحة:** الكنسُ اليوميُّ المجدول (`/api/cron/sweep`) يفتح ما حان،
 *    وكلُّ قراءةٍ للحالة تفتحه كذلك إن حان — فلا يتأخّر فتحٌ ينتظر الكنس، ولا يُفتح مبكراً.
 *  - **الحملةُ الأخيرةُ اعتماداً تحكم:** اعتمادُ حملةٍ جديدة يُنهي دورةَ ما قبلها.
 *  - **ويُفتح مبكراً** بيد قائد التسويق وحده، بسببٍ مكتوبٍ يُسجَّل.
 *  - **وإعادةُ الفتح لا تمسّ التنفيذ:** الحملةُ الجارية ومهامُّها كما هي، والخطةُ الجديدة لا
 *    تصير تنفيذاً إلا باعتمادها. */

type Tx = Prisma.TransactionClient;

/** منتصفُ ليل اليوم السابع قبل نهاية الحملة — بتقويم الرياض لا بإزاحة الخادم */
export function reopenAtFor(endDate: Date): Date {
  const r = toRiyadh(endDate);
  return fromRiyadhParts(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate() - 7);
}

/** يُغلَق التخطيطُ لحملةٍ اعتُمدت خطتُها — في معاملة القرار الأخير نفسها */
export async function closePlanningForApproval(tx: Tx, actor: MkActor, campaignId: string, now = new Date()) {
  const c = await tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId }, select: { name: true, startDate: true, deadline: true, timezone: true } });
  if (!c.deadline) return null; // الخطةُ لا تُقدَّم بلا تاريخ نهاية (`planMissing`)، فهذا لا يقع
  const reopenAt = reopenAtFor(c.deadline);
  // ما قبلها من دوراتٍ مغلقة تنتهي: الحملةُ الأخيرة اعتماداً هي التي تحكم
  await tx.marketingPlanningCycle.updateMany({
    where: { reopenedAt: null, campaignId: { not: campaignId } },
    data: { reopenedAt: now, reopenedBy: "system", reopenReason: "superseded" },
  });
  const reopened = reopenAt.getTime() <= now.getTime();
  const cycle = await tx.marketingPlanningCycle.upsert({
    where: { campaignId },
    create: {
      campaignId, campaignName: c.name, startDate: c.startDate, endDate: c.deadline, timezone: c.timezone, approvedAt: now, reopenAt,
      ...(reopened ? { reopenedAt: now, reopenedBy: "system", reopenReason: "scheduled" } : {}),
    },
    update: {
      campaignName: c.name, startDate: c.startDate, endDate: c.deadline, approvedAt: now, reopenAt,
      reopenedAt: reopened ? now : null, reopenedBy: reopened ? "system" : null, reopenReason: reopened ? "scheduled" : null,
    },
  });
  await logEvent(tx, actor, { action: "planning.closed", campaignId, details: { reopenAt: reopenAt.toISOString() } });
  return cycle;
}

/** تغيّر تاريخُ نهاية حملةٍ مغلَقٍ تخطيطُها: يتبعه موعدُ الفتح (ما لم يكن قد فُتح) */
export async function syncCycleDates(tx: Tx, campaignId: string, dates: { startDate: Date | null; endDate: Date }, now = new Date()) {
  const cycle = await tx.marketingPlanningCycle.findUnique({ where: { campaignId } });
  if (!cycle || cycle.reopenedAt) return;
  const reopenAt = reopenAtFor(dates.endDate);
  const due = reopenAt.getTime() <= now.getTime();
  await tx.marketingPlanningCycle.update({
    where: { campaignId },
    data: { startDate: dates.startDate, endDate: dates.endDate, reopenAt, ...(due ? { reopenedAt: now, reopenedBy: "system", reopenReason: "scheduled" } : {}) },
  });
}

/** يفتح ما حان موعدُه — مرّةً واحدة: الشرطُ `reopenedAt: null` في الكتابة نفسها، فلا يفتحه
 *  كنسان متزامنان مرّتين، ولا يُكتب فوق فتحٍ مبكر. ووقتُ الفتح المسجَّل موعدُه المقرَّر لا وقتُ مرور
 *  الكنس — فقد كان مفتوحاً منذئذٍ في القراءة (`planningDesk`). يُستدعى من الكنس المجدول. */
export async function reopenDuePlanning(now = new Date(), db: typeof prisma = prisma): Promise<number> {
  const due = await db.marketingPlanningCycle.findMany({ where: { reopenedAt: null, reopenAt: { lte: now } }, select: { id: true, campaignId: true, reopenAt: true } });
  let n = 0;
  for (const c of due) {
    const res = await db.marketingPlanningCycle.updateMany({
      where: { id: c.id, reopenedAt: null },
      data: { reopenedAt: c.reopenAt, reopenedBy: "system", reopenReason: "scheduled" },
    });
    if (res.count === 0) continue;
    n++;
    // الحملةُ قد تكون أُرشفت وحُذفت — والسجلُّ يبقى في الدورة نفسها
    const exists = await db.marketingCampaign.count({ where: { id: c.campaignId } });
    await logSystemEvent(db, { action: "planning.reopened", campaignId: exists ? c.campaignId : null, details: { reason: "scheduled", reopenAt: c.reopenAt.toISOString() } });
  }
  // دورةٌ لم تعد حملتُها قائمة (قبل موعدها) لا تُبقي التخطيطَ مغلقاً
  const locked = await db.marketingPlanningCycle.findMany({ where: { reopenedAt: null }, select: { id: true, campaignId: true } });
  for (const c of locked) {
    if (await db.marketingCampaign.count({ where: { id: c.campaignId } })) continue;
    await db.marketingPlanningCycle.updateMany({ where: { id: c.id, reopenedAt: null }, data: { reopenedAt: now, reopenedBy: "system", reopenReason: "campaign_removed" } });
  }
  // العددُ لما فُتح في موعده وحده
  return n;
}

export type PlanningDesk =
  | { open: true; lastCycle: { campaignId: string; campaignName: string; endDate: Date; reopenedAt: Date | null; reopenReason: string | null } | null }
  | { open: false; cycle: { campaignId: string; campaignName: string; startDate: Date | null; endDate: Date; reopenAt: Date; approvedAt: Date } };

/** حالةُ التخطيط الآن — **قراءةٌ بلا كتابة** (تُستدعى في رسم الصفحات وفي شرط الشات): ما حان موعدُه
 *  مفتوحٌ ولو لم يمرّ الكنسُ بعد، ودورةٌ لم تعد حملتُها قائمة لا تُغلق شيئاً. والكتابةُ للكنس وحده. */
export async function planningDesk(now = new Date(), db: Tx | typeof prisma = prisma): Promise<PlanningDesk> {
  const locked = await db.marketingPlanningCycle.findMany({ where: { reopenedAt: null, reopenAt: { gt: now } }, orderBy: { approvedAt: "desc" }, take: 5 });
  for (const l of locked) {
    if (!(await db.marketingCampaign.count({ where: { id: l.campaignId } }))) continue;
    return { open: false, cycle: { campaignId: l.campaignId, campaignName: l.campaignName, startDate: l.startDate, endDate: l.endDate, reopenAt: l.reopenAt, approvedAt: l.approvedAt } };
  }
  const last = await db.marketingPlanningCycle.findFirst({ orderBy: { approvedAt: "desc" } });
  const dueNotSwept = !!last && !last.reopenedAt && last.reopenAt.getTime() <= now.getTime();
  return {
    open: true,
    lastCycle: last
      ? { campaignId: last.campaignId, campaignName: last.campaignName, endDate: last.endDate, reopenedAt: last.reopenedAt ?? (dueNotSwept ? last.reopenAt : null), reopenReason: last.reopenReason ?? (dueNotSwept ? "scheduled" : null) }
      : null,
  };
}

/** فتحٌ مبكر — قائدُ التسويق وحده، بسببٍ مكتوب، ويُسجَّل باسمه */
export async function reopenPlanningEarly(actor: MkActor, input: { reason?: string }, now = new Date()): Promise<MkResult> {
  return guarded(async () => {
    if (actor.isFounder) return fail("founder_excluded");
    if (!actor.isMarketingLead) return fail("forbidden", { role: "manager" });
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
    if (reason.length < 5) return fail("invalid_input", { field: "reason" });
    return prisma.$transaction(async (tx) => {
      const locked = await tx.marketingPlanningCycle.findFirst({ where: { reopenedAt: null }, orderBy: { approvedAt: "desc" } });
      if (!locked) return fail("invalid_state", { from: "planning_open" });
      const res = await tx.marketingPlanningCycle.updateMany({
        where: { id: locked.id, reopenedAt: null },
        data: { reopenedAt: now, reopenedBy: actor.name, reopenReason: `early: ${reason}` },
      });
      if (res.count === 0) return fail("stale");
      const exists = await tx.marketingCampaign.count({ where: { id: locked.campaignId } });
      await logEvent(tx, actor, { action: "planning.reopened", campaignId: exists ? locked.campaignId : null, details: { reason: "early", note: reason } });
      return { ok: true as const };
    });
  });
}

/** موجزُ الحملة السابقة لسياق التخطيط التالي — أرقامٌ وعناوين، لا تفاصيلُها كاملة */
export async function previousCampaignSummary() {
  const last = await prisma.marketingPlanningCycle.findFirst({ orderBy: { approvedAt: "desc" } });
  if (!last) return null;
  const c = await prisma.marketingCampaign.findUnique({
    where: { id: last.campaignId },
    select: { name: true, objective: true, kpis: true, startDate: true, deadline: true, deliverables: { select: { status: true, platform: true } } },
  });
  if (!c) return { name: last.campaignName, startDate: last.startDate, endDate: last.endDate, archived: true as const };
  const platforms = [...new Set(c.deliverables.map((d) => d.platform))];
  return {
    name: c.name,
    objective: c.objective,
    kpis: c.kpis,
    startDate: c.startDate,
    endDate: c.deadline,
    pieces: c.deliverables.length,
    published: c.deliverables.filter((d) => d.status === "published").length,
    platforms,
    archived: false as const,
  };
}
