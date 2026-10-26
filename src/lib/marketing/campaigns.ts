import type { MarketingCampaignRole, MarketingCampaignStatus, Prisma, WorkPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, hasCapability, requireCampaignRole, visibleCampaignsWhere, type MkActor } from "./access";
import { logEvent } from "./audit";
import { abort, fail, guarded, type MkResult } from "./result";

/** الحملة: موجزُها وفريقُها وحالتُها.
 *
 *  **آلةُ الحالات** (يفرضها الخادم، لا الأزرار):
 *    idea → briefing → ready_for_planning → in_progress → published → archived
 *  - `ready_for_planning` تشترط موجزاً مكتملاً (الهدف والجمهور والرسالة
 *    والموعد) ومخرجاً واحداً على الأقل.
 *  - `in_progress` تشترط كاتباً ومصمّماً معيَّنَين.
 *  - `published` لا تُطلب يدوياً: تُبلَغ حين يُنشَر آخرُ مخرجٍ (`completeIfAllPublished`).
 *  - `blocked` من أي حالةٍ نشطة بسببٍ مكتوب، ويعود منها إلى ما كان.
 *  - `archived` نهائية. */

export const PRIORITIES: WorkPriority[] = ["critical", "high", "normal", "low"];
const OPEN: MarketingCampaignStatus[] = ["idea", "briefing", "ready_for_planning", "in_progress"];

const NEXT: Partial<Record<MarketingCampaignStatus, MarketingCampaignStatus[]>> = {
  idea: ["briefing"],
  briefing: ["ready_for_planning", "idea"],
  ready_for_planning: ["in_progress", "briefing"],
  in_progress: ["ready_for_planning"],
};

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const opt = (s: unknown, max: number) => clip(s, max) || null;

export type BriefInput = {
  name: string;
  description?: string;
  objective?: string;
  audience?: string;
  keyMessage?: string;
  channels?: string[];
  deadline?: string | Date | null;
  priority?: string;
};

function parseBrief(input: BriefInput) {
  const name = clip(input.name, 160);
  if (!name) abort("invalid_input", { field: "name" });
  let deadline: Date | null = null;
  if (input.deadline) {
    const d = input.deadline instanceof Date ? input.deadline : new Date(String(input.deadline));
    if (Number.isNaN(d.getTime())) abort("invalid_input", { field: "deadline" });
    deadline = d;
  }
  const priority = (PRIORITIES as string[]).includes(String(input.priority)) ? (input.priority as WorkPriority) : "normal";
  const channels = [...new Set((input.channels ?? []).map((c) => clip(c, 40)).filter(Boolean))].slice(0, 12);
  return {
    name,
    description: opt(input.description, 2000),
    objective: opt(input.objective, 1000),
    audience: opt(input.audience, 1000),
    keyMessage: opt(input.keyMessage, 1000),
    channels,
    deadline,
    priority,
  };
}

/** ما ينقص الموجز ليُخطَّط له — أسماءُ حقولٍ تترجمها الواجهة */
export function briefMissing(c: { objective: string | null; audience: string | null; keyMessage: string | null; deadline: Date | null }, deliverables: number): string[] {
  const missing: string[] = [];
  if (!c.objective) missing.push("objective");
  if (!c.audience) missing.push("audience");
  if (!c.keyMessage) missing.push("keyMessage");
  if (!c.deadline) missing.push("deadline");
  if (deliverables === 0) missing.push("deliverables");
  return missing;
}

/** من ينقص الفريق ليبدأ العمل */
export function teamMissing(roles: MarketingCampaignRole[]): MarketingCampaignRole[] {
  return (["writer", "designer"] as const).filter((r) => !roles.includes(r));
}

export async function createCampaign(actor: MkActor, input: BriefInput): Promise<MkResult<{ campaignId: string }>> {
  return guarded(async () => {
    if (!actor.member || !hasCapability(actor, "coordinator")) return fail("forbidden", { role: "coordinator" });
    const brief = parseBrief(input);
    const memberId = actor.member.id;
    return prisma.$transaction(async (tx) => {
      const c = await tx.marketingCampaign.create({
        data: { ...brief, ownerId: memberId, members: { create: { memberId, role: "coordinator" } } },
        select: { id: true },
      });
      await logEvent(tx, actor, { action: "campaign.created", campaignId: c.id, details: { name: brief.name } });
      return { ok: true as const, campaignId: c.id };
    });
  });
}

export async function updateBrief(actor: MkActor, campaignId: string, input: BriefInput): Promise<MkResult> {
  return guarded(async () => {
    await requireCampaignRole(actor, campaignId, "coordinator");
    const c = await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (!c) return fail("not_found");
    if (c.status === "archived" || c.status === "published") return fail("campaign_closed");
    const brief = parseBrief(input);
    await prisma.$transaction(async (tx) => {
      await tx.marketingCampaign.update({ where: { id: campaignId }, data: { ...brief, revision: { increment: 1 } } });
      await logEvent(tx, actor, { action: "campaign.brief_updated", campaignId });
    });
    return { ok: true };
  });
}

export async function addCampaignMember(
  actor: MkActor,
  campaignId: string,
  input: { marketingMemberId: string; role: MarketingCampaignRole }
): Promise<MkResult> {
  return guarded(async () => {
    await requireCampaignRole(actor, campaignId, "coordinator");
    const target = await prisma.marketingMember.findUnique({
      where: { id: input.marketingMemberId },
      select: { id: true, active: true, capabilities: true, user: { select: { fullName: true } }, member: { select: { fullName: true } } },
    });
    if (!target || !target.active) return fail("not_found");
    // التعيينُ لا يمنح مسؤولية: من لا يحمل الكتابة لا يُعيَّن كاتباً
    if (!target.capabilities.includes(input.role)) return fail("capability_required", { role: input.role });
    const c = await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (!c || c.status === "archived") return fail("campaign_closed");
    await prisma.$transaction(async (tx) => {
      const dup = await tx.marketingCampaignMember.findUnique({
        where: { campaignId_memberId_role: { campaignId, memberId: target.id, role: input.role } },
        select: { id: true },
      });
      if (dup) abort("already_member");
      await tx.marketingCampaignMember.create({ data: { campaignId, memberId: target.id, role: input.role } });
      await logEvent(tx, actor, {
        action: "campaign.member_added",
        campaignId,
        details: { name: target.user?.fullName ?? target.member?.fullName ?? "—", role: input.role },
      });
    });
    return { ok: true };
  });
}

export async function removeCampaignMember(actor: MkActor, campaignId: string, campaignMemberId: string): Promise<MkResult> {
  return guarded(async () => {
    await requireCampaignRole(actor, campaignId, "coordinator");
    await prisma.$transaction(async (tx) => {
      const row = await tx.marketingCampaignMember.findFirst({
        where: { id: campaignMemberId, campaignId },
        select: { id: true, role: true, member: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } } } } },
      });
      if (!row) abort("not_found");
      if (row.role === "coordinator") {
        const coordinators = await tx.marketingCampaignMember.count({ where: { campaignId, role: "coordinator" } });
        // حملةٌ بلا منسّقٍ لا يديرها أحد
        if (coordinators <= 1) abort("team_incomplete", { role: "coordinator" });
      }
      await tx.marketingCampaignMember.delete({ where: { id: row.id } });
      await logEvent(tx, actor, {
        action: "campaign.member_removed",
        campaignId,
        details: { name: row.member.user?.fullName ?? row.member.member?.fullName ?? "—", role: row.role },
      });
    });
    return { ok: true };
  });
}

/** تغييرُ حالة الحملة — بشروطها، ومشروطٌ بأن أحداً لم يغيّرها في اللحظة نفسها */
export async function transitionCampaign(
  actor: MkActor,
  campaignId: string,
  to: MarketingCampaignStatus,
  opts: { reason?: string; expectedRevision?: number } = {}
): Promise<MkResult> {
  return guarded(async () => {
    await requireCampaignRole(actor, campaignId, "coordinator");
    return prisma.$transaction(async (tx) => {
      const c = await tx.marketingCampaign.findUnique({
        where: { id: campaignId },
        include: { _count: { select: { deliverables: true } }, members: { select: { role: true, member: { select: { active: true, capabilities: true } } } } },
      });
      if (!c) abort("not_found");
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== c.revision) abort("stale");
      const reason = clip(opts.reason, 500);
      let data: Prisma.MarketingCampaignUpdateInput;

      if (to === "blocked") {
        if (!OPEN.includes(c.status)) abort("invalid_state", { from: c.status, to });
        if (!reason) abort("invalid_input", { field: "reason" });
        data = { status: "blocked", statusBeforeBlock: c.status, blockedReason: reason };
      } else if (c.status === "blocked") {
        if (to !== c.statusBeforeBlock) abort("invalid_state", { from: c.status, to });
        data = { status: to, statusBeforeBlock: null, blockedReason: null };
      } else if (to === "archived") {
        if (c.status === "archived") abort("invalid_state", { from: c.status, to });
        data = { status: "archived" };
      } else {
        if (!NEXT[c.status]?.includes(to)) abort("invalid_state", { from: c.status, to });
        if (to === "ready_for_planning" && c.status === "briefing") {
          const missing = briefMissing(c, c._count.deliverables);
          if (missing.length) abort("brief_incomplete", { missing: missing.join(",") });
        }
        if (to === "in_progress") {
          const live = c.members.filter((m) => m.member.active && m.member.capabilities.includes(m.role)).map((m) => m.role);
          const missing = teamMissing(live);
          if (missing.length) abort("team_incomplete", { missing: missing.join(",") });
        }
        data = { status: to };
      }

      const res = await tx.marketingCampaign.updateMany({
        where: { id: campaignId, revision: c.revision },
        data: { ...(data as Prisma.MarketingCampaignUpdateManyMutationInput), revision: { increment: 1 } },
      });
      if (res.count === 0) abort("stale");
      await logEvent(tx, actor, {
        action: "campaign.status_changed",
        campaignId,
        details: { from: c.status, to, ...(reason ? { reason } : {}) },
      });
      return { ok: true as const };
    });
  });
}

/** آخرُ مخرجٍ نُشر: الحملةُ منشورة — في المعاملة نفسها التي سجّلت النشر */
export async function completeIfAllPublished(tx: Prisma.TransactionClient, actor: MkActor, campaignId: string) {
  const [total, published, c] = await Promise.all([
    tx.marketingDeliverable.count({ where: { campaignId } }),
    tx.marketingDeliverable.count({ where: { campaignId, status: "published" } }),
    tx.marketingCampaign.findUnique({ where: { id: campaignId }, select: { status: true, revision: true } }),
  ]);
  if (!c || total === 0 || published < total || c.status !== "in_progress") return;
  await tx.marketingCampaign.update({ where: { id: campaignId }, data: { status: "published", revision: { increment: 1 } } });
  await logEvent(tx, actor, { action: "campaign.status_changed", campaignId, details: { from: c.status, to: "published", automatic: true } });
}

const LIST_TAKE = 100;

export async function listCampaigns(actor: MkActor, filter: { status?: MarketingCampaignStatus | "active" } = {}) {
  const statusWhere: Prisma.MarketingCampaignWhereInput =
    filter.status === "active" ? { status: { notIn: ["archived"] } } : filter.status ? { status: filter.status } : {};
  return prisma.marketingCampaign.findMany({
    where: { AND: [visibleCampaignsWhere(actor), statusWhere] },
    orderBy: [{ updatedAt: "desc" }],
    take: LIST_TAKE,
    select: {
      id: true,
      name: true,
      status: true,
      priority: true,
      deadline: true,
      updatedAt: true,
      owner: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } } } },
      _count: { select: { deliverables: true, tasks: true } },
      deliverables: { select: { status: true } },
    },
  });
}

/** ما تحتاجه صفحةُ الحملة — أو `null` لمن لا يراها (فيُقال له «غير موجودة» لا «ممنوعة») */
export async function campaignWorkspace(actor: MkActor, campaignId: string) {
  const access = await campaignAccess(actor, campaignId);
  if (!access.canView) return null;
  const c = await prisma.marketingCampaign.findUnique({
    where: { id: campaignId },
    include: {
      owner: { select: { id: true, user: { select: { fullName: true } }, member: { select: { fullName: true } } } },
      members: {
        orderBy: { addedAt: "asc" },
        select: { id: true, role: true, member: { select: { id: true, active: true, capabilities: true, user: { select: { fullName: true } }, member: { select: { fullName: true } } } } },
      },
      deliverables: {
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, platform: true, formatKey: true, width: true, height: true, status: true, updatedAt: true },
      },
      _count: { select: { deliverables: true } },
    },
  });
  if (!c) return null;
  return { campaign: c, roles: [...access.roles] as MarketingCampaignRole[] };
}

export const personName = (m: { user: { fullName: string } | null; member: { fullName: string } | null } | null) =>
  m?.user?.fullName ?? m?.member?.fullName ?? "—";

/** من يُعيَّن في حملة: أعضاءُ الفريق النشطون ومسؤولياتُهم — للمنسّق فيها وحده */
export async function assignableMembers(actor: MkActor, campaignId: string) {
  const access = await campaignAccess(actor, campaignId);
  if (!access.roles.has("coordinator")) return null;
  const rows = await prisma.marketingMember.findMany({
    where: { active: true, OR: [{ user: { isActive: true } }, { member: { isActive: true, terminatedAt: null } }] },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, capabilities: true, user: { select: { fullName: true } }, member: { select: { fullName: true } } },
  });
  return rows
    .map((r) => ({ id: r.id, name: personName(r), roles: r.capabilities.filter((c): c is MarketingCampaignRole => c !== "manager") }))
    .filter((r) => r.roles.length > 0);
}
