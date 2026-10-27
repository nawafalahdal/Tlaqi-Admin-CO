import { createHash } from "node:crypto";
import type { MarketingTaskKind, MarketingTaskStatus, Prisma, WorkPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALLOWED_PLAN_TYPES } from "@/lib/planFormats";
import { campaignAccess, requireCampaignRole, type MkActor } from "./access";
import { logEvent } from "./audit";
import { PRIORITIES } from "./campaigns";
import { abort, fail, guarded, type MkResult } from "./result";
import { assertNotArchiving } from "./archiveGuard";

/** مهامُّ الحملة: من يفعل ماذا ومتى، وما ينتظر ماذا.
 *
 *  - **المنسّقُ ينشئ ويُسند ويعدّل ويحذف**؛ والمُسنَدُ إليه يحرّك حالة مهمّته.
 *  - **الاعتمادياتُ تُفرض:** لا تبدأ مهمّةٌ ولا تُنجَز وما تنتظره لم يُنجَز،
 *    ولا تُضاف اعتماديةٌ تصنع حلقة.
 *  - **والرفضُ يعيد الفتح** (`reopenTasks`) — فلا تبقى «منجزة» وعملُها مرفوض. */

export const TASK_KINDS: MarketingTaskKind[] = ["general", "content", "design", "quality", "publishing"];
const STATUSES: MarketingTaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];
const MAX_DEPS = 20;

type TaskInput = {
  title: string;
  description?: string;
  kind?: string;
  deliverableId?: string | null;
  assigneeId?: string | null;
  dueAt?: string | Date | null;
  priority?: string;
  dependsOn?: string[];
};

async function assertAssignee(campaignId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return null;
  // يُسنَد لمن هو في فريق الحملة وحده
  const row = await prisma.marketingCampaignMember.findFirst({
    where: { campaignId, memberId: assigneeId, member: { active: true } },
    select: { memberId: true },
  });
  if (!row) abort("invalid_input", { field: "assignee" });
  return row.memberId;
}

function parseTask(input: TaskInput) {
  const title = input.title?.trim().slice(0, 200);
  if (!title) abort("invalid_input", { field: "title" });
  const kind = (TASK_KINDS as string[]).includes(String(input.kind)) ? (input.kind as MarketingTaskKind) : "general";
  const priority = (PRIORITIES as string[]).includes(String(input.priority)) ? (input.priority as WorkPriority) : "normal";
  let dueAt: Date | null = null;
  if (input.dueAt) {
    dueAt = input.dueAt instanceof Date ? input.dueAt : new Date(String(input.dueAt));
    if (Number.isNaN(dueAt.getTime())) abort("invalid_input", { field: "dueAt" });
  }
  return { title, kind, priority, dueAt, description: input.description?.trim().slice(0, 2000) || null };
}

/** هل تصنع اعتماديةُ `taskId → dependsOn` حلقة؟ (يُتبَع من `dependsOn` حتى يُبلَغ `taskId`) */
async function createsCycle(campaignId: string, taskId: string, dependsOn: string[]): Promise<boolean> {
  const edges = await prisma.marketingTaskDependency.findMany({
    where: { task: { campaignId } },
    select: { taskId: true, dependsOnId: true },
  });
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.taskId, [...(next.get(e.taskId) ?? []), e.dependsOnId]);
  const seen = new Set<string>();
  const stack = [...dependsOn];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === taskId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

async function validDeps(campaignId: string, ids: string[] | undefined, self?: string) {
  const unique = [...new Set((ids ?? []).filter((x) => x && x !== self))].slice(0, MAX_DEPS);
  if (unique.length === 0) return [];
  const found = await prisma.marketingTask.count({ where: { id: { in: unique }, campaignId } });
  if (found !== unique.length) abort("invalid_input", { field: "dependsOn" });
  return unique;
}

export async function createTask(actor: MkActor, campaignId: string, input: TaskInput): Promise<MkResult<{ taskId: string }>> {
  return guarded(async () => {
    const { memberId } = await requireCampaignRole(actor, campaignId, "coordinator");
    const t = parseTask(input);
    const assigneeId = await assertAssignee(campaignId, input.assigneeId);
    if (input.deliverableId) {
      const ok = await prisma.marketingDeliverable.count({ where: { id: input.deliverableId, campaignId } });
      if (!ok) return fail("invalid_input", { field: "deliverable" });
    }
    const deps = await validDeps(campaignId, input.dependsOn);
    return prisma.$transaction(async (tx) => {
      const row = await tx.marketingTask.create({
        data: { ...t, campaignId, deliverableId: input.deliverableId || null, assigneeId, createdById: memberId, dependsOn: { create: deps.map((d) => ({ dependsOnId: d })) } },
        select: { id: true },
      });
      await logEvent(tx, actor, { action: "task.created", campaignId, deliverableId: input.deliverableId || null, details: { taskId: row.id, title: t.title } });
      return { ok: true as const, taskId: row.id };
    });
  });
}

export async function updateTask(actor: MkActor, taskId: string, input: TaskInput): Promise<MkResult> {
  return guarded(async () => {
    const task = await prisma.marketingTask.findUnique({ where: { id: taskId }, select: { id: true, campaignId: true } });
    if (!task) return fail("not_found");
    await requireCampaignRole(actor, task.campaignId, "coordinator");
    const t = parseTask(input);
    const assigneeId = await assertAssignee(task.campaignId, input.assigneeId);
    const deps = await validDeps(task.campaignId, input.dependsOn, taskId);
    if (deps.length && (await createsCycle(task.campaignId, taskId, deps))) return fail("dependency_cycle");
    await prisma.$transaction(async (tx) => {
      await tx.marketingTaskDependency.deleteMany({ where: { taskId } });
      await tx.marketingTask.update({
        where: { id: taskId },
        data: { ...t, assigneeId, dependsOn: { create: deps.map((d) => ({ dependsOnId: d })) } },
      });
      await logEvent(tx, actor, { action: "task.updated", campaignId: task.campaignId, details: { taskId, title: t.title } });
    });
    return { ok: true };
  });
}

/** المنسّقُ أو المُسنَدُ إليه — ولا تبدأ ولا تُنجَز قبل ما تنتظره */
export async function setTaskStatus(actor: MkActor, taskId: string, status: string): Promise<MkResult> {
  return guarded(async () => {
    if (!(STATUSES as string[]).includes(status)) return fail("invalid_input", { field: "status" });
    const to = status as MarketingTaskStatus;
    const task = await prisma.marketingTask.findUnique({
      where: { id: taskId },
      select: { id: true, campaignId: true, deliverableId: true, status: true, title: true, assigneeId: true, dependsOn: { select: { dependsOn: { select: { status: true, title: true } } } } },
    });
    if (!task) return fail("not_found");
    const access = await campaignAccess(actor, task.campaignId);
    if (!access.canView) return fail("not_found");
    const isCoordinator = access.roles.has("coordinator");
    const isAssignee = !!actor.member && actor.member.id === task.assigneeId && access.roles.size > 0;
    if (!isCoordinator && !isAssignee) return fail("forbidden", { role: "assignee" });
    // إعادةُ فتح المنجزة أو الملغاة قرارُ المنسّق
    if ((task.status === "done" || task.status === "cancelled") && to !== task.status && !isCoordinator) return fail("forbidden", { role: "coordinator" });
    if (to === "cancelled" && !isCoordinator) return fail("forbidden", { role: "coordinator" });
    if (to === "in_progress" || to === "done") {
      const open = task.dependsOn.filter((d) => d.dependsOn.status !== "done" && d.dependsOn.status !== "cancelled");
      if (open.length) return fail("dependency_open", { tasks: open.map((d) => d.dependsOn.title).join("، ") });
    }
    if (to === task.status) return { ok: true };
    await prisma.$transaction(async (tx) => {
      // ما يُؤرشف الآن لا يتغيّر تحته — وإلا اختلف الشيتُ عن مصدره
      await assertNotArchiving(tx, task.campaignId);
      const res = await tx.marketingTask.updateMany({
        where: { id: taskId, status: task.status },
        data: { status: to, completedAt: to === "done" ? new Date() : null, ...(task.status === "done" && to !== "done" ? { reopenCount: { increment: 1 } } : {}) },
      });
      if (res.count === 0) abort("stale");
      await logEvent(tx, actor, { action: "task.status_changed", campaignId: task.campaignId, deliverableId: task.deliverableId, details: { taskId, title: task.title, from: task.status, to } });
    });
    return { ok: true };
  });
}

/** إسنادُ مهمّةٍ قائمةٍ أو رفعُ إسنادها — قرارُ المنسّق وحده.
 *  الاقتراحُ (`assignmentSuggestions`) لا يُسنِد بنفسه؛ هذه هي الخطوةُ البشرية،
 *  وتمرّ بفحص الإسناد نفسه: من فريق الحملة، ونشِط. */
export async function assignTask(actor: MkActor, taskId: string, assigneeId: string | null): Promise<MkResult> {
  return guarded(async () => {
    const task = await prisma.marketingTask.findUnique({
      where: { id: taskId },
      select: { id: true, campaignId: true, deliverableId: true, title: true, status: true, assigneeId: true, campaign: { select: { status: true } } },
    });
    if (!task) return fail("not_found");
    await requireCampaignRole(actor, task.campaignId, "coordinator");
    if (task.campaign.status === "archived" || task.campaign.status === "published" || task.status === "done" || task.status === "cancelled") return fail("invalid_state");
    const to = await assertAssignee(task.campaignId, assigneeId);
    if (to === task.assigneeId) return { ok: true };
    await prisma.$transaction(async (tx) => {
      const res = await tx.marketingTask.updateMany({ where: { id: taskId, assigneeId: task.assigneeId }, data: { assigneeId: to } });
      if (res.count === 0) abort("stale");
      await logEvent(tx, actor, { action: "task.assigned", campaignId: task.campaignId, deliverableId: task.deliverableId, details: { taskId, title: task.title } });
    });
    return { ok: true };
  });
}

export async function deleteTask(actor: MkActor, taskId: string): Promise<MkResult> {
  return guarded(async () => {
    const task = await prisma.marketingTask.findUnique({ where: { id: taskId }, select: { id: true, campaignId: true, title: true } });
    if (!task) return fail("not_found");
    await requireCampaignRole(actor, task.campaignId, "coordinator");
    await prisma.$transaction(async (tx) => {
      await tx.marketingTask.delete({ where: { id: taskId } });
      await logEvent(tx, actor, { action: "task.deleted", campaignId: task.campaignId, details: { taskId, title: task.title } });
    });
    return { ok: true };
  });
}

/** تعليقٌ في الحملة أو على مخرجٍ أو مهمّة — لكل من في فريق الحملة */
export async function addComment(
  actor: MkActor,
  campaignId: string,
  input: { body: string; deliverableId?: string | null; taskId?: string | null }
): Promise<MkResult> {
  return guarded(async () => {
    const access = await campaignAccess(actor, campaignId);
    if (!access.canView) return fail("not_found");
    if (access.roles.size === 0 || !actor.member) return fail("forbidden", { role: "campaign" });
    const body = input.body?.trim().slice(0, 4000);
    if (!body) return fail("invalid_input", { field: "body" });
    if (input.deliverableId && !(await prisma.marketingDeliverable.count({ where: { id: input.deliverableId, campaignId } }))) return fail("not_found");
    if (input.taskId && !(await prisma.marketingTask.count({ where: { id: input.taskId, campaignId } }))) return fail("not_found");
    const memberId = actor.member.id;
    await prisma.$transaction(async (tx) => {
      // ما يُؤرشف الآن لا يتغيّر تحته — وإلا اختلف الشيتُ عن مصدره
      await assertNotArchiving(tx, campaignId);
      await tx.marketingComment.create({ data: { campaignId, deliverableId: input.deliverableId || null, taskId: input.taskId || null, body, authorId: memberId } });
      await logEvent(tx, actor, { action: "comment.added", campaignId, deliverableId: input.deliverableId || null });
    });
    return { ok: true };
  });
}

export const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;

/** مرفقٌ لمهمّة — من أنواع مركز الخطط نفسها (بلا HTML ولا SVG) */
export async function attachToTask(
  actor: MkActor,
  taskId: string,
  file: { name: string; type: string; bytes: Uint8Array } | null
): Promise<MkResult> {
  return guarded(async () => {
    const task = await prisma.marketingTask.findUnique({ where: { id: taskId }, select: { campaignId: true, deliverableId: true } });
    if (!task) return fail("not_found");
    const access = await campaignAccess(actor, task.campaignId);
    if (!access.canView) return fail("not_found");
    if (access.roles.size === 0 || !actor.member) return fail("forbidden", { role: "campaign" });
    if (!file || file.bytes.byteLength === 0) return fail("invalid_input", { field: "file" });
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) return fail("file_too_large", { maxMb: 7 });
    if (!ALLOWED_PLAN_TYPES[file.type]) return fail("file_type");
    const memberId = actor.member.id;
    await prisma.$transaction(async (tx) => {
      // ما يُؤرشف الآن لا يتغيّر تحته — وإلا اختلف الشيتُ عن مصدره
      await assertNotArchiving(tx, task.campaignId);
      await tx.marketingFile.create({
        data: {
          campaignId: task.campaignId,
          deliverableId: task.deliverableId,
          taskId,
          kind: "attachment",
          fileName: file.name.slice(0, 200) || "attachment",
          mimeType: file.type,
          byteSize: file.bytes.byteLength,
          sha256: createHash("sha256").update(file.bytes).digest("hex"),
          data: Buffer.from(file.bytes),
          uploadedById: memberId,
        },
      });
      await logEvent(tx, actor, { action: "file.attached", campaignId: task.campaignId, deliverableId: task.deliverableId, details: { taskId, name: file.name.slice(0, 200) } });
    });
    return { ok: true };
  });
}

const TASKS_TAKE = 300;

/** مهامُّ منشورٍ أُرشف بعد نشره خرجت من العمل الجاري مع منشورها — وتبقى في القاعدة حتى أرشفة الحملة */
const ACTIVE_WORK = { OR: [{ deliverableId: null }, { deliverable: { archivedAt: null } }] } satisfies Prisma.MarketingTaskWhereInput;

export async function campaignTasks(actor: MkActor, campaignId: string, paging?: { page: number; size: number }) {
  const access = await campaignAccess(actor, campaignId);
  if (!access.canView) return null;
  const who = { select: { id: true, user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } };
  return prisma.marketingTask.findMany({
    where: { campaignId, ...ACTIVE_WORK },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    skip: paging ? (Math.max(1, paging.page) - 1) * paging.size : undefined,
    take: paging ? paging.size : TASKS_TAKE,
    include: {
      assignee: who,
      deliverable: { select: { id: true, title: true } },
      dependsOn: { select: { dependsOn: { select: { id: true, title: true, status: true } } } },
      files: { select: { id: true, fileName: true, byteSize: true } },
      _count: { select: { comments: true } },
    },
  });
}

/** عددُ المهامّ، وقائمةٌ خفيفةٌ (معرّفٌ وعنوان) لاختيار الاعتماديات — لا تفاصيلَ ولا مرفقات */
export async function campaignTaskIndex(actor: MkActor, campaignId: string) {
  const access = await campaignAccess(actor, campaignId);
  if (!access.canView) return null;
  const [total, options] = await Promise.all([
    prisma.marketingTask.count({ where: { campaignId, ...ACTIVE_WORK } }),
    prisma.marketingTask.findMany({ where: { campaignId, status: { not: "cancelled" }, ...ACTIVE_WORK }, orderBy: { createdAt: "asc" }, take: TASKS_TAKE, select: { id: true, title: true } }),
  ]);
  return { total, options };
}

const COMMENTS_TAKE = 200;

/** تعليقاتُ الحملة — أو مخرجٍ فيها بعينه — لمن يرى الحملة */
export async function campaignComments(actor: MkActor, campaignId: string, opts: { deliverableId?: string } = {}) {
  const access = await campaignAccess(actor, campaignId);
  if (!access.canView) return null;
  return prisma.marketingComment.findMany({
    where: { campaignId, ...(opts.deliverableId ? { deliverableId: opts.deliverableId } : {}) },
    orderBy: { createdAt: "asc" },
    take: COMMENTS_TAKE,
    select: {
      id: true,
      body: true,
      createdAt: true,
      deliverable: { select: { id: true, title: true } },
      task: { select: { id: true, title: true } },
      author: { select: { id: true, user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } },
    },
  });
}
