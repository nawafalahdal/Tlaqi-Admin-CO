import type { CommitteeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import {
  canManageCommitteesOf,
  canViewDepartmentMembers,
  canViewDepartmentOverview,
  canViewDepartmentTasks,
  canAssignResponsibilities,
  canAppointDeputy,
  type OrgActor,
} from "./actor";
import { committeeContext } from "./committeeWork";
import { departmentPeopleWhere, STATUS_TRANSITIONS } from "./committeeService";

/** صفحاتُ اللجان والقسم — قراءاتٌ محدودةٌ بما يحقّ لصاحبها، ومقسّمةٌ إلى صفحات.
 *
 *  **الحدُّ في الاستعلام لا بعد الجلب:** من لا يحقّ له رؤيةُ لجنةٍ لا تُجلَب أصلاً.
 *  والعدّاداتُ لصفحةٍ واحدة بتجميعٍ واحد (`groupBy`) لا باستعلامٍ لكل لجنة. */

export const COMMITTEE_PAGE = 20;
export const COMMITTEE_STATUSES: CommitteeStatus[] = [
  "draft", "pending_review", "awaiting_lead", "approved", "suspended", "completed", "closed", "archived", "rejected",
];
/** ما يراه عضوُ اللجنة غيرُ المدير: ما اعتُمد وما بعده — لا المسودّةُ ولا الطلب */
const MEMBER_VISIBLE: CommitteeStatus[] = ["awaiting_lead", "approved", "suspended", "completed", "closed", "archived"];
const OPEN_TASK: Prisma.EnumCommitteeTaskStatusFilter = { in: ["todo", "in_progress"] };

/** اللجانُ التي يراها صاحبُ الطلب — أو `null` إن لم يكن له شيءٌ منها */
export function visibleCommitteesWhere(a: OrgActor | null): Prisma.DepartmentWhereInput | null {
  if (!a?.role) return null;
  const base: Prisma.DepartmentWhereInput = { parentId: { not: null }, committeeStatus: { not: null } };
  if (a.isTop || a.isOps) return base;
  const ors: Prisma.DepartmentWhereInput[] = [];
  if (a.leadsDepartmentId) ors.push({ parentId: a.leadsDepartmentId });
  if (a.deputy) ors.push({ parentId: a.deputy.departmentId });
  if (a.kind === "member") {
    ors.push({
      committeeStatus: { in: MEMBER_VISIBLE },
      OR: [{ leadMemberId: a.id }, { committeeMemberships: { some: { memberId: a.id, active: true } } }],
    });
  }
  return ors.length ? { ...base, OR: ors } : null;
}

/** ما يظهر من أعمال اللجان في التقويم الموحَّد — بالحدود نفسِها.
 *
 *  الاجتماعاتُ: لكل من يرى اللجنة (والعضوُ لجانَه وحدها). والمهامُّ أضيق:
 *  للعضو ما أُسند إليه أو ما في لجنةٍ يقودها، ولمن يتابع مهامَّ القسم مهامُّ
 *  لجانه — لا أن يرى كلُّ عضوٍ مهامَّ زملائه في التقويم. */
export function committeeCalendarWhere(a: OrgActor | null): {
  meetings: Prisma.CommitteeMeetingWhereInput;
  tasks: Prisma.CommitteeTaskWhereInput;
} | null {
  const visible = visibleCommitteesWhere(a);
  if (!a || !visible) return null;
  const working: Prisma.DepartmentWhereInput = { AND: [visible, { committeeStatus: { in: ["approved", "suspended", "completed"] } }] };
  const taskOrs: Prisma.CommitteeTaskWhereInput[] = [];
  if (a.isTop || a.isOps) taskOrs.push({ committee: working });
  if (a.leadsDepartmentId) taskOrs.push({ committee: { parentId: a.leadsDepartmentId } });
  if (a.deputy?.permissions.includes("tasks_view")) taskOrs.push({ committee: { parentId: a.deputy.departmentId } });
  if (a.kind === "member") {
    taskOrs.push({ assigneeMemberId: a.id }, { committee: { leadMemberId: a.id } });
  }
  return {
    meetings: { committee: working, status: { not: "cancelled" } },
    tasks: taskOrs.length ? { AND: [{ committee: working }, { OR: taskOrs }] } : { id: "__none__" },
  };
}

export type CommitteeStats = { members: number; open: number; overdue: number; done: number; total: number; progress: number | null };

/** إحصاءُ مجموعةٍ من اللجان دفعةً واحدة */
export async function committeeStats(ids: string[]): Promise<Map<string, CommitteeStats>> {
  const out = new Map<string, CommitteeStats>();
  if (!ids.length) return out;
  const now = new Date();
  const [members, byStatus, overdue] = await Promise.all([
    prisma.committeeMembership.groupBy({ by: ["committeeId"], where: { committeeId: { in: ids }, active: true }, _count: { _all: true } }),
    prisma.committeeTask.groupBy({ by: ["committeeId", "status"], where: { committeeId: { in: ids } }, _count: { _all: true } }),
    prisma.committeeTask.groupBy({
      by: ["committeeId"],
      where: { committeeId: { in: ids }, status: OPEN_TASK, dueAt: { lt: now } },
      _count: { _all: true },
    }),
  ]);
  for (const id of ids) out.set(id, { members: 0, open: 0, overdue: 0, done: 0, total: 0, progress: null });
  for (const m of members) out.get(m.committeeId)!.members = m._count._all;
  for (const r of byStatus) {
    const s = out.get(r.committeeId)!;
    if (r.status === "cancelled") continue;
    s.total += r._count._all;
    if (r.status === "done") s.done += r._count._all;
    else s.open += r._count._all;
  }
  for (const o of overdue) out.get(o.committeeId)!.overdue = o._count._all;
  for (const s of out.values()) s.progress = s.total ? Math.round((s.done / s.total) * 100) : null;
  return out;
}

export async function listCommittees(
  actor: OrgActor | null,
  f: { status?: string; leadMemberId?: string; q?: string; departmentId?: string; page?: number }
) {
  const visible = visibleCommitteesWhere(actor);
  if (!visible) return null;
  const and: Prisma.DepartmentWhereInput[] = [visible];
  if (f.status && COMMITTEE_STATUSES.includes(f.status as CommitteeStatus)) and.push({ committeeStatus: f.status as CommitteeStatus });
  if (f.leadMemberId) and.push({ leadMemberId: f.leadMemberId });
  if (f.departmentId) and.push({ parentId: f.departmentId });
  const q = f.q?.trim();
  if (q) and.push({ name: { contains: q.slice(0, 80), mode: "insensitive" } });
  const where: Prisma.DepartmentWhereInput = { AND: and };
  const total = await prisma.department.count({ where });
  const pages = Math.max(1, Math.ceil(total / COMMITTEE_PAGE));
  const page = Math.min(pages, Math.max(1, f.page ?? 1));
  // department-scope: all — سجلُّ اللجان بكل حالاتها (المسودّة والمغلقة والمؤرشفة)، محدودٌ بـ`visibleCommitteesWhere`
  const rows = await prisma.department.findMany({
    where,
    orderBy: [{ statusChangedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    skip: (page - 1) * COMMITTEE_PAGE,
    take: COMMITTEE_PAGE,
    select: {
      id: true, name: true, committeeStatus: true, committeeKind: true, startDate: true, endDate: true,
      parent: { select: { id: true, name: true, colorHex: true } },
      leadMember: { select: { id: true, fullName: true, isActive: true } },
      actingLeadUser: { select: { fullName: true } },
      admins: { where: { isActive: true, role: "department_admin" }, select: { fullName: true }, take: 1 },
    },
  });
  const stats = await committeeStats(rows.map((r) => r.id));
  // قائمةُ القادة للتصفية: من يقود لجنةً مما يراه — لا كلُّ أعضاء المنصة
  const leads = await prisma.member.findMany({
    where: { committeesLed: { some: visible } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 100,
  });
  // department-scope: all — أقسامُ التصفية لمن يرى أكثر من قسم (المؤسس والرئيس التنفيذي ومسؤول التشغيل)
  const departments =
    actor!.isTop || actor!.isOps
      ? await prisma.department.findMany({
          where: { parentId: null, committeeStatus: null, leadershipOnly: false },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 100,
        })
      : [];
  return {
    rows: rows.map((r) => ({ ...r, legacyLeadName: r.leadMember ? null : r.admins[0]?.fullName ?? null, stats: stats.get(r.id)! })),
    total, page, pages, leads, departments,
  };
}

/** الأقسامُ التي يُنشئ فيها صاحبُ الطلب لجاناً — ليُعرض له زرُّ الإنشاء حيث يملكه وحده */
export async function departmentsForCreation(actor: OrgActor | null) {
  if (!actor?.role) return [];
  // الاقتراحُ لقائد القسم ونائبه المفوَّض — وللرئيس التنفيذي والمؤسس في الإدارة العليا وحدها
  const ids = [
    actor.leadsDepartmentId,
    actor.deputy?.permissions.includes("committees_manage") ? actor.deputy.departmentId : null,
    actor.isTop ? actor.seniorDepartmentId ?? null : null,
  ].filter((x): x is string => !!x);
  if (!ids.length) return [];
  // department-scope: all — أقسامٌ أصيلةٌ عاملة (لا لجان) ممّا يملك الاقتراحَ فيه وحده
  return prisma.department.findMany({
    where: { parentId: null, committeeStatus: null, id: { in: ids } },
    select: { id: true, name: true, colorHex: true },
    orderBy: { name: "asc" },
  });
}

/** أعضاءُ القسم الذين يُختارون للجانه (قائداً أو أعضاء) */
export async function departmentPeople(departmentId: string) {
  return prisma.member.findMany({
    where: departmentPeopleWhere(departmentId),
    select: { id: true, fullName: true, jobTitle: true },
    orderBy: { fullName: "asc" },
    take: 500,
  });
}

// ═════════════════════════════════════════════════════════════════════
//  تفاصيلُ لجنة
// ═════════════════════════════════════════════════════════════════════

export async function committeeDetail(actor: OrgActor | null, committeeId: string) {
  const ctx = await committeeContext(actor, committeeId);
  if (!ctx) return null;
  // عضوٌ عاديٌّ لا يرى لجنته قبل اعتمادها
  if (!ctx.role.manage && !ctx.role.lead && !ctx.role.view) return null;
  if (!ctx.role.manage && ctx.role.member && !MEMBER_VISIBLE.includes(ctx.committee.committeeStatus) && !ctx.role.lead) return null;
  const now = new Date();
  const c = await prisma.department.findUniqueOrThrow({
    where: { id: committeeId },
    select: {
      id: true, name: true, description: true, purpose: true, scope: true, responsibilities: true,
      expectedOutputs: true, kpis: true, committeeKind: true, startDate: true, endDate: true,
      committeeStatus: true, statusChangedAt: true, statusNote: true, createdAt: true, archivedFromStatus: true, leadAssignedAt: true, leadAssignedByName: true,
      requestedAt: true, requestedByName: true, decidedAt: true, decidedByName: true, decisionNote: true,
      leadMemberId: true,
      leadMember: { select: { id: true, fullName: true, jobTitle: true, isActive: true } },
      actingLeadUserId: true,
      actingLeadUser: { select: { fullName: true } },
      actingLeadSince: true,
      admins: { where: { isActive: true, role: "department_admin" }, select: { id: true, fullName: true }, take: 1 },
      parent: { select: { id: true, name: true, colorHex: true, slug: true } },
    },
  });
  const [memberships, tasks, meetings, decisions, reports, proposals, log, stats] = await Promise.all([
    prisma.committeeMembership.findMany({
      where: { committeeId },
      orderBy: [{ active: "desc" }, { addedAt: "asc" }],
      select: {
        memberId: true, responsibility: true, active: true, addedAt: true, addedByName: true, removedAt: true, removedByName: true,
        member: { select: { fullName: true, jobTitle: true, isActive: true } },
      },
    }),
    prisma.committeeTask.findMany({
      where: { committeeId },
      orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
      take: 300,
      select: {
        id: true, title: true, description: true, status: true, priority: true, dueAt: true, completedAt: true, createdAt: true,
        createdByName: true, meetingId: true, assigneeMemberId: true, assignee: { select: { fullName: true } },
      },
    }),
    prisma.committeeMeeting.findMany({
      where: { committeeId },
      orderBy: { startsAt: "desc" },
      take: 60,
      select: {
        id: true, title: true, startsAt: true, durationMinutes: true, location: true, meetingUrl: true, agenda: true,
        status: true, minutes: true, cancelledReason: true, createdByName: true,
        attendance: { select: { memberId: true, status: true, note: true } },
      },
    }),
    prisma.committeeDecision.findMany({
      where: { committeeId },
      orderBy: { createdAt: "desc" },
      take: 150,
      select: { id: true, kind: true, text: true, createdAt: true, createdByName: true, meetingId: true },
    }),
    prisma.committeeReport.findMany({
      where: { committeeId },
      orderBy: { submittedAt: "desc" },
      take: 60,
      select: {
        id: true, periodLabel: true, summary: true, achievements: true, challenges: true, nextSteps: true,
        submittedAt: true, submittedByName: true, reviewedAt: true, reviewedByName: true, reviewNote: true,
      },
    }),
    prisma.committeeProposal.findMany({
      where: { committeeId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 40,
      select: {
        id: true, kind: true, status: true, note: true, createdAt: true, proposedByName: true, decidedAt: true, decidedByName: true, decisionNote: true,
        member: { select: { fullName: true } }, replacement: { select: { fullName: true } },
      },
    }),
    // السجلُّ لمن يدير اللجنة أو يقودها — لا لكل عضو
    ctx.role.manage || ctx.role.lead || actor!.isTop || actor!.isOps
      ? prisma.orgAuditEvent.findMany({
          where: { entityId: committeeId },
          orderBy: { createdAt: "desc" },
          take: 150,
          select: { id: true, action: true, actorName: true, before: true, after: true, note: true, createdAt: true },
        })
      : Promise.resolve([]),
    committeeStats([committeeId]),
  ]);
  const activeIds = new Set(memberships.filter((m) => m.active).map((m) => m.memberId));
  const candidates =
    ctx.role.manage || ctx.role.lead
      ? (await departmentPeople(c.parent!.id)).filter((p) => !activeIds.has(p.id))
      : [];
  const held = meetings.filter((m) => m.status === "held");
  const attendanceRows = held.flatMap((m) => m.attendance);
  const attendanceRate = attendanceRows.length
    ? Math.round((attendanceRows.filter((a) => a.status === "present").length / attendanceRows.length) * 100)
    : null;
  const overdueTasks = tasks.filter((t) => (t.status === "todo" || t.status === "in_progress") && t.dueAt && t.dueAt < now);
  return {
    committee: { ...c, legacyLeadName: c.leadMember ? null : c.admins[0]?.fullName ?? null },
    role: ctx.role,
    // **لا يُغيَّر قائدٌ نشطٌ معتمد** — والتعيينُ في الاقتراح لمقترحها، وفي اللجنة العاملة بعد انتهاء قيادة
    // قائدها وحده: لقائد القسم ونائبه، وللرئيس والمؤسس حين يخلو مقعدُ قائد القسم (والخادمُ يفحصها ثانيةً)
    canAppointLead:
      ((c.committeeStatus === "draft" || c.committeeStatus === "rejected") && ctx.role.propose) ||
      ((((c.committeeStatus === "approved" || c.committeeStatus === "suspended") && !ctx.leadActive) ||
        // تعيينُ قائدٍ لاحقاً: «بانتظار تعيين قائد»، أو مؤرشفةٌ بلا قائدٍ نشط (ثم تُسترجَع بقائدها)
        c.committeeStatus === "awaiting_lead" ||
        (c.committeeStatus === "archived" && !(c.leadMemberId && ctx.leadActive))) &&
        ctx.role.manage &&
        (ctx.role.propose ||
          !(await prisma.user.findFirst({ where: { isActive: true, role: "department_admin", departmentId: c.parent!.id }, select: { id: true } })))),
    // انتهت قيادةُ القائد (غادر، أو انتهت عضويتُه، أو عُطِّل) — واللجنةُ بيد القائم بالخلافة حتى يُعيَّن قائد
    leadDeparted: (c.committeeStatus === "approved" || c.committeeStatus === "suspended") && !ctx.leadActive,
    actingLeadName: c.actingLeadUser?.fullName ?? null,
    transitions: ctx.role.manage ? STATUS_TRANSITIONS[c.committeeStatus!] ?? [] : [],
    memberships,
    candidates,
    tasks,
    overdueTaskIds: new Set(overdueTasks.map((t) => t.id)),
    // القادمُ: المجدولُ الذي لم يمضِ على موعده أكثرُ من ثلاث ساعات (اجتماعٌ جارٍ يبقى في القادمة)
    upcomingMeetingIds: new Set(
      meetings.filter((m) => m.status === "scheduled" && m.startsAt.getTime() >= now.getTime() - 3 * 3600_000).map((m) => m.id)
    ),
    meetings,
    decisions,
    reports,
    proposals,
    log,
    stats: stats.get(committeeId)!,
    kpis: {
      meetingsHeld: held.length,
      meetingsUpcoming: meetings.filter((m) => m.status === "scheduled" && m.startsAt >= now).length,
      attendanceRate,
      decisions: decisions.filter((d) => d.kind === "decision").length,
      recommendations: decisions.filter((d) => d.kind === "recommendation").length,
      reports: reports.length,
    },
  };
}

// ═════════════════════════════════════════════════════════════════════
//  نظرةُ القسم — للقائد والنائب والإدارة العليا ومسؤول التشغيل
// ═════════════════════════════════════════════════════════════════════

const PLAN_OPEN: Prisma.EnumTaskExecStateFilter = { in: ["not_started", "in_progress", "submitted", "returned", "blocked"] };

export async function departmentOverview(actor: OrgActor | null, departmentId: string) {
  if (!canViewDepartmentOverview(actor, departmentId)) return null;
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: {
      id: true, name: true, slug: true, colorHex: true, parentId: true, committeeStatus: true,
      deputyMemberId: true, deputyPermissions: true, deputyAppointedAt: true, deputyAppointedByName: true,
      deputyMember: { select: { id: true, fullName: true, jobTitle: true } },
      admins: { where: { isActive: true, role: "department_admin" }, select: { id: true, fullName: true, jobTitle: true }, take: 1 },
    },
  });
  if (!dept || dept.parentId || dept.committeeStatus) return null;
  const now = new Date();
  const seeMembers = canViewDepartmentMembers(actor, departmentId);
  const seeTasks = canViewDepartmentTasks(actor, departmentId);
  const roster: Prisma.MemberWhereInput = { ...ROSTER_MEMBER_WHERE, departmentId };
  const [memberCount, members, byStatus, planOpen, planOverdue, planVerified, planTotal, ctOpen, ctOverdue, ctDone, ctTotal, recentMeetings, pendingProposals, unreviewedReports, leaderless] =
    await Promise.all([
      prisma.member.count({ where: roster }),
      seeMembers
        ? prisma.member.findMany({
            where: roster,
            select: {
              id: true, fullName: true, jobTitle: true,
              _count: { select: { committeeMemberships: { where: { active: true } } } },
            },
            orderBy: { fullName: "asc" },
            take: 300,
          })
        : Promise.resolve([]),
      prisma.department.groupBy({ by: ["committeeStatus"], where: { parentId: departmentId }, _count: { _all: true } }),
      seeTasks ? prisma.planTask.count({ where: { departmentId, execState: PLAN_OPEN } }) : Promise.resolve(0),
      seeTasks ? prisma.planTask.count({ where: { departmentId, execState: PLAN_OPEN, dueAt: { lt: now } } }) : Promise.resolve(0),
      prisma.planTask.count({ where: { departmentId, execState: "verified" } }),
      prisma.planTask.count({ where: { departmentId, execState: { notIn: ["cancelled", "superseded", "waived"] } } }),
      seeTasks ? prisma.committeeTask.count({ where: { committee: { parentId: departmentId }, status: OPEN_TASK } }) : Promise.resolve(0),
      seeTasks ? prisma.committeeTask.count({ where: { committee: { parentId: departmentId }, status: OPEN_TASK, dueAt: { lt: now } } }) : Promise.resolve(0),
      prisma.committeeTask.count({ where: { committee: { parentId: departmentId }, status: "done" } }),
      prisma.committeeTask.count({ where: { committee: { parentId: departmentId }, status: { not: "cancelled" } } }),
      prisma.committeeMeeting.count({ where: { committee: { parentId: departmentId }, status: "held", startsAt: { gte: new Date(now.getTime() - 30 * 86400_000) } } }),
      prisma.committeeProposal.count({ where: { committee: { parentId: departmentId }, status: "pending" } }),
      prisma.committeeReport.count({ where: { committee: { parentId: departmentId }, reviewedAt: null } }),
      // لجانٌ عاملة بلا قائدٍ نشط — مسارُ التسليم
      // department-scope: all — المعلّقةُ تُعدّ أيضاً: لا تُعاد للعمل بلا قائد
      prisma.department.findMany({
        where: {
          parentId: departmentId,
          committeeStatus: { in: ["approved", "suspended"] },
          OR: [{ leadMemberId: null }, { leadMember: { OR: [{ isActive: false }, { terminatedAt: { not: null } }] } }],
        },
        select: { id: true, name: true },
      }),
    ]);
  const counts: Partial<Record<CommitteeStatus, number>> = {};
  for (const g of byStatus) if (g.committeeStatus) counts[g.committeeStatus] = g._count._all;
  const deputyCandidates = canAppointDeputy(actor, departmentId)
    ? await prisma.member.findMany({ where: { ...roster, terminatedAt: null }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" }, take: 300 })
    : [];
  return {
    dept: { ...dept, lead: dept.admins[0] ?? null },
    memberCount,
    members,
    counts,
    activeCommittees: counts.approved ?? 0,
    closedCommittees: (counts.closed ?? 0) + (counts.archived ?? 0) + (counts.completed ?? 0),
    tasks: seeTasks ? { planOpen, planOverdue, committeeOpen: ctOpen, committeeOverdue: ctOverdue } : null,
    kpis: {
      planVerifiedRate: planTotal ? Math.round((planVerified / planTotal) * 100) : null,
      committeeDoneRate: ctTotal ? Math.round((ctDone / ctTotal) * 100) : null,
      meetingsLast30: recentMeetings,
    },
    pendingProposals,
    unreviewedReports,
    leaderless,
    can: {
      manageCommittees: canManageCommitteesOf(actor, departmentId),
      viewMembers: seeMembers,
      viewTasks: seeTasks,
      assignResponsibilities: canAssignResponsibilities(actor, departmentId),
      appointDeputy: canAppointDeputy(actor, departmentId),
    },
    deputyCandidates,
  };
}

// ═════════════════════════════════════════════════════════════════════
//  «لجاني» — في صفحة العضو
// ═════════════════════════════════════════════════════════════════════

/** لجانُ العضو (ما اعتُمد منها وما بعده) ومهامُّه المفتوحة فيها */
export async function myCommittees(memberId: string) {
  const now = new Date();
  const [memberships, tasks] = await Promise.all([
    prisma.committeeMembership.findMany({
      where: { memberId, active: true, committee: { committeeStatus: { in: MEMBER_VISIBLE } } },
      orderBy: { addedAt: "desc" },
      take: 50,
      select: {
        responsibility: true,
        committee: {
          select: {
            id: true, name: true, committeeStatus: true, leadMemberId: true,
            leadMember: { select: { fullName: true } },
            parent: { select: { name: true, colorHex: true } },
          },
        },
      },
    }),
    prisma.committeeTask.findMany({
      where: { assigneeMemberId: memberId, status: { in: ["todo", "in_progress"] }, committee: { committeeStatus: "approved" } },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
      take: 50,
      select: {
        id: true, title: true, status: true, priority: true, dueAt: true,
        committee: { select: { id: true, name: true } },
      },
    }),
  ]);
  return {
    committees: memberships.map((m) => ({ ...m.committee, responsibility: m.responsibility, isLead: m.committee.leadMemberId === memberId })),
    tasks: tasks.map((t) => ({ ...t, overdue: !!t.dueAt && t.dueAt < now })),
  };
}

// ═════════════════════════════════════════════════════════════════════
//  تقريرُ اللجان للإدارة العليا ومسؤول التشغيل — قسماً قسماً
// ═════════════════════════════════════════════════════════════════════

export async function committeesReport() {
  const now = new Date();
  // department-scope: all — اللجانُ بكل حالاتها تُعَدّ (النشطةُ والمنتهية) لكل قسمٍ أصيل
  const [depts, committees, tasks, overdue] = await Promise.all([
    prisma.department.findMany({
      where: { parentId: null, committeeStatus: null, leadershipOnly: false },
      select: { id: true, name: true, colorHex: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
    // department-scope: all — كلُّ لجنةٍ بحالتها وقسمها (صفٌّ قصيرٌ لكل لجنة)
    prisma.department.findMany({ where: { parentId: { not: null }, committeeStatus: { not: null } }, select: { id: true, parentId: true, committeeStatus: true }, take: 5000 }),
    // العدُّ تجميعٌ في القاعدة لا صفوفٌ تُجلَب
    prisma.committeeTask.groupBy({ by: ["committeeId", "status"], where: { status: { not: "cancelled" } }, _count: { _all: true } }),
    prisma.committeeTask.groupBy({ by: ["committeeId"], where: { status: OPEN_TASK, dueAt: { lt: now } }, _count: { _all: true } }),
  ]);
  const parentOf = new Map(committees.map((c) => [c.id, c.parentId]));
  return depts.map((d) => {
    const mine = committees.filter((c) => c.parentId === d.id);
    const n = (s: CommitteeStatus[]) => mine.filter((c) => c.committeeStatus && s.includes(c.committeeStatus)).length;
    let total = 0;
    let done = 0;
    for (const g of tasks) {
      if (parentOf.get(g.committeeId) !== d.id) continue;
      total += g._count._all;
      if (g.status === "done") done += g._count._all;
    }
    const late = overdue.filter((g) => parentOf.get(g.committeeId) === d.id).reduce((a, g) => a + g._count._all, 0);
    return {
      id: d.id,
      name: d.name,
      colorHex: d.colorHex,
      active: n(["approved"]),
      pending: n(["draft", "pending_review"]),
      finished: n(["completed", "closed", "archived"]),
      open: total - done,
      overdue: late,
      progress: total ? Math.round((done / total) * 100) : null,
    };
  });
}
