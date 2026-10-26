import type { MarketingCapability } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { hasCapability, type MkActor } from "./access";
import { logEvent } from "./audit";
import { abort, fail, guarded, type MkResult } from "./result";

/** فريقُ التسويق: من فيه، وماذا يحمل كلٌّ منهم، وإعداداتُ الاعتماد.
 *
 *  **قواعدُ لا تُتجاوز:**
 *  - لا يُضيف ولا يعدّل إلا مديرُ الفريق (المؤسس ضمناً، ومن منحه المؤسسُ `manager`).
 *  - `manager` نفسُها لا يمنحها إلا المؤسس.
 *  - المديرُ غيرُ المؤسس لا يعدّل مسؤولياته هو — لا يرفع أحدٌ صلاحيته بيده.
 *  - وإضعافُ سياسة فصل الاعتماد قرارُ المؤسس وحده. */

export const CAPABILITIES: MarketingCapability[] = ["coordinator", "writer", "designer", "reviewer", "publisher", "manager"];

const TEAM_TAKE = 200;

export async function listTeam(actor: MkActor) {
  if (!hasCapability(actor, "manager")) return null;
  const rows = await prisma.marketingMember.findMany({
    orderBy: { createdAt: "asc" },
    take: TEAM_TAKE,
    select: {
      id: true,
      active: true,
      capabilities: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, email: true, role: true, isActive: true } },
      member: { select: { id: true, fullName: true, email: true, isActive: true, terminatedAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    active: r.active,
    capabilities: r.capabilities,
    createdAt: r.createdAt,
    kind: (r.user ? "user" : "member") as "user" | "member",
    fullName: r.user?.fullName ?? r.member?.fullName ?? "—",
    email: r.user?.email ?? r.member?.email ?? "",
    accountLive: r.user ? r.user.isActive : !!r.member && r.member.isActive && !r.member.terminatedAt,
  }));
}

/** من يمكن إضافتُه: حساباتٌ إداريةٌ نشطة وأعضاءٌ معتمدون — ممن ليسوا في الفريق */
export async function eligiblePeople(actor: MkActor) {
  if (!hasCapability(actor, "manager")) return null;
  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, marketingProfile: null },
      orderBy: { fullName: "asc" },
      take: TEAM_TAKE,
      select: { id: true, fullName: true, email: true, role: true, department: { select: { name: true } } },
    }),
    prisma.member.findMany({
      where: { ...ROSTER_MEMBER_WHERE, terminatedAt: null, marketingProfile: null },
      orderBy: { fullName: "asc" },
      take: TEAM_TAKE,
      select: { id: true, fullName: true, email: true, department: { select: { name: true } } },
    }),
  ]);
  return [
    ...users.map((u) => ({ kind: "user" as const, id: u.id, fullName: u.fullName, email: u.email, role: u.role, department: u.department?.name ?? null })),
    ...members.map((m) => ({ kind: "member" as const, id: m.id, fullName: m.fullName, email: m.email, role: "member" as const, department: m.department?.name ?? null })),
  ];
}

function cleanCaps(input: string[]): MarketingCapability[] {
  return [...new Set(input)].filter((c): c is MarketingCapability => (CAPABILITIES as string[]).includes(c));
}

function grantAllowed(actor: MkActor, caps: MarketingCapability[], targetIsSelf: boolean) {
  if (!hasCapability(actor, "manager")) abort("forbidden", { role: "manager" });
  if (caps.includes("manager") && !actor.isFounder) abort("forbidden", { role: "founder" });
  if (targetIsSelf && !actor.isFounder) abort("self_escalation");
}

export async function addTeamMember(
  actor: MkActor,
  input: { kind: "user" | "member"; id: string; capabilities: string[] }
): Promise<MkResult<{ memberId: string }>> {
  return guarded(async () => {
    const caps = cleanCaps(input.capabilities);
    if (caps.length === 0) return fail("invalid_input", { field: "capabilities" });
    const isSelf = input.kind === actor.kind && input.id === actor.principalId;
    grantAllowed(actor, caps, isSelf);

    const principal =
      input.kind === "user"
        ? await prisma.user.findFirst({ where: { id: input.id, isActive: true }, select: { id: true, fullName: true } })
        : await prisma.member.findFirst({
            where: { id: input.id, ...ROSTER_MEMBER_WHERE, terminatedAt: null },
            select: { id: true, fullName: true },
          });
    if (!principal) return fail("not_found");

    return prisma.$transaction(async (tx) => {
      const exists = await tx.marketingMember.findUnique({
        where: input.kind === "user" ? { userId: input.id } : { memberId: input.id },
        select: { id: true },
      });
      if (exists) abort("already_member");
      const row = await tx.marketingMember.create({
        data: {
          ...(input.kind === "user" ? { userId: input.id } : { memberId: input.id }),
          capabilities: caps,
          addedByName: actor.name,
        },
        select: { id: true },
      });
      await logEvent(tx, actor, {
        action: "team.member_added",
        details: { marketingMemberId: row.id, name: principal.fullName, kind: input.kind, capabilities: caps },
      });
      return { ok: true as const, memberId: row.id };
    });
  });
}

async function targetOf(marketingMemberId: string) {
  return prisma.marketingMember.findUnique({
    where: { id: marketingMemberId },
    select: {
      id: true,
      capabilities: true,
      active: true,
      userId: true,
      memberId: true,
      user: { select: { fullName: true } },
      member: { select: { fullName: true } },
    },
  });
}

const isSelfTarget = (actor: MkActor, t: { userId: string | null; memberId: string | null }) =>
  actor.kind === "user" ? t.userId === actor.principalId : t.memberId === actor.principalId;

export async function setCapabilities(actor: MkActor, marketingMemberId: string, capabilities: string[]): Promise<MkResult> {
  return guarded(async () => {
    const target = await targetOf(marketingMemberId);
    if (!target) return fail("not_found");
    const caps = cleanCaps(capabilities);
    grantAllowed(actor, caps, isSelfTarget(actor, target));
    // سحبُ `manager` من أحدٍ قرارُ المؤسس أيضاً
    if (target.capabilities.includes("manager") && !caps.includes("manager") && !actor.isFounder) {
      return fail("forbidden", { role: "founder" });
    }
    await prisma.$transaction(async (tx) => {
      await tx.marketingMember.update({ where: { id: target.id }, data: { capabilities: caps } });
      await logEvent(tx, actor, {
        action: "team.capabilities_changed",
        details: {
          marketingMemberId: target.id,
          name: target.user?.fullName ?? target.member?.fullName ?? "—",
          from: target.capabilities,
          to: caps,
        },
      });
    });
    return { ok: true };
  });
}

export async function setMemberActive(actor: MkActor, marketingMemberId: string, active: boolean): Promise<MkResult> {
  return guarded(async () => {
    const target = await targetOf(marketingMemberId);
    if (!target) return fail("not_found");
    grantAllowed(actor, target.capabilities, isSelfTarget(actor, target));
    if (target.active === active) return { ok: true };
    await prisma.$transaction(async (tx) => {
      await tx.marketingMember.update({ where: { id: target.id }, data: { active } });
      await logEvent(tx, actor, {
        action: active ? "team.member_reactivated" : "team.member_deactivated",
        details: { marketingMemberId: target.id, name: target.user?.fullName ?? target.member?.fullName ?? "—" },
      });
    });
    return { ok: true };
  });
}

export async function marketingSettings() {
  const row = await prisma.marketingSettings.findUnique({ where: { id: "default" } });
  return { requireSeparateApprover: row?.requireSeparateApprover ?? true };
}

export async function updateSettings(actor: MkActor, input: { requireSeparateApprover: boolean }): Promise<MkResult> {
  // إضعافُ فصل الاعتماد يغيّر من يعتمد ماذا — قرارُ المؤسس وحده
  if (!actor.isFounder) return fail("forbidden", { role: "founder" });
  const before = await marketingSettings();
  await prisma.$transaction(async (tx) => {
    await tx.marketingSettings.upsert({
      where: { id: "default" },
      update: { requireSeparateApprover: input.requireSeparateApprover, updatedByName: actor.name },
      create: { id: "default", requireSeparateApprover: input.requireSeparateApprover, updatedByName: actor.name },
    });
    await logEvent(tx, actor, { action: "settings.changed", details: { from: before, to: input } });
  });
  return { ok: true };
}
