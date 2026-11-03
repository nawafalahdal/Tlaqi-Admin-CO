import type {
  CommitteeAttendanceStatus,
  CommitteeDecisionKind,
  CommitteeStatus,
  CommitteeTaskPriority,
  CommitteeTaskStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSafeHttpUrl } from "@/lib/calendar";
import { committeeRoleFor, type CommitteeRole, type OrgActor } from "./actor";
import { committeeLeadState } from "./committeeLeadership";
import { fail, recordOrgEvent, type OrgResult } from "./audit";
import { LIMITS } from "./committeeService";

/** أعمالُ اللجنة: المهامّ، والاجتماعات وحضورُها، والقرارات، والتقارير.
 *
 *  **يديرها قائدُ اللجنة** — وقائدُ القسم يملك هيكلَها (القائد والأعضاء والحالة)
 *  ويطّلع على أعمالها ويراجع تقاريرها، ولا يُزاحم قائدَها في إدارتها.
 *  **والعضو** يرى أعمالَ لجنته، ويحدّث حالةَ مهامّه هو، ويُضيف ملاحظاته.
 *
 *  ولا عملَ إلا في لجنةٍ نشطة (`approved`): المعلّقةُ والمكتملةُ والمغلقةُ
 *  والمؤرشفةُ تُقرأ ولا يُضاف إليها شيء — إلا تقريرُ الختام للمكتملة. */

export type CommitteeContext = {
  committee: {
    id: string;
    name: string;
    parentId: string;
    committeeStatus: CommitteeStatus;
    leadMemberId: string | null;
  };
  role: CommitteeRole;
  /** للجنة قائدٌ عضوٌ نشطٌ معتمد؟ — وإلا فهي بيد القائم بالخلافة */
  leadActive: boolean;
};

/** اللجنةُ وصلةُ صاحب الطلب بها — أو `null` إن لم تكن، أو لم يكن له أن يراها */
export async function committeeContext(actor: OrgActor | null, committeeId: string): Promise<CommitteeContext | null> {
  if (!actor?.role || !committeeId) return null;
  const c = await prisma.department.findUnique({
    where: { id: committeeId },
    select: { id: true, name: true, parentId: true, committeeStatus: true, leadMemberId: true, actingLeadUserId: true },
  });
  if (!c?.parentId || !c.committeeStatus) return null;
  // حالةُ القائد الفعلية: تحدّد إن كان للمؤسس والرئيس اطّلاعٌ فقط أم إدارة، ومن يقود بالخلافة
  const lead = await committeeLeadState(prisma, c);
  const membership =
    actor.kind === "member"
      ? await prisma.committeeMembership.findUnique({
          where: { committeeId_memberId: { committeeId, memberId: actor.id } },
          select: { active: true },
        })
      : null;
  const role = committeeRoleFor(actor, { ...c, leadActive: lead.leadActive, actingLeadUserId: lead.actingLeadUserId }, !!membership?.active);
  if (!role.view) return null;
  return {
    committee: { id: c.id, name: c.name, parentId: c.parentId, committeeStatus: c.committeeStatus, leadMemberId: c.leadMemberId },
    role,
    leadActive: lead.leadActive,
  };
}

function text(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

function when(v: unknown): Date | null | "invalid" {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

const PRIORITIES: CommitteeTaskPriority[] = ["low", "normal", "high", "urgent"];
const TASK_STATUSES: CommitteeTaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

async function activeMember(committeeId: string, memberId: string) {
  const m = await prisma.committeeMembership.findUnique({
    where: { committeeId_memberId: { committeeId, memberId } },
    select: { active: true },
  });
  return !!m?.active;
}

function audit(tx: Prisma.TransactionClient, ctx: CommitteeContext, actor: OrgActor, action: string, payload: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue; note?: string | null }) {
  return recordOrgEvent(tx, {
    scope: "committee",
    entityId: ctx.committee.id,
    departmentId: ctx.committee.parentId,
    action,
    actor,
    ...payload,
  });
}

function needActiveLead(ctx: CommitteeContext | null): string | null {
  if (!ctx) return "اللجنة غير موجودة";
  if (!ctx.role.lead) return "هذا الإجراءُ لقائد اللجنة";
  if (ctx.committee.committeeStatus !== "approved") return "اللجنةُ ليست نشطة — أعمالُها تُقرأ ولا يُضاف إليها";
  return null;
}

// ═════════════════════════════════════════════════════════════════════
//  المهامّ
// ═════════════════════════════════════════════════════════════════════

export async function createCommitteeTask(
  actor: OrgActor | null,
  committeeId: string,
  input: { title: string; description?: string | null; assigneeMemberId?: string | null; dueAt?: string | null; priority?: string; meetingId?: string | null }
): Promise<OrgResult<{ id: string }>> {
  const ctx = await committeeContext(actor, committeeId);
  const denied = needActiveLead(ctx);
  if (denied) return fail(denied);
  const title = text(input.title, LIMITS.short);
  if (!title) return fail("عنوانُ المهمّة مطلوب");
  const assignee = text(input.assigneeMemberId, 64);
  if (!assignee) return fail("كلُّ مهمّةٍ تُسنَد إلى عضوٍ محدّد");
  if (!(await activeMember(committeeId, assignee))) return fail("المهمّةُ تُسنَد إلى عضوٍ نشطٍ في اللجنة");
  const due = when(input.dueAt);
  if (due === "invalid") return fail("موعدُ التسليم غير صحيح");
  const priority = PRIORITIES.includes(input.priority as CommitteeTaskPriority) ? (input.priority as CommitteeTaskPriority) : "normal";
  const meetingId = text(input.meetingId, 64);
  if (meetingId) {
    const m = await prisma.committeeMeeting.findFirst({ where: { id: meetingId, committeeId }, select: { id: true } });
    if (!m) return fail("الاجتماعُ ليس من اجتماعات هذه اللجنة");
  }
  const row = await prisma.$transaction(async (tx) => {
    const t = await tx.committeeTask.create({
      data: {
        committeeId, title, description: text(input.description, LIMITS.long), assigneeMemberId: assignee,
        dueAt: due, priority, meetingId, createdByName: actor!.name,
      },
      select: { id: true },
    });
    await audit(tx, ctx!, actor!, "task.created", { after: { taskId: t.id, title, assigneeMemberId: assignee, dueAt: due?.toISOString() ?? null, priority, meetingId } });
    return t;
  });
  return { ok: true, id: row.id };
}

/** حالةُ المهمّة — يحدّثها المُسنَدةُ إليه (إلى «جارية» أو «منجزة»)، وقائدُ اللجنة (وله الإلغاء) */
export async function updateCommitteeTaskStatus(
  actor: OrgActor | null,
  taskId: string,
  status: string
): Promise<OrgResult> {
  const task = await prisma.committeeTask.findUnique({
    where: { id: taskId },
    select: { id: true, committeeId: true, status: true, assigneeMemberId: true },
  });
  if (!task) return fail("المهمّة غير موجودة");
  const ctx = await committeeContext(actor, task.committeeId);
  if (!ctx) return fail("المهمّة غير موجودة");
  if (ctx.committee.committeeStatus !== "approved") return fail("اللجنةُ ليست نشطة");
  if (!TASK_STATUSES.includes(status as CommitteeTaskStatus)) return fail("حالةٌ غير معروفة");
  const next = status as CommitteeTaskStatus;
  const isAssignee = actor!.kind === "member" && task.assigneeMemberId === actor!.id && ctx.role.member;
  if (!ctx.role.lead && !isAssignee) return fail("تحديثُ المهمّة لمن أُسندت إليه ولقائد اللجنة");
  if (next === "cancelled" && !ctx.role.lead) return fail("إلغاءُ المهمّة لقائد اللجنة");
  if (task.status === "cancelled" && !ctx.role.lead) return fail("المهمّةُ ملغاة");
  if (task.status === next) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.committeeTask.update({
      where: { id: taskId },
      data: { status: next, completedAt: next === "done" ? new Date() : null },
    });
    await audit(tx, ctx, actor!, "task.status", { before: { taskId, status: task.status }, after: { taskId, status: next } });
  });
  return { ok: true };
}

/** يُعدّل قائدُ اللجنة المهمّة: المُسنَدَ إليه، والموعد، والأولوية */
export async function updateCommitteeTask(
  actor: OrgActor | null,
  taskId: string,
  input: { assigneeMemberId?: string | null; dueAt?: string | null; priority?: string }
): Promise<OrgResult> {
  const task = await prisma.committeeTask.findUnique({
    where: { id: taskId },
    select: { id: true, committeeId: true, assigneeMemberId: true, dueAt: true, priority: true },
  });
  if (!task) return fail("المهمّة غير موجودة");
  const ctx = await committeeContext(actor, task.committeeId);
  const denied = needActiveLead(ctx);
  if (denied) return fail(denied);
  const data: Prisma.CommitteeTaskUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const assignee = text(input.assigneeMemberId, 64);
  if (assignee && assignee !== task.assigneeMemberId) {
    if (!(await activeMember(task.committeeId, assignee))) return fail("المهمّةُ تُسنَد إلى عضوٍ نشطٍ في اللجنة");
    data.assignee = { connect: { id: assignee } };
    before.assigneeMemberId = task.assigneeMemberId;
    after.assigneeMemberId = assignee;
  }
  if (input.dueAt !== undefined) {
    const due = when(input.dueAt);
    if (due === "invalid") return fail("موعدُ التسليم غير صحيح");
    if ((due?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null)) {
      data.dueAt = due;
      before.dueAt = task.dueAt?.toISOString() ?? null;
      after.dueAt = due?.toISOString() ?? null;
    }
  }
  if (input.priority && PRIORITIES.includes(input.priority as CommitteeTaskPriority) && input.priority !== task.priority) {
    data.priority = input.priority as CommitteeTaskPriority;
    before.priority = task.priority;
    after.priority = input.priority;
  }
  if (!Object.keys(after).length) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.committeeTask.update({ where: { id: taskId }, data });
    await audit(tx, ctx!, actor!, "task.updated", { before: { taskId, ...before } as Prisma.InputJsonValue, after: { taskId, ...after } as Prisma.InputJsonValue });
  });
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════
//  الاجتماعات والحضور
// ═════════════════════════════════════════════════════════════════════

export async function scheduleCommitteeMeeting(
  actor: OrgActor | null,
  committeeId: string,
  input: { title: string; startsAt: string; durationMinutes?: string | number; location?: string | null; meetingUrl?: string | null; agenda?: string | null }
): Promise<OrgResult<{ id: string }>> {
  const ctx = await committeeContext(actor, committeeId);
  const denied = needActiveLead(ctx);
  if (denied) return fail(denied);
  const title = text(input.title, LIMITS.short);
  if (!title) return fail("عنوانُ الاجتماع مطلوب");
  const starts = when(input.startsAt);
  if (!starts || starts === "invalid") return fail("موعدُ الاجتماع مطلوب");
  const duration = Math.round(Number(input.durationMinutes ?? 60));
  if (!Number.isFinite(duration) || duration < 15 || duration > 480) return fail("مدّةُ الاجتماع بين ربع ساعة وثماني ساعات");
  const url = text(input.meetingUrl, 500);
  if (url && !isSafeHttpUrl(url)) return fail("رابطُ الاجتماع يبدأ بـ https://");
  const location = text(input.location, LIMITS.short);
  if (!url && !location) return fail("حدّد مكانَ الاجتماع أو رابطه");
  const row = await prisma.$transaction(async (tx) => {
    const m = await tx.committeeMeeting.create({
      data: { committeeId, title, startsAt: starts, durationMinutes: duration, location, meetingUrl: url, agenda: text(input.agenda, LIMITS.long), createdByName: actor!.name },
      select: { id: true },
    });
    await audit(tx, ctx!, actor!, "meeting.scheduled", { after: { meetingId: m.id, title, startsAt: starts.toISOString(), durationMinutes: duration } });
    return m;
  });
  return { ok: true, id: row.id };
}

export async function cancelCommitteeMeeting(actor: OrgActor | null, meetingId: string, reason: string | null): Promise<OrgResult> {
  const meeting = await prisma.committeeMeeting.findUnique({ where: { id: meetingId }, select: { committeeId: true, status: true } });
  if (!meeting) return fail("الاجتماع غير موجود");
  const ctx = await committeeContext(actor, meeting.committeeId);
  const denied = needActiveLead(ctx);
  if (denied) return fail(denied);
  if (meeting.status !== "scheduled") return fail("يُلغى المجدولُ وحده");
  const why = text(reason, LIMITS.short);
  if (!why) return fail("الإلغاءُ لا يقع بلا سبب");
  await prisma.$transaction(async (tx) => {
    await tx.committeeMeeting.update({ where: { id: meetingId }, data: { status: "cancelled", cancelledReason: why } });
    await audit(tx, ctx!, actor!, "meeting.cancelled", { before: { meetingId, status: "scheduled" }, after: { meetingId, status: "cancelled" }, note: why });
  });
  return { ok: true };
}

/** يُثبت انعقادَ الاجتماع وحضورَه ومحضرَه — صفٌّ واحد لكل عضو، فلا يتكرّر */
export async function recordCommitteeMeeting(
  actor: OrgActor | null,
  meetingId: string,
  input: { attendance: { memberId: string; status: string; note?: string | null }[]; minutes?: string | null }
): Promise<OrgResult> {
  const meeting = await prisma.committeeMeeting.findUnique({ where: { id: meetingId }, select: { committeeId: true, status: true, minutes: true } });
  if (!meeting) return fail("الاجتماع غير موجود");
  const ctx = await committeeContext(actor, meeting.committeeId);
  const denied = needActiveLead(ctx);
  if (denied) return fail(denied);
  if (meeting.status === "cancelled") return fail("الاجتماعُ ملغى");
  const members = await prisma.committeeMembership.findMany({ where: { committeeId: meeting.committeeId, active: true }, select: { memberId: true } });
  const allowed = new Set(members.map((m) => m.memberId));
  const entries = input.attendance.filter((a) => allowed.has(a.memberId));
  if (entries.length !== input.attendance.length) return fail("الحضورُ يُسجَّل لأعضاء اللجنة النشطين وحدهم");
  const statuses: CommitteeAttendanceStatus[] = ["present", "absent", "excused"];
  if (entries.some((e) => !statuses.includes(e.status as CommitteeAttendanceStatus))) return fail("حالةُ حضورٍ غير معروفة");
  const minutes = text(input.minutes, LIMITS.long * 2);
  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.committeeAttendance.upsert({
        where: { meetingId_memberId: { meetingId, memberId: e.memberId } },
        create: { meetingId, memberId: e.memberId, status: e.status as CommitteeAttendanceStatus, note: text(e.note, LIMITS.short), recordedByName: actor!.name },
        update: { status: e.status as CommitteeAttendanceStatus, note: text(e.note, LIMITS.short), recordedByName: actor!.name, recordedAt: new Date() },
      });
    }
    await tx.committeeMeeting.update({ where: { id: meetingId }, data: { status: "held", minutes: minutes ?? meeting.minutes } });
    await audit(tx, ctx!, actor!, "meeting.recorded", {
      before: { meetingId, status: meeting.status },
      after: {
        meetingId, status: "held",
        present: entries.filter((e) => e.status === "present").length,
        absent: entries.filter((e) => e.status === "absent").length,
        excused: entries.filter((e) => e.status === "excused").length,
      },
    });
  });
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════
//  القرارات والملاحظات
// ═════════════════════════════════════════════════════════════════════

export async function addCommitteeDecision(
  actor: OrgActor | null,
  committeeId: string,
  input: { kind: string; text: string; meetingId?: string | null }
): Promise<OrgResult> {
  const ctx = await committeeContext(actor, committeeId);
  if (!ctx) return fail("اللجنة غير موجودة");
  if (ctx.committee.committeeStatus !== "approved") return fail("اللجنةُ ليست نشطة");
  const kinds: CommitteeDecisionKind[] = ["decision", "recommendation", "note"];
  if (!kinds.includes(input.kind as CommitteeDecisionKind)) return fail("نوعٌ غير معروف");
  const kind = input.kind as CommitteeDecisionKind;
  // العضوُ يشارك بملاحظته — والقرارُ والتوصيةُ لقائد اللجنة
  if (!ctx.role.lead && !(ctx.role.member && kind === "note")) {
    return fail(ctx.role.member ? "القراراتُ والتوصياتُ يسجّلها قائدُ اللجنة — ولك أن تضيف ملاحظة" : "المشاركةُ لأعضاء اللجنة");
  }
  const body = text(input.text, LIMITS.long);
  if (!body) return fail("النصُّ مطلوب");
  const meetingId = text(input.meetingId, 64);
  if (meetingId) {
    const m = await prisma.committeeMeeting.findFirst({ where: { id: meetingId, committeeId }, select: { id: true } });
    if (!m) return fail("الاجتماعُ ليس من اجتماعات هذه اللجنة");
  }
  await prisma.$transaction(async (tx) => {
    const d = await tx.committeeDecision.create({ data: { committeeId, kind, text: body, meetingId, createdByName: actor!.name }, select: { id: true } });
    await audit(tx, ctx, actor!, "decision.added", { after: { decisionId: d.id, kind, meetingId } });
  });
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════
//  التقارير — يرفعها قائدُ اللجنة، ويطّلع عليها قائدُ القسم
// ═════════════════════════════════════════════════════════════════════

export async function submitCommitteeReport(
  actor: OrgActor | null,
  committeeId: string,
  input: { periodLabel: string; summary: string; achievements?: string | null; challenges?: string | null; nextSteps?: string | null }
): Promise<OrgResult> {
  const ctx = await committeeContext(actor, committeeId);
  if (!ctx) return fail("اللجنة غير موجودة");
  if (!ctx.role.lead) return fail("رفعُ التقرير لقائد اللجنة");
  if (ctx.committee.committeeStatus !== "approved" && ctx.committee.committeeStatus !== "completed") {
    return fail("يُرفع التقريرُ من لجنةٍ نشطةٍ أو مكتملة");
  }
  const periodLabel = text(input.periodLabel, LIMITS.short);
  const summary = text(input.summary, LIMITS.long);
  if (!periodLabel || !summary) return fail("الفترةُ والملخّص مطلوبان");
  await prisma.$transaction(async (tx) => {
    const r = await tx.committeeReport.create({
      data: {
        committeeId, periodLabel, summary,
        achievements: text(input.achievements, LIMITS.long), challenges: text(input.challenges, LIMITS.long), nextSteps: text(input.nextSteps, LIMITS.long),
        submittedByName: actor!.name,
      },
      select: { id: true },
    });
    await audit(tx, ctx, actor!, "report.submitted", { after: { reportId: r.id, periodLabel } });
  });
  return { ok: true };
}

export async function reviewCommitteeReport(actor: OrgActor | null, reportId: string, note: string | null): Promise<OrgResult> {
  const report = await prisma.committeeReport.findUnique({ where: { id: reportId }, select: { committeeId: true, reviewedAt: true } });
  if (!report) return fail("التقرير غير موجود");
  const ctx = await committeeContext(actor, report.committeeId);
  if (!ctx?.role.manage) return fail("الاطّلاعُ المسجَّل على التقرير لقائد القسم ومن فُوِّض");
  if (report.reviewedAt) return fail("سُجِّل الاطّلاعُ عليه بالفعل");
  const why = text(note, LIMITS.short);
  await prisma.$transaction(async (tx) => {
    await tx.committeeReport.update({ where: { id: reportId }, data: { reviewedAt: new Date(), reviewedByName: actor!.name, reviewNote: why } });
    await audit(tx, ctx, actor!, "report.reviewed", { after: { reportId }, note: why });
  });
  return { ok: true };
}
