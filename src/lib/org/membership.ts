import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { appendMemberEvent } from "@/lib/googleSheets";
import { revokeAccess } from "@/lib/accessRevocation";
import { fail, recordOrgEvent, type OrgResult } from "./audit";
import { assertTopActor } from "./departmentLeadership";
import { succeedInTx } from "./committeeLeadership";

/** **حالاتُ العضوية وإنهاؤها** (المرحلة الثالثة، المتطلب الثالث) — للمؤسس والرئيس التنفيذي وحدهما.
 *
 *  - **نشط:** يدخل ويعمل.
 *  - **موقوفٌ مؤقتاً** (`suspendedAt`): لا دخول، وتُخلَف قيادةُ لجانه العاملة؛ ويُرفع الإيقافُ بإعادة التفعيل.
 *  - **مغادر** (`terminatedAt`): نهائيّ — لا يعود إلا بانضمامٍ جديدٍ موثَّق، ولا بابَ في المنصة يعيد تفعيله.
 *
 *  و«إنهاءُ العضوية وإزالةُ الوصول» يُعرض أثرُه قبل وقوعه، ولا يقع والعملُ المفتوحُ بلا وجهة: يُسمّى بديلٌ
 *  يتسلّمه. ثم في معاملةٍ واحدة: يُعطَّل الحساب، وتُبطَل الجلساتُ ورموزُ الدخول وروابطُ الاستعادة، وتُنهى
 *  عضوياتُ اللجان والنيابة، وتُخلَف قيادةُ لجانه، وتُسقط دعواتُه المعلّقة، ويُسجَّل كلُّ ذلك.
 *  **ولا يُحذف شيء:** إنجازاتُه ومهامُّه السابقة واعتماداتُه وتوقيعاتُه ومشاركاتُه وسجلّاتُه وصفُّه في الشيت
 *  باقيةٌ باسمه — يظهر فيها «مغادراً» لا عضواً نشطاً، ولا يتغيّر صاحبُ إجراءٍ تاريخي. */

export type MemberState = "active" | "suspended" | "departed" | "inactive";

export function memberState(m: { isActive: boolean; terminatedAt: Date | null; suspendedAt?: Date | null; approvalStatus?: string }): MemberState {
  if (m.terminatedAt) return "departed";
  if (m.suspendedAt) return "suspended";
  if (m.isActive && (m.approvalStatus ?? "approved") === "approved") return "active";
  return "inactive";
}

const OPEN_PLAN_STATES = ["not_started", "in_progress", "submitted", "returned"] as const;

type Db = Prisma.TransactionClient | typeof prisma;

async function openWork(db: Db, memberId: string, email: string) {
  const [committeeTasks, planTasks, tickets, marketingTasks, invites] = await Promise.all([
    db.committeeTask.findMany({
      where: { assigneeMemberId: memberId, status: { in: ["todo", "in_progress"] } },
      select: { id: true, title: true, committeeId: true, committee: { select: { name: true } } },
      take: 200,
    }),
    db.planTask.findMany({
      where: { ownerMemberId: memberId, execState: { in: [...OPEN_PLAN_STATES] } },
      select: { id: true, title: true },
      take: 200,
    }),
    db.ticket.count({ where: { targetMemberId: memberId, status: { not: "resolved" } } }),
    db.marketingTask.count({ where: { assignee: { memberId }, status: { in: ["todo", "in_progress", "blocked"] } } }),
    db.invite.count({ where: { email, status: "open" } }),
  ]);
  return { committeeTasks, planTasks, tickets, marketingTasks, invites };
}

/** ما يُعرض قبل التأكيد: الحالة، والقسم، واللجان، والنيابة، والعملُ المفتوح، ومن يصلح بديلاً */
export async function membershipExitPreview(actorId: string, memberId: string) {
  if (!(await assertTopActor(actorId))) return null;
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true, fullName: true, email: true, isActive: true, terminatedAt: true, suspendedAt: true, suspendedReason: true,
      approvalStatus: true, departmentId: true, department: { select: { name: true } },
      deputyOf: { select: { id: true, name: true, deputyPermissions: true } },
      committeeMemberships: { where: { active: true }, select: { committee: { select: { id: true, name: true, leadMemberId: true, committeeStatus: true } } } },
    },
  });
  if (!m) return null;
  const leaderAccount = !!(await prisma.user.findFirst({ where: { email: m.email, isActive: true }, select: { id: true } }));
  const work = await openWork(prisma, m.id, m.email);
  const candidates = m.departmentId
    ? await prisma.member.findMany({
        where: { ...ROSTER_MEMBER_WHERE, terminatedAt: null, suspendedAt: null, departmentId: m.departmentId, id: { not: m.id } },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
        take: 300,
      })
    : [];
  return {
    member: { ...m, state: memberState(m) },
    leaderAccount,
    committees: m.committeeMemberships.map((x) => ({ ...x.committee, leads: x.committee.leadMemberId === m.id })),
    work,
    openCount: work.committeeTasks.length + work.planTasks.length + work.tickets + work.marketingTasks,
    candidates,
  };
}

type ExitInput = { reason: string; replacementMemberId?: string | null; confirm: boolean };

/** **إنهاءُ العضوية وإزالةُ الوصول** */
export async function terminateMembership(actorId: string, memberId: string, input: ExitInput): Promise<OrgResult<{ summary: Record<string, number> }>> {
  const actor = await assertTopActor(actorId);
  if (!actor) return fail("إنهاءُ العضوية وإزالةُ الوصول للمؤسس والرئيس التنفيذي وحدهما");
  if (!input.confirm) return fail("أكِّد العملية أولاً — يُعرض أثرُها قبل تنفيذها");
  const why = input.reason?.trim().slice(0, 300);
  if (!why) return fail("سببُ الإنهاء مطلوب");
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, fullName: true, email: true, isActive: true, terminatedAt: true, suspendedAt: true, approvalStatus: true, departmentId: true },
  });
  if (!m) return fail("العضو غير موجود");
  if (m.terminatedAt) return fail("هذا العضوُ مغادرٌ بالفعل — المغادرةُ نهائية");
  if (await prisma.user.findFirst({ where: { email: m.email, isActive: true }, select: { id: true } })) {
    return fail("هذا حسابٌ قياديّ — يُغيَّر قائدُ القسم أولاً (فيعود عضواً)، أو يُنحّى من صفحة الحسابات");
  }
  const work = await openWork(prisma, m.id, m.email);
  const open = work.committeeTasks.length + work.planTasks.length + work.tickets + work.marketingTasks;
  let replacement: { id: string; fullName: string } | null = null;
  if (input.replacementMemberId) {
    replacement = await prisma.member.findFirst({
      where: { id: input.replacementMemberId, ...ROSTER_MEMBER_WHERE, terminatedAt: null, suspendedAt: null, departmentId: m.departmentId ?? "—", NOT: { id: m.id } },
      select: { id: true, fullName: true },
    });
    if (!replacement) return fail("البديلُ عضوٌ نشطٌ معتمدٌ في القسم نفسه");
  }
  if (open > 0 && !replacement) {
    return fail(`لا يُنهى والعملُ المفتوحُ بلا وجهة — عيّن بديلاً يتسلّم ${open} بنداً مفتوحاً`);
  }

  const now = new Date();
  const summary = { committeeMemberships: 0, committeesSucceeded: 0, committeeTasks: 0, planTasks: 0, tickets: 0, marketingTasks: 0, invites: 0, codes: 0, deputy: 0 };
  const moves: { committeeTasks: { id: string; to: string | null }[] } = { committeeTasks: [] };
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${m.id} FOR UPDATE`;
    // الحرسُ في `where`: إنهاءان متزامنان لا يقعان مرّتين
    const w = await tx.member.updateMany({
      where: { id: m.id, terminatedAt: null },
      data: { isActive: false, terminatedAt: now, exitReason: why },
    });
    if (!w.count) throw new Error("أُنهيت عضويتُه للتوّ");

    // ── النيابة
    const dep = await tx.department.findFirst({ where: { deputyMemberId: m.id }, select: { id: true, deputyPermissions: true } });
    if (dep) {
      await tx.department.update({
        where: { id: dep.id },
        data: { deputyMemberId: null, deputyPermissions: [], deputyAppointedAt: null, deputyAppointedByName: null },
      });
      await recordOrgEvent(tx, {
        scope: "department", entityId: dep.id, departmentId: dep.id, action: "department.deputy_revoked", actor,
        before: { deputyMemberId: m.id, deputyName: m.fullName, permissions: dep.deputyPermissions },
        after: { deputyMemberId: null, permissions: [] }, note: "إنهاء العضوية وإزالة الوصول",
      });
      for (const p of dep.deputyPermissions) {
        await recordOrgEvent(tx, {
          scope: "department", entityId: dep.id, departmentId: dep.id, action: "department.deputy_permission_revoked", actor,
          before: { deputyMemberId: m.id, permission: p, permissions: dep.deputyPermissions },
          after: { deputyMemberId: m.id, permission: p, permissions: [] }, note: "إنهاء العضوية وإزالة الوصول",
        });
      }
      summary.deputy = 1;
    }

    // ── اللجان: تُخلَف قيادتُه، وتُنهى عضوياتُه (تُغلق ولا تُحذف)
    // department-scope: all — كلُّ لجنةٍ يقودها
    const led = await tx.department.findMany({ where: { leadMemberId: m.id, parentId: { not: null } }, select: { id: true } });
    for (const c of led) {
      const r = await succeedInTx(tx, c.id, { reason: `إنهاء عضوية القائد — ${why}`, source: "automatic", byName: actor.name });
      if (r.changed) summary.committeesSucceeded++;
    }
    summary.committeeMemberships = (await tx.committeeMembership.updateMany({
      where: { memberId: m.id, active: true },
      data: { active: false, removedAt: now, removedByName: actor.name },
    })).count;

    // ── العملُ المفتوح إلى البديل — ومهامُّ اللجان لمن يصلح لها في لجنتها
    for (const t of work.committeeTasks) {
      let to: string | null = null;
      if (replacement) {
        const inIt = await tx.committeeMembership.findFirst({ where: { committeeId: t.committeeId, memberId: replacement.id, active: true }, select: { id: true } });
        if (inIt) to = replacement.id;
      }
      if (!to) {
        const c = await tx.department.findUnique({ where: { id: t.committeeId }, select: { leadMemberId: true } });
        to = c?.leadMemberId && c.leadMemberId !== m.id ? c.leadMemberId : null;
      }
      await tx.committeeTask.update({ where: { id: t.id }, data: { assigneeMemberId: to } });
      moves.committeeTasks.push({ id: t.id, to });
    }
    summary.committeeTasks = work.committeeTasks.length;
    if (replacement) {
      summary.planTasks = (await tx.planTask.updateMany({
        where: { ownerMemberId: m.id, execState: { in: [...OPEN_PLAN_STATES] } },
        data: { ownerMemberId: replacement.id },
      })).count;
      summary.tickets = (await tx.ticket.updateMany({
        where: { targetMemberId: m.id, status: { not: "resolved" } },
        data: { targetMemberId: replacement.id },
      })).count;
    }
    // التسويق: يُوقف ملفُّه، وتنتقل مهامُّه إلى ملفّ البديل إن كان في الفريق، وإلا إلى قائد التسويق
    const profile = await tx.marketingMember.findUnique({ where: { memberId: m.id }, select: { id: true } });
    if (profile) {
      const target =
        (replacement && (await tx.marketingMember.findFirst({ where: { memberId: replacement.id, active: true }, select: { id: true } }))) ||
        (await tx.marketingMember.findFirst({
          where: { active: true, user: { is: { isActive: true, role: "department_admin", department: { is: { slug: "marketing" } } } } },
          select: { id: true },
        }));
      summary.marketingTasks = (await tx.marketingTask.updateMany({
        where: { assigneeId: profile.id, status: { in: ["todo", "in_progress", "blocked"] } },
        data: { assigneeId: target?.id ?? null },
      })).count;
      await tx.marketingMember.update({ where: { id: profile.id }, data: { active: false, nameSnapshot: m.fullName } });
    }

    // ── الوصول: الدعواتُ المعلّقة تسقط، ورموزُ الدخول وروابطُ الاستعادة تُستهلك، والجلساتُ تُبطَل
    summary.invites = (await tx.invite.updateMany({ where: { email: m.email, status: "open" }, data: { status: "expired" } })).count;
    summary.codes =
      (await tx.loginCode.updateMany({ where: { email: m.email, usedAt: null }, data: { usedAt: now } })).count +
      (await tx.passwordResetToken.updateMany({ where: { email: m.email, usedAt: null }, data: { usedAt: now } })).count;
    await revokeAccess(tx, { accountKind: "member", accountId: m.id, reason: `إنهاء العضوية — ${why}`, byName: actor.name });

    await recordOrgEvent(tx, {
      scope: "member", entityId: m.id, departmentId: m.departmentId ?? "—", action: "member.terminated", actor,
      before: { state: memberState(m), departmentId: m.departmentId, committees: led.map((c) => c.id) },
      after: {
        state: "departed",
        replacement: replacement ? { id: replacement.id, name: replacement.fullName } : null,
        moved: { ...summary, committeeTaskDestinations: moves.committeeTasks },
        at: now.toISOString(),
      },
      note: why,
    });
  });

  try {
    const { syncMemberLifecycleRow } = await import("@/lib/workflow");
    await syncMemberLifecycleRow(m.id);
    await appendMemberEvent({
      fullName: m.fullName, email: m.email, event: "إنهاء العضوية وإزالة الوصول", roleOrDepartment: "—",
      details: `السبب: ${why} — البديل: ${replacement?.fullName ?? "—"} — نفّذه: ${actor.name}`, at: now,
    });
  } catch {
    /* المزامنةُ التالية تُكمل */
  }
  return { ok: true, summary };
}

/** إيقافٌ مؤقت: لا دخول، وتُخلَف قيادةُ لجانه العاملة — ويبقى كلُّ ما عداه حتى يُرفع الإيقاف */
export async function suspendMember(actorId: string, memberId: string, reason: string): Promise<OrgResult> {
  const actor = await assertTopActor(actorId);
  if (!actor) return fail("الإيقافُ المؤقت للمؤسس والرئيس التنفيذي وحدهما");
  const why = reason?.trim().slice(0, 300);
  if (!why) return fail("سببُ الإيقاف مطلوب");
  const m = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, fullName: true, email: true, isActive: true, terminatedAt: true, suspendedAt: true, departmentId: true } });
  if (!m) return fail("العضو غير موجود");
  if (m.terminatedAt) return fail("هذا العضوُ مغادر — لا يُوقف ولا يُعاد");
  if (m.suspendedAt) return fail("هذا العضوُ موقوفٌ بالفعل");
  if (!m.isActive) return fail("الحسابُ غيرُ نشط");
  if (await prisma.user.findFirst({ where: { email: m.email, isActive: true }, select: { id: true } })) return fail("هذا حسابٌ قياديّ — يُدار من صفحة الحسابات");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const w = await tx.member.updateMany({ where: { id: m.id, terminatedAt: null, suspendedAt: null }, data: { isActive: false, suspendedAt: now, suspendedReason: why } });
    if (!w.count) throw new Error("تغيّرت حالتُه للتوّ");
    // department-scope: all — لجانٌ يقودها: حسابٌ معطَّلٌ لا يقود
    const led = await tx.department.findMany({ where: { leadMemberId: m.id, parentId: { not: null } }, select: { id: true } });
    for (const c of led) await succeedInTx(tx, c.id, { reason: `إيقافٌ مؤقتٌ للقائد — ${why}`, source: "automatic", byName: actor.name });
    await tx.loginCode.updateMany({ where: { email: m.email, usedAt: null }, data: { usedAt: now } });
    await tx.passwordResetToken.updateMany({ where: { email: m.email, usedAt: null }, data: { usedAt: now } });
    await revokeAccess(tx, { accountKind: "member", accountId: m.id, reason: `إيقاف مؤقت — ${why}`, byName: actor.name });
    await recordOrgEvent(tx, {
      scope: "member", entityId: m.id, departmentId: m.departmentId ?? "—", action: "member.suspended", actor,
      before: { state: "active" }, after: { state: "suspended", committeesSucceeded: led.map((c) => c.id) }, note: why,
    });
  });
  return { ok: true };
}

/** رفعُ الإيقاف — للموقوف وحده، **ولا يعود به مغادر**. وقيادةُ لجنةٍ خُلفت لا تعود آلياً */
export async function reinstateMember(actorId: string, memberId: string, note?: string | null): Promise<OrgResult> {
  const actor = await assertTopActor(actorId);
  if (!actor) return fail("إعادةُ التفعيل للمؤسس والرئيس التنفيذي وحدهما");
  const m = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, terminatedAt: true, suspendedAt: true, departmentId: true } });
  if (!m) return fail("العضو غير موجود");
  if (m.terminatedAt) return fail("المغادرُ لا يُعاد — بابُه انضمامٌ جديدٌ موثَّق");
  if (!m.suspendedAt) return fail("هذا العضوُ ليس موقوفاً");
  await prisma.$transaction(async (tx) => {
    const w = await tx.member.updateMany({ where: { id: m.id, terminatedAt: null, suspendedAt: { not: null } }, data: { isActive: true, suspendedAt: null, suspendedReason: null } });
    if (!w.count) throw new Error("تغيّرت حالتُه للتوّ");
    await recordOrgEvent(tx, {
      scope: "member", entityId: m.id, departmentId: m.departmentId ?? "—", action: "member.reinstated", actor,
      before: { state: "suspended" }, after: { state: "active" }, note: note?.trim().slice(0, 200) ?? null,
    });
  });
  return { ok: true };
}
