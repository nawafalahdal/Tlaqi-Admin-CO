import type { MarketingCampaignRole, MarketingDeliverableStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasCapability, isCampaignRole, type MkActor } from "./access";

/** «ما الذي ينتظرني؟» — من الحقائق لا من التخمين.
 *
 *  لكل مسؤوليةٍ ما ينتظرها من حالات المخرج، وفي الحملات التي عُيِّن فيها
 *  صاحبُها وحدها. والاعتمادُ لا يُعرض على من كتب النسخة إن كانت السياسةُ
 *  تفصل — فلا يُدعى أحدٌ إلى ما لا يحقّ له. */

const WAITING: Record<MarketingCampaignRole, { status: MarketingDeliverableStatus[]; kind: string; revisionTarget?: "content" | "design" }[]> = {
  writer: [
    { status: ["draft"], kind: "write" },
    { status: ["revision_required"], kind: "revise_content", revisionTarget: "content" },
    { status: ["content_review"], kind: "approve_content" },
  ],
  designer: [
    { status: ["content_approved"], kind: "design" },
    { status: ["revision_required"], kind: "revise_design", revisionTarget: "design" },
    { status: ["design_review"], kind: "approve_design" },
    { status: ["design_approved"], kind: "send_quality" },
  ],
  reviewer: [{ status: ["quality_review"], kind: "quality" }],
  publisher: [{ status: ["ready_to_publish"], kind: "publish" }],
  coordinator: [{ status: ["blocked"], kind: "unblock" }],
};

const TAKE = 50;

export async function actionItems(actor: MkActor) {
  if (!actor.member) return { items: [], tasks: [] };
  const memberId = actor.member.id;
  const caps = actor.member.capabilities.filter(isCampaignRole);
  const myRoles = await prisma.marketingCampaignMember.findMany({
    where: { memberId, role: { in: caps }, campaign: { status: "in_progress" } },
    select: { campaignId: true, role: true },
  });
  const settings = await prisma.marketingSettings.findUnique({ where: { id: "default" }, select: { requireSeparateApprover: true } });
  const separate = settings?.requireSeparateApprover ?? true;

  const ors: Prisma.MarketingDeliverableWhereInput[] = [];
  const kindOf: { campaignIds: Set<string>; status: MarketingDeliverableStatus[]; kind: string; revisionTarget?: string }[] = [];
  for (const role of caps) {
    const campaignIds = new Set(myRoles.filter((r) => r.role === role).map((r) => r.campaignId));
    if (campaignIds.size === 0) continue;
    for (const w of WAITING[role]) {
      kindOf.push({ campaignIds, ...w });
      ors.push({
        campaignId: { in: [...campaignIds] },
        status: { in: w.status },
        ...(w.revisionTarget ? { revisionTarget: w.revisionTarget } : {}),
        // من كتب لا يُدعى إلى اعتماد ما كتب
        ...(w.kind === "approve_content" && separate ? { currentContentVersion: { authorId: { not: memberId } } } : {}),
        ...(w.kind === "approve_design" && separate ? { currentDesignVersion: { authorId: { not: memberId } } } : {}),
      });
    }
  }

  const [deliverables, tasks] = await Promise.all([
    ors.length
      ? prisma.marketingDeliverable.findMany({
          where: { OR: ors },
          orderBy: { updatedAt: "asc" },
          take: TAKE,
          select: { id: true, title: true, status: true, revisionTarget: true, platform: true, updatedAt: true, campaignId: true, campaign: { select: { name: true, deadline: true } } },
        })
      : [],
    prisma.marketingTask.findMany({
      where: { assigneeId: memberId, status: { in: ["todo", "in_progress", "blocked"] }, campaign: { status: { notIn: ["archived"] } } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: TAKE,
      select: { id: true, title: true, status: true, dueAt: true, priority: true, campaignId: true, campaign: { select: { name: true } }, deliverable: { select: { id: true, title: true } } },
    }),
  ]);

  const items = deliverables.map((d) => {
    const k = kindOf.find(
      (x) => x.campaignIds.has(d.campaignId) && x.status.includes(d.status) && (!x.revisionTarget || x.revisionTarget === d.revisionTarget)
    );
    return { ...d, kind: k?.kind ?? "view" };
  });
  return { items, tasks };
}

/** أعدادٌ للوحة — من القاعدة، ولا رقمَ يُخترع حين لا بيانات */
export async function marketingOverview(actor: MkActor) {
  const where: Prisma.MarketingCampaignWhereInput = hasCapability(actor, "manager")
    ? {}
    : actor.member
      ? { members: { some: { memberId: actor.member.id } } }
      : { id: "__none__" };
  const [byStatus, overdueTasks, published] = await Promise.all([
    prisma.marketingCampaign.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.marketingTask.count({ where: { campaign: where, status: { in: ["todo", "in_progress", "blocked"] }, dueAt: { lt: new Date() } } }),
    prisma.marketingPublication.count({ where: { deliverable: { campaign: where } } }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>,
    overdueTasks,
    published,
  };
}

/** سجلُّ التدقيق لحملة — أو لمخرجٍ فيها — مقيَّدٌ بعدد. والرؤيةُ يفحصها من يستدعيه (الصفحة) */
export async function campaignEvents(campaignId: string, take = 100, deliverableId?: string) {
  return prisma.marketingEvent.findMany({ where: { campaignId, ...(deliverableId ? { deliverableId } : {}) }, orderBy: { createdAt: "desc" }, take });
}
