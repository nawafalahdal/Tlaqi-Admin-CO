import type { MarketingCampaignRole, MarketingDeliverableStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCampaignRole, type MkActor } from "./access";
import { personName } from "./campaigns";

/** **صفحاتُ العمل: المحتوى، والتصميم، والاعتماد والنشر** — كلُّ منشورٍ قيد العمل في مرحلته، لكل من
 *  يعمل في حملته، بحالة نصّه وتصميمه واعتماده، ومن عليه الخطوةُ الآن، والإجراءِ التالي.
 *
 *  - **العملُ الجاري وحده:** ما أُرشف بعد نشره (`archivedAt`) لا يظهر هنا — مكانُه ملفُّ الأرشيف.
 *  - **ما يلزم الصفحةَ وحدها:** صفحةٌ من عشرين، بأعمدةٍ مسمّاة لا بالمنشور كلِّه، وبلا قراءةٍ لملف
 *    Google Sheets في أيٍّ منها. والنصُّ والروابطُ في «الاعتماد والنشر» وحدها (مقتطفاً).
 *  - **الرؤيةُ رؤيةُ العمل:** قائدُ التسويق يرى كلَّ حملة، والعضوُ ما عُيِّن فيه بمسؤوليةٍ يحملها. ومن يرى
 *    الخطةَ وحدها (التشغيلُ والتنفيذي) لا يرى عملَ الفريق. */

export type WorkStage = "content" | "design" | "publishing";
export const WORK_PAGE_SIZE = 20;

const STAGE_WHERE: Record<WorkStage, Prisma.MarketingDeliverableWhereInput[]> = {
  content: [
    { status: { in: ["draft", "content_review"] } },
    { status: "revision_required", revisionTarget: "content" },
    { status: "blocked", statusBeforeBlock: { in: ["draft", "content_review", "revision_required"] } },
  ],
  design: [
    { status: { in: ["content_approved", "design_review", "design_approved"] } },
    { status: "revision_required", revisionTarget: "design" },
    { status: "blocked", statusBeforeBlock: { in: ["content_approved", "design_review", "design_approved"] } },
  ],
  // المنشورُ يبقى هنا حتى تتحقّق أرشفتُه — فإن تعذّرت رآها الفريقُ بسببها
  publishing: [
    { status: { in: ["quality_review", "ready_to_publish", "published"] } },
    { status: "blocked", statusBeforeBlock: { in: ["quality_review", "ready_to_publish"] } },
  ],
};

/** الحملاتُ التي يعمل فيها — لا التي يرى خطتَها وحدها */
export function workCampaignsWhere(actor: MkActor): Prisma.MarketingCampaignWhereInput | null {
  if (actor.isFounder) return null;
  if (actor.isMarketingLead) return {};
  if (!actor.member) return null;
  const caps = actor.member.capabilities.filter(isCampaignRole);
  if (!caps.length) return null;
  return { members: { some: { memberId: actor.member.id, role: { in: caps } } } };
}

const ACTIVE_CAMPAIGN: Prisma.MarketingCampaignWhereInput = { status: { in: ["in_progress", "published", "blocked"] } };

function stageWhere(actor: MkActor, stage: WorkStage): Prisma.MarketingDeliverableWhereInput | null {
  const visible = workCampaignsWhere(actor);
  if (!visible) return null;
  return { archivedAt: null, OR: STAGE_WHERE[stage], campaign: { AND: [visible, ACTIVE_CAMPAIGN] } };
}

/** أعدادُ الصفحات الثلاث — لشاراتها */
export async function workCounts(actor: MkActor): Promise<Record<WorkStage, number>> {
  const stages: WorkStage[] = ["content", "design", "publishing"];
  const counts = await Promise.all(stages.map((s) => {
    const where = stageWhere(actor, s);
    return where ? prisma.marketingDeliverable.count({ where }) : Promise.resolve(0);
  }));
  return Object.fromEntries(stages.map((s, i) => [s, counts[i]])) as Record<WorkStage, number>;
}

const who = { select: { id: true, user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } } as const;

export type ContentState = "not_started" | "writing" | "in_review" | "changes" | "approved";
export type DesignState = "waiting_text" | "needed" | "in_review" | "changes" | "approved";
export type ApprovalState = "not_yet" | "quality" | "final_check" | "ready" | "archiving" | "archive_failed";
export type NextAction =
  | "write" | "revise_content" | "approve_content" | "add_design" | "revise_design" | "approve_design" | "send_quality"
  | "quality" | "final_check" | "publish" | "archiving" | "retry_archive" | "unblock";
export type OwnerRole = MarketingCampaignRole | "system";

export type WorkItem = {
  id: string;
  campaignId: string;
  campaignName: string;
  seq: number | null;
  title: string;
  platform: string;
  contentType: string | null;
  status: MarketingDeliverableStatus;
  content: ContentState;
  design: DesignState;
  approval: ApprovalState;
  ownerRole: OwnerRole;
  owners: string[];
  mine: boolean;
  next: NextAction;
  updatedAt: Date;
  publishAt: Date | null;
  /** «الاعتماد والنشر» وحدها */
  text?: string | null;
  designLink?: string | null;
  designFileId?: string | null;
  designDescription?: string | null;
  postUrl?: string | null;
  archiveError?: string | null;
};

/** صفحةٌ من منشورات المرحلة — مرتّبةٌ بموعد النشر الأقرب */
export async function workQueue(actor: MkActor, stage: WorkStage, opts: { page?: number } = {}) {
  const where = stageWhere(actor, stage);
  if (!where) return { items: [] as WorkItem[], total: 0, page: 1, pages: 1 };
  const total = await prisma.marketingDeliverable.count({ where });
  const pages = Math.max(1, Math.ceil(total / WORK_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1)));
  const withText = stage === "publishing";
  const rows = await prisma.marketingDeliverable.findMany({
    where,
    orderBy: [{ publishAt: { sort: "asc", nulls: "last" } }, { campaignId: "asc" }, { seq: "asc" }],
    skip: (page - 1) * WORK_PAGE_SIZE,
    take: WORK_PAGE_SIZE,
    select: {
      id: true, campaignId: true, seq: true, title: true, platform: true, contentType: true, status: true, statusBeforeBlock: true, revisionTarget: true,
      draftUpdatedAt: true, currentContentVersionId: true, updatedAt: true, publishAt: true, writerId: true, designerId: true,
      writer: who, designer: who,
      campaign: { select: { name: true, members: { select: { role: true, memberId: true, member: who } } } },
      finalChecks: { where: { invalidatedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { passed: true, contentVersionId: true, designVersionId: true } },
      currentDesignVersionId: true,
      postArchive: { select: { status: true, lastError: true } },
      ...(withText
        ? {
            designDescription: true,
            currentContentVersion: { select: { body: true } },
            currentDesignVersion: { select: { linkUrl: true, fileId: true, description: true } },
            publications: { orderBy: { publishedAt: "desc" }, take: 1, select: { url: true } },
          }
        : {}),
    },
  });
  const me = actor.member?.id ?? null;
  const items = rows.map((d): WorkItem => {
    const s = d.status === "blocked" ? d.statusBeforeBlock ?? d.status : d.status;
    const content: ContentState =
      s === "draft" ? (d.draftUpdatedAt || d.currentContentVersionId ? "writing" : "not_started")
      : s === "content_review" ? "in_review"
      : s === "revision_required" && d.revisionTarget === "content" ? "changes"
      : "approved";
    const design: DesignState =
      ["draft", "content_review"].includes(s) || (s === "revision_required" && d.revisionTarget === "content") ? "waiting_text"
      : s === "content_approved" ? "needed"
      : s === "design_review" ? "in_review"
      : s === "revision_required" && d.revisionTarget === "design" ? "changes"
      : "approved";
    const final = d.finalChecks[0];
    const finalPassed = !!final?.passed && final.contentVersionId === d.currentContentVersionId && final.designVersionId === d.currentDesignVersionId;
    const approval: ApprovalState =
      s === "quality_review" ? "quality"
      : s === "ready_to_publish" ? (finalPassed ? "ready" : "final_check")
      : s === "published" ? (d.postArchive?.status === "failed" ? "archive_failed" : "archiving")
      : "not_yet";
    const roleNames = (r: MarketingCampaignRole) => d.campaign.members.filter((m) => m.role === r).map((m) => personName(m.member));
    const holds = (r: MarketingCampaignRole) => !!me && d.campaign.members.some((m) => m.role === r && m.memberId === me);
    let ownerRole: OwnerRole;
    let owners: string[];
    let next: NextAction;
    let mine: boolean;
    if (d.status === "blocked") {
      ownerRole = "coordinator"; owners = roleNames("coordinator"); next = "unblock"; mine = actor.isMarketingLead || holds("coordinator");
    } else if (content === "not_started" || content === "writing" || content === "changes") {
      ownerRole = "writer"; owners = d.writer ? [personName(d.writer)] : roleNames("writer"); next = content === "changes" ? "revise_content" : "write";
      mine = !!me && (d.writerId ? d.writerId === me : holds("writer"));
    } else if (content === "in_review") {
      ownerRole = "writer"; owners = roleNames("writer").filter((n) => !d.writer || n !== personName(d.writer)); next = "approve_content";
      mine = holds("writer") && d.writerId !== me;
    } else if (design === "needed" || design === "changes") {
      ownerRole = "designer"; owners = d.designer ? [personName(d.designer)] : roleNames("designer"); next = design === "changes" ? "revise_design" : "add_design";
      mine = !!me && (d.designerId ? d.designerId === me : holds("designer"));
    } else if (design === "in_review") {
      ownerRole = "designer"; owners = roleNames("designer").filter((n) => !d.designer || n !== personName(d.designer)); next = "approve_design";
      mine = holds("designer") && d.designerId !== me;
    } else if (s === "design_approved") {
      ownerRole = "designer"; owners = d.designer ? [personName(d.designer)] : roleNames("designer"); next = "send_quality";
      mine = holds("designer") || holds("coordinator") || actor.isMarketingLead;
    } else if (approval === "quality") {
      ownerRole = "reviewer"; owners = roleNames("reviewer"); next = "quality"; mine = holds("reviewer");
    } else if (approval === "final_check" || approval === "ready") {
      ownerRole = "publisher"; owners = roleNames("publisher"); next = approval === "ready" ? "publish" : "final_check"; mine = holds("publisher");
    } else if (approval === "archive_failed") {
      ownerRole = "coordinator"; owners = roleNames("coordinator"); next = "retry_archive"; mine = actor.isMarketingLead || holds("coordinator") || holds("publisher");
    } else {
      ownerRole = "system"; owners = []; next = "archiving"; mine = false;
    }
    const x = d as typeof d & {
      designDescription?: string | null;
      currentContentVersion?: { body: string } | null;
      currentDesignVersion?: { linkUrl: string | null; fileId: string | null; description: string | null } | null;
      publications?: { url: string }[];
    };
    return {
      id: d.id, campaignId: d.campaignId, campaignName: d.campaign.name, seq: d.seq, title: d.title, platform: d.platform, contentType: d.contentType,
      status: d.status, content, design, approval, ownerRole, owners, mine, next, updatedAt: d.updatedAt, publishAt: d.publishAt,
      ...(withText
        ? {
            text: x.currentContentVersion?.body ? x.currentContentVersion.body.slice(0, 400) : null,
            designLink: x.currentDesignVersion?.linkUrl ?? null,
            designFileId: x.currentDesignVersion?.fileId ?? null,
            designDescription: (x.currentDesignVersion?.description ?? x.designDescription)?.slice(0, 300) ?? null,
            postUrl: x.publications?.[0]?.url ?? null,
            archiveError: d.postArchive?.status === "failed" || d.postArchive?.status === "pending" ? d.postArchive.lastError : null,
          }
        : {}),
    };
  });
  return { items, total, page, pages };
}
