import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { isOverdue } from "@/lib/tasks";
import { countdownLabel } from "@/lib/riyadh";
import type { TaskView } from "@/components/execution/TaskCard";

/** تحويلُ صفوف المهامّ إلى ما تَعرضه البطاقة.
 *
 *  **والتحويلُ في الخادم لا في المتصفّح:** التأخّرُ يُحسَب بالوقت
 *  والعدُّ التنازليُّ بتقويم الرياض، وكلاهما لو حُسب في المتصفّح
 *  لاختلف باختلاف جهاز القارئ. والتواريخُ تُمرَّر نصّاً (`ISO`) لأن
 *  حدَّ المكوّن العميل لا يَعبره `Date` إلا مُسلسَلاً. */

export const TASK_INCLUDE = {
  department: { select: { name: true } },
  ownerUser: { select: { fullName: true } },
  ownerMember: { select: { fullName: true } },
  submissions: {
    orderBy: { submittedAt: "desc" as const },
    take: 1,
    select: {
      id: true,
      note: true,
      evidenceUrl: true,
      evidenceFileName: true,
      submittedAt: true,
      submittedByName: true,
    },
  },
  reviews: {
    orderBy: { decidedAt: "desc" as const },
    take: 1,
    select: { note: true, decision: true },
  },
} satisfies Prisma.PlanTaskInclude;

type TaskRow = Prisma.PlanTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export function toTaskView(t: TaskRow, now: Date = new Date()): TaskView {
  const sub = t.submissions[0] ?? null;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    acceptanceCriteria: t.acceptanceCriteria,
    deliverable: t.deliverable,
    execState: t.execState,
    priority: t.priority,
    weight: t.weight,
    dueAt: t.dueAt.toISOString(),
    originalDueAt: t.originalDueAt.toISOString(),
    carryoverCount: t.carryoverCount,
    consecutiveCarryover: t.consecutiveCarryover,
    carryReason: t.carryReason,
    correctivePlan: t.correctivePlan,
    blockedReason: t.blockedReason,
    ownerName: t.ownerUser?.fullName ?? t.ownerMember?.fullName ?? null,
    departmentName: t.department?.name ?? null,
    verifiedByName: t.verifiedByName,
    reportedByName: t.reportedByName,
    waivedReason: t.waivedReason,
    overdue: isOverdue({ dueAt: t.dueAt, execState: t.execState }, now),
    countdown: countdownLabel(t.dueAt, now),
    lastSubmission: sub
      ? {
          id: sub.id,
          note: sub.note,
          evidenceUrl: sub.evidenceUrl,
          evidenceFileName: sub.evidenceFileName,
          submittedAt: sub.submittedAt.toISOString(),
          submittedByName: sub.submittedByName,
        }
      : null,
    lastReviewNote: t.reviews[0]?.note ?? null,
  };
}

/** مهامُّ فترةٍ — كلُّها أو لقسمٍ منها */
export async function periodTasks(periodId: string, departmentId?: string | null) {
  const rows = await prisma.planTask.findMany({
    where: { periodId, ...(departmentId ? { departmentId } : {}) },
    include: TASK_INCLUDE,
    orderBy: [{ execState: "asc" }, { dueAt: "asc" }],
  });
  return rows.map((r) => toTaskView(r));
}

/** مهامُّ شخصٍ القائمة — لصفحته هو */
export async function myTasks(opts: { userId?: string; memberId?: string }) {
  const rows = await prisma.planTask.findMany({
    where: {
      ...(opts.userId ? { ownerUserId: opts.userId } : {}),
      ...(opts.memberId ? { ownerMemberId: opts.memberId } : {}),
      execState: { notIn: ["cancelled", "superseded"] },
    },
    include: TASK_INCLUDE,
    orderBy: [{ dueAt: "asc" }],
    take: 60,
  });
  return rows.map((r) => toTaskView(r));
}

/** ما ينتظر التحقّق في فترةٍ — لمساحة المراجعة */
export async function awaitingVerification(periodId: string) {
  const rows = await prisma.planTask.findMany({
    where: { periodId, execState: "submitted" },
    include: TASK_INCLUDE,
    orderBy: [{ dueAt: "asc" }],
  });
  return rows.map((r) => toTaskView(r));
}

/** الخياراتُ التي تُسنَد إليها المهامّ: قيادةُ القسم وأعضاؤه */
export async function assignableOwners(departmentId: string) {
  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, departmentId },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.member.findMany({
      where: { isActive: true, approvalStatus: "approved", departmentId },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);
  return [
    ...users.map((u) => ({ value: `user:${u.id}`, label: `${u.fullName} — قيادة` })),
    ...members.map((m) => ({ value: `member:${m.id}`, label: m.fullName })),
  ];
}
