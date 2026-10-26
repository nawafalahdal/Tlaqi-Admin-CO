import type { MarketingCampaignRole, MarketingTaskKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, type MkActor } from "./access";
import { personName } from "./campaigns";

/** اقتراحُ الإسناد — يُحسب ولا يُسنِد.
 *
 *  - **قراءةٌ فقط:** يُحسب عند العرض ولا يُخزَّن ولا يغيّر شيئاً؛ والإسنادُ لا يقع إلا
 *    بضغطة المنسّق على «أسنِد» (`assignTask`)، وهي تمرّ بفحوص الإسناد كلها.
 *  - **من فريق الحملة وحده:** عضوٌ نشِط، حسابُه قائم، وما زال يحمل الدورَ الذي
 *    يطلبه نوعُ المهمة (المحتوى للكاتب، والتصميم للمصمم، والجودة للمراجع، والنشر
 *    لمسؤول النشر). والمهمةُ العامة لكل من في الفريق.
 *  - **الترتيب:** الأقلُّ مهامَّ مفتوحةً أولاً، ثم الأقلُّ متأخراتٍ. ومهمةُ الجودة
 *    المرتبطة بمخرجٍ تُقدِّم من لم يكتب نسختَه الحالية ولم يصمّمها — تفضيلٌ في
 *    الاقتراح وحده، لا قاعدةٌ تمنع (السياسةُ لم تحسم ذلك بعد).
 *  - **الاعتماديات:** تُذكر — المسنَدُ إليه لا يبدأ قبل إنجاز ما تنتظره المهمة.
 *  - **التوفّر:** لا تحفظ المنصةُ إجازاتٍ ولا تقويمَ توفّر، فلا يدخل في الحساب.
 *  - **عبءُ العمل عددٌ فقط** — مجموعُ المهام المفتوحة المسندة للشخص، بلا أسماء
 *    حملاتٍ ولا تفاصيل. */

export const ROLE_FOR_KIND: Record<MarketingTaskKind, MarketingCampaignRole | null> = {
  general: null,
  content: "writer",
  design: "designer",
  quality: "reviewer",
  publishing: "publisher",
};

const OPEN = ["todo", "in_progress", "blocked"] as const;
const MAX_CANDIDATES = 3;

export type Candidate = { memberId: string; name: string; open: number; overdue: number; authored: boolean };
export type Suggestion = {
  taskId: string;
  role: MarketingCampaignRole | null;
  /** لماذا يُقترح: بلا مسنَد، أو المسنَدُ لم يعد صالحاً */
  why: "unassigned" | "assignee_ineligible";
  waitingOn: number;
  candidates: Candidate[];
};

type TeamRow = { memberId: string; name: string; role: MarketingCampaignRole; eligible: boolean };

/** الترتيبُ نفسه — دالةٌ صافية تُختبر وحدها */
export function rankCandidates(
  team: TeamRow[],
  role: MarketingCampaignRole | null,
  load: Map<string, { open: number; overdue: number }>,
  authors: Set<string>,
  preferIndependent: boolean
): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const t of team) {
    if (!t.eligible || (role && t.role !== role) || seen.has(t.memberId)) continue;
    const l = load.get(t.memberId) ?? { open: 0, overdue: 0 };
    seen.set(t.memberId, { memberId: t.memberId, name: t.name, open: l.open, overdue: l.overdue, authored: authors.has(t.memberId) });
  }
  return [...seen.values()]
    .sort(
      (a, b) =>
        (preferIndependent ? Number(a.authored) - Number(b.authored) : 0) ||
        a.open - b.open ||
        a.overdue - b.overdue ||
        a.name.localeCompare(b.name, "ar")
    )
    .slice(0, MAX_CANDIDATES);
}

/** اقتراحاتُ الحملة للمنسّق وحده — `null` لغيره */
export async function assignmentSuggestions(actor: MkActor, campaignId: string): Promise<Suggestion[] | null> {
  const access = await campaignAccess(actor, campaignId);
  if (!access.roles.has("coordinator")) return null;

  const [members, tasks] = await Promise.all([
    prisma.marketingCampaignMember.findMany({
      where: { campaignId },
      select: {
        role: true,
        member: {
          select: {
            id: true,
            active: true,
            capabilities: true,
            nameSnapshot: true,
            user: { select: { fullName: true, isActive: true } },
            member: { select: { fullName: true, isActive: true, terminatedAt: true } },
          },
        },
      },
    }),
    prisma.marketingTask.findMany({
      where: { campaignId, status: { in: [...OPEN] } },
      take: 300,
      select: {
        id: true,
        kind: true,
        assigneeId: true,
        deliverable: { select: { currentContentVersion: { select: { authorId: true } }, currentDesignVersion: { select: { authorId: true } } } },
        dependsOn: { select: { dependsOn: { select: { status: true } } } },
      },
    }),
  ]);

  const team: TeamRow[] = members.map((m) => {
    const p = m.member;
    const accountLive = !!(p.user?.isActive || (p.member?.isActive && !p.member.terminatedAt));
    return { memberId: p.id, name: personName(p), role: m.role, eligible: p.active && accountLive && p.capabilities.includes(m.role) };
  });
  const eligibleIds = new Set(team.filter((t) => t.eligible).map((t) => t.memberId));

  const pending = tasks.filter((t) => !t.assigneeId || !eligibleIds.has(t.assigneeId));
  if (pending.length === 0) return [];

  // عبءُ كل مرشّح: مهامُّه المفتوحة في كل الحملات — عددٌ لا غير
  const ids = [...new Set(team.map((t) => t.memberId))];
  const now = new Date();
  const [open, overdue] = await Promise.all([
    prisma.marketingTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { in: [...OPEN] } }, _count: { _all: true } }),
    prisma.marketingTask.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { in: [...OPEN] }, dueAt: { lt: now } }, _count: { _all: true } }),
  ]);
  const load = new Map<string, { open: number; overdue: number }>();
  for (const r of open) if (r.assigneeId) load.set(r.assigneeId, { open: r._count._all, overdue: 0 });
  for (const r of overdue) if (r.assigneeId) load.set(r.assigneeId, { open: load.get(r.assigneeId)?.open ?? 0, overdue: r._count._all });

  return pending.map((t) => {
    const role = ROLE_FOR_KIND[t.kind];
    const authors = new Set(
      [t.deliverable?.currentContentVersion?.authorId, t.deliverable?.currentDesignVersion?.authorId].filter((x): x is string => !!x)
    );
    return {
      taskId: t.id,
      role,
      why: t.assigneeId ? "assignee_ineligible" : "unassigned",
      waitingOn: t.dependsOn.filter((d) => d.dependsOn.status !== "done" && d.dependsOn.status !== "cancelled").length,
      candidates: rankCandidates(team, role, load, authors, t.kind === "quality"),
    };
  });
}
