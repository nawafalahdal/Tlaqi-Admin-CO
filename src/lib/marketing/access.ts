import type { Session } from "next-auth";
import type { MarketingCampaignRole, MarketingCapability, MarketingPlanStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { abort } from "./result";

/** **من يدخل وكيلَ التسويق، وماذا يفعل فيه — يُحسب في الخادم في كل طلب، من القاعدة.**
 *
 *  ثلاثُ طبقاتٍ لا تُغني إحداها عن الأخرى:
 *  ١) **العضوية في الفريق** (`MarketingMember`): حسابٌ قائمٌ في المنصة أُضيف
 *     صراحةً. لا يدخل أحدٌ لأن دوره تنفيذيٌّ أو لأن قسمه التسويق.
 *  ٢) **المسؤولية** (`capabilities`): كاتبٌ أو مصمّمٌ أو مراجع… تُمنح واحدةً
 *     واحدة، وسحبُها يوقف أثرها فوراً في كل حملة.
 *  ٣) **التعيين في الحملة** (`MarketingCampaignMember`): من لا صفَّ له في
 *     حملةٍ لا يراها، ولو حمل كلَّ المسؤوليات.
 *
 *  والمسؤوليةُ الفعّالة في حملةٍ = ما عُيِّن له فيها ∩ ما يحمله الآن.
 *
 *  **وأصحابُ القرار من هيكل المنصة نفسه — لا أدوارَ دخولٍ جديدة:**
 *  - **قائدُ التسويق** (قائدُ قسمٍ نشطٌ في قسم `marketing`): يدير الفريقَ
 *    ومسؤولياته، وينسّق كلَّ حملة، ويعتمد الخطةَ في مرحلة القسم.
 *  - **مسؤولُ التشغيل** يعتمدها في مرحلة التشغيل، و**الرئيسُ التنفيذي** في الأخيرة.
 *  - **المؤسسُ لا يشارك** في اعتماد الخطط ولا في عمليات الحملات: لا يدخل الوكيل،
 *    ولا يُضاف إلى الفريق، ولا تُحسب له عضويةٌ قديمة إن وُجدت.
 *
 *  والدورُ والقسم يُقرآن من القاعدة لا من الجلسة: من نُحّي أو نُقل يفقد أثره في
 *  الطلب التالي، لا حين تنقضي جلسته. */

type Db = Prisma.TransactionClient | typeof prisma;

export type OrgRole = "super_admin" | "executive" | "operations_officer" | "department_admin" | "member";

export type MkActor = {
  kind: "user" | "member";
  principalId: string;
  name: string;
  /** دورُه في المنصة الآن (من القاعدة) — `null` لحسابٍ معطَّل */
  orgRole: OrgRole | null;
  isFounder: boolean;
  /** قائدُ قسم التسويق النشط — مديرُ الفريق ومنسّقُ كل حملة */
  isMarketingLead: boolean;
  /** المرحلةُ التي يعتمد فيها الخطة — من دوره في المنصة لا من منحٍ في الوكيل */
  planStage: MarketingPlanStage | null;
  /** عضويتُه الفعّالة في الفريق — `null` لمن ليس عضواً أو أُوقف هو أو حسابُه */
  member: { id: string; capabilities: MarketingCapability[] } | null;
};

export const MARKETING_DEPARTMENT_SLUG = "marketing";

export async function marketingActor(session: Session | null, db: Db = prisma): Promise<MkActor | null> {
  if (!session?.user?.id) return null;
  const isMember = session.user.role === "member";
  const [row, user] = await Promise.all([
    db.marketingMember.findUnique({
      where: isMember ? { memberId: session.user.id } : { userId: session.user.id },
      select: {
        id: true,
        active: true,
        capabilities: true,
        user: { select: { isActive: true } },
        member: { select: { isActive: true, terminatedAt: true } },
      },
    }),
    isMember
      ? Promise.resolve(null)
      : db.user.findUnique({
          where: { id: session.user.id },
          select: { role: true, isActive: true, department: { select: { slug: true, parentId: true } } },
        }),
  ]);
  const orgRole: OrgRole | null = isMember ? "member" : user?.isActive ? user.role : null;
  const isFounder = orgRole === "super_admin";
  const isMarketingLead =
    orgRole === "department_admin" && user?.department?.slug === MARKETING_DEPARTMENT_SLUG && !user.department.parentId;
  const planStage: MarketingPlanStage | null = isMarketingLead
    ? "department"
    : orgRole === "operations_officer"
      ? "operations"
      : orgRole === "executive"
        ? "executive"
        : null;

  // الحسابُ المعطَّل أو المنتهية عضويتُه لا يحمل شيئاً في الفريق
  const principalLive = row
    ? row.user
      ? row.user.isActive
      : !!row.member && row.member.isActive && !row.member.terminatedAt
    : false;
  // «الإدارة» من الهيكل لا من منح؛ والتنسيقُ للقائد ضمناً
  const stored = (row?.capabilities ?? []).filter((c) => c !== "manager");
  const capabilities: MarketingCapability[] = isMarketingLead && !stored.includes("coordinator") ? [...stored, "coordinator"] : stored;
  const member =
    isFounder || !row || !principalLive
      ? null
      : isMarketingLead || row.active
        ? { id: row.id, capabilities }
        : null;
  return {
    kind: isMember ? "member" : "user",
    principalId: session.user.id,
    name: session.user.name ?? "—",
    orgRole,
    isFounder,
    isMarketingLead,
    planStage,
    member,
  };
}

export function hasCapability(actor: MkActor | null, cap: MarketingCapability): boolean {
  if (!actor || actor.isFounder) return false;
  if (cap === "manager") return actor.isMarketingLead;
  if (cap === "coordinator" && actor.isMarketingLead) return true;
  return !!actor.member && actor.member.capabilities.includes(cap);
}

/** هل يُرسَم له الوكيلُ أصلاً — القائمةُ والصفحاتُ تسأل هذا، والخادمُ يسأله قبلها */
export function canEnterMarketing(actor: MkActor | null): boolean {
  if (!actor || actor.isFounder) return false;
  if (actor.isMarketingLead || actor.planStage) return true;
  return !!actor.member && actor.member.capabilities.length > 0;
}

/** معرّفُ عضويته — ويُنشأ صفُّ قائد التسويق أوّلَ ما يعمل (سلطتُه من الهيكل، والصفُّ
 *  لينسب إليه ما يكتب). لا يُنشأ لغيره: العضويةُ منحٌ صريحٌ من القائد. */
export async function ensureMemberId(actor: MkActor, db: Db = prisma): Promise<string | null> {
  if (actor.member) return actor.member.id;
  if (!actor.isMarketingLead || actor.kind !== "user") return null;
  const row = await db.marketingMember.upsert({
    where: { userId: actor.principalId },
    update: {},
    create: { userId: actor.principalId, capabilities: [], nameSnapshot: actor.name, addedByName: actor.name },
    select: { id: true },
  });
  actor.member = { id: row.id, capabilities: ["coordinator"] };
  return row.id;
}

export type CampaignAccess = {
  /** يرى الحملة: مُعيَّنٌ فيها، أو قائدُ التسويق، أو معتمِدُ خطةٍ قُدّمت */
  canView: boolean;
  /** مسؤولياتُه الفعّالة فيها */
  roles: Set<MarketingCampaignRole>;
};

export async function campaignAccess(actor: MkActor | null, campaignId: string, db: Db = prisma): Promise<CampaignAccess> {
  const roles = new Set<MarketingCampaignRole>();
  if (!actor || actor.isFounder) return { canView: false, roles };
  if (actor.member) {
    const rows = await db.marketingCampaignMember.findMany({
      where: { campaignId, memberId: actor.member.id },
      select: { role: true },
    });
    for (const r of rows) if (actor.member.capabilities.includes(r.role)) roles.add(r.role);
  }
  if (actor.isMarketingLead) {
    // القائدُ ينسّق كلَّ حملةٍ قائمة
    if (await db.marketingCampaign.count({ where: { id: campaignId } })) roles.add("coordinator");
    return { canView: roles.size > 0, roles };
  }
  if (roles.size > 0) return { canView: true, roles };
  // معتمِدُ الخطة يرى ما قُدّمت خطتُه — اطّلاعاً لا عملاً
  if (actor.planStage) {
    const c = await db.marketingCampaign.findUnique({ where: { id: campaignId }, select: { currentPlanVersionId: true } });
    return { canView: !!c?.currentPlanVersionId, roles };
  }
  return { canView: false, roles };
}

/** داخل عملية: المنفّذ يملك هذه المسؤولية في هذه الحملة، وإلا أُلغيت العملية */
export async function requireCampaignRole(
  actor: MkActor | null,
  campaignId: string,
  role: MarketingCampaignRole,
  db: Db = prisma
): Promise<{ memberId: string }> {
  if (!actor) abort("unauthenticated");
  if (actor.isFounder) abort("founder_excluded");
  const access = await campaignAccess(actor, campaignId, db);
  if (!access.canView) abort("not_found");
  if (!access.roles.has(role)) abort("forbidden", { role });
  const memberId = await ensureMemberId(actor, db);
  if (!memberId) abort("forbidden", { role });
  return { memberId };
}

/** شرطُ الرؤية في الاستعلامات: ما عُيِّن فيه — أو كلُّها لقائد التسويق، وما قُدّمت خطتُه لمعتمِديها */
export function visibleCampaignsWhere(actor: MkActor): Prisma.MarketingCampaignWhereInput {
  if (actor.isFounder) return { id: "__none__" };
  if (actor.isMarketingLead) return {};
  const ors: Prisma.MarketingCampaignWhereInput[] = [];
  if (actor.member) {
    ors.push({ members: { some: { memberId: actor.member.id, role: { in: actor.member.capabilities.filter(isCampaignRole) } } } });
  }
  if (actor.planStage) ors.push({ currentPlanVersionId: { not: null } });
  return ors.length ? { OR: ors } : { id: "__none__" };
}

export function isCampaignRole(c: MarketingCapability): c is MarketingCampaignRole {
  return c !== "manager";
}
