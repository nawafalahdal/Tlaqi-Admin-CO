import type { Session } from "next-auth";
import type { MarketingCampaignRole, MarketingCapability, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { abort } from "./result";

/** **من يدخل وكيلَ التسويق، وماذا يفعل فيه — يُحسب في الخادم في كل طلب.**
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
 *  **والمؤسسُ وحده يدير الفريق ضمناً** — وإلا لم يُمنح أحدٌ شيئاً أبداً. وإدارةُ
 *  الفريق لا تمنح اعتماداً ولا نشراً: من أراد أن يكتب أو يعتمد فليُعيَّن كغيره. */

type Db = Prisma.TransactionClient | typeof prisma;

export type MkActor = {
  kind: "user" | "member";
  principalId: string;
  name: string;
  isFounder: boolean;
  /** عضويتُه الفعّالة في الفريق — `null` لمن ليس عضواً أو أُوقف هو أو حسابُه */
  member: { id: string; capabilities: MarketingCapability[] } | null;
};

export async function marketingActor(session: Session | null, db: Db = prisma): Promise<MkActor | null> {
  if (!session?.user?.id) return null;
  const isMember = session.user.role === "member";
  const row = await db.marketingMember.findUnique({
    where: isMember ? { memberId: session.user.id } : { userId: session.user.id },
    select: {
      id: true,
      active: true,
      capabilities: true,
      user: { select: { isActive: true } },
      member: { select: { isActive: true, terminatedAt: true } },
    },
  });
  // الحسابُ المعطَّل أو المنتهية عضويتُه لا يحمل شيئاً في الفريق
  const principalLive = row
    ? row.user
      ? row.user.isActive
      : !!row.member && row.member.isActive && !row.member.terminatedAt
    : false;
  return {
    kind: isMember ? "member" : "user",
    principalId: session.user.id,
    name: session.user.name ?? "—",
    isFounder: session.user.role === "super_admin",
    member: row && row.active && principalLive ? { id: row.id, capabilities: row.capabilities } : null,
  };
}

export function hasCapability(actor: MkActor | null, cap: MarketingCapability): boolean {
  if (!actor) return false;
  if (cap === "manager" && actor.isFounder) return true;
  return !!actor.member && actor.member.capabilities.includes(cap);
}

/** هل يُرسَم له الوكيلُ أصلاً — القائمةُ والصفحاتُ تسأل هذا، والخادمُ يسأله قبلها */
export function canEnterMarketing(actor: MkActor | null): boolean {
  if (!actor) return false;
  if (actor.isFounder) return true;
  return !!actor.member && actor.member.capabilities.length > 0;
}

export type CampaignAccess = {
  /** يرى الحملة: مُعيَّنٌ فيها، أو مديرٌ للفريق يطّلع ولا يعمل */
  canView: boolean;
  /** مسؤولياتُه الفعّالة فيها */
  roles: Set<MarketingCampaignRole>;
};

export async function campaignAccess(actor: MkActor | null, campaignId: string, db: Db = prisma): Promise<CampaignAccess> {
  const roles = new Set<MarketingCampaignRole>();
  if (!actor) return { canView: false, roles };
  if (actor.member) {
    const rows = await db.marketingCampaignMember.findMany({
      where: { campaignId, memberId: actor.member.id },
      select: { role: true },
    });
    for (const r of rows) if (actor.member.capabilities.includes(r.role)) roles.add(r.role);
  }
  return { canView: roles.size > 0 || hasCapability(actor, "manager"), roles };
}

/** داخل عملية: المنفّذ يملك هذه المسؤولية في هذه الحملة، وإلا أُلغيت العملية */
export async function requireCampaignRole(
  actor: MkActor | null,
  campaignId: string,
  role: MarketingCampaignRole,
  db: Db = prisma
): Promise<{ memberId: string }> {
  if (!actor) abort("unauthenticated");
  const access = await campaignAccess(actor, campaignId, db);
  if (!access.canView) abort("not_found");
  if (!access.roles.has(role) || !actor.member) abort("forbidden", { role });
  return { memberId: actor.member.id };
}

/** شرطُ الرؤية في الاستعلامات: الحملاتُ التي عُيِّن فيها — أو كلُّها لمدير الفريق */
export function visibleCampaignsWhere(actor: MkActor): Prisma.MarketingCampaignWhereInput {
  if (hasCapability(actor, "manager")) return {};
  if (!actor.member) return { id: "__none__" };
  return {
    members: { some: { memberId: actor.member.id, role: { in: actor.member.capabilities.filter(isCampaignRole) } } },
  };
}

export function isCampaignRole(c: MarketingCapability): c is MarketingCampaignRole {
  return c !== "manager";
}
