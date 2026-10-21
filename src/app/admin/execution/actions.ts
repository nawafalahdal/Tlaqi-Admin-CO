"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safeError";
import {
  submitPeriod,
  approvePeriodForReview,
  beginReview,
  completeReview,
  openPeriod,
  reopenPeriod,
} from "@/lib/execution";
import {
  submitWeekPlan,
  decideWeekPlan,
  recordCarryoverPlan,
  ensureWeekPlan,
} from "@/lib/carryover";
import {
  createTask,
  updateTaskState,
  submitTaskWork,
  reviewTask,
  changeTaskDeadline,
  waiveTask,
  reassignTask,
} from "@/lib/tasks";
import { createGoal, createMilestone, decideGoal, proposeObjective, decideObjective } from "@/lib/goals";
import {
  saveMeetingSettings,
  markAgendaStage,
  markMeetingHeld,
  addMeetingDecision,
  type AgendaStageKey,
} from "@/lib/reviewMeeting";
import { prisma } from "@/lib/prisma";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
/** إجراءاتُ نظام التنفيذ.
 *
 *  **والتصريحُ يُفرَض في طبقة المنطق لا هنا:** كلُّ دالّةٍ في
 *  `@/lib/execution` و`@/lib/tasks` و`@/lib/carryover` تَفحص الجلسةَ
 *  بنفسها. فهذه أبوابٌ تُنادى من أي مكان — من صفحةٍ أو من سطرِ أوامر أو
 *  بتعديل حالةِ العميل — والحرسُ عند الحقيقة لا عند الواجهة.
 */

function refresh() {
  revalidatePath("/admin/execution");
  revalidatePath("/admin/execution/review");
  revalidatePath("/admin");
  revalidatePath("/member");
  revalidatePath("/calendar");
  // أهدافُ القسم تُقرأ في صفحة قسمها — فتُحدَّث مع اقتراحها والقرار فيها
  revalidatePath("/admin/departments/[slug]", "page");
}

type Res = { error: string | null; message?: string };

async function need() {
  const L = getDictionary(await getLocale()).rExecActions;
  const session = await auth();
  if (!session) throw new Error(L.youNeedToSign);
  return session;
}

// ── الفترة ─────────────────────────────────────────────────────────

export async function submitPeriodAction(periodId: string): Promise<Res> {
  try {
    const res = await submitPeriod({ periodId, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function approvePeriodAction(periodId: string): Promise<Res> {
  try {
    const res = await approvePeriodForReview({ periodId, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function beginReviewAction(periodId: string): Promise<Res> {
  try {
    const res = await beginReview({ periodId, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function completeReviewAction(periodId: string): Promise<Res> {
  try {
    const res = await completeReview({ periodId, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** فتحُ الأسبوع — ومع سببٍ حين يكون استثناءً قبل اكتمال المراجعة */
export async function openPeriodAction(periodId: string, emergencyReason?: string): Promise<Res> {
  try {
    const res = await openPeriod({
      periodId,
      session: await need(),
      emergencyReason: emergencyReason ?? null,
    });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function reopenPeriodAction(periodId: string, reason: string): Promise<Res> {
  try {
    const res = await reopenPeriod({ periodId, session: await need(), reason });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ── خططُ الأقسام ───────────────────────────────────────────────────

export async function ensurePlanAction(periodId: string, departmentId: string): Promise<Res> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const session = await need();
    // الإنشاءُ لا يَمنح صلاحية: `createTask` و`submitWeekPlan` يَفحصان
    if (
      session.user.role !== "super_admin" &&
      session.user.role !== "executive" &&
      !(session.user.role === "department_admin" && session.user.departmentId === departmentId)
    ) {
      return { error: L.theDepartmentSPlan };
    }
    await ensureWeekPlan(periodId, departmentId);
    refresh();
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function submitPlanAction(planId: string): Promise<Res> {
  try {
    const res = await submitWeekPlan({ planId, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function decidePlanAction(
  planId: string,
  decision: "approved" | "returned",
  note: string,
  acknowledgeOverload = false
): Promise<Res> {
  try {
    const res = await decideWeekPlan({
      planId,
      decision,
      note,
      acknowledgeOverload,
      session: await need(),
    });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function setCapacityAction(planId: string, capacityPoints: number): Promise<Res> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const session = await need();
    const plan = await prisma.weekPlan.findUnique({
      where: { id: planId },
      select: { departmentId: true },
    });
    if (!plan) return { error: L.planNotFound };
    const allowed =
      session.user.role === "super_admin" ||
      session.user.role === "executive" ||
      (session.user.role === "department_admin" && session.user.departmentId === plan.departmentId);
    if (!allowed) return { error: L.settingCapacityIsFor };
    const points = Math.max(1, Math.min(200, Math.round(capacityPoints)));
    await prisma.weekPlan.update({ where: { id: planId }, data: { capacityPoints: points } });
    refresh();
    return { error: null, message: fmt(L.capacitySetTo, points) };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function recordCarryoverPlanAction(
  taskId: string,
  reason: string,
  correctivePlan: string
): Promise<Res> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const res = await recordCarryoverPlan({
      taskId,
      reason,
      correctivePlan,
      session: await need(),
    });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: L.theCarryOverReason };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ── المهامّ ────────────────────────────────────────────────────────

export async function createTaskAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const session = await need();
    const owner = String(formData.get("owner") ?? "");
    const [kind, id] = owner.split(":");
    const dueRaw = String(formData.get("dueAt") ?? "");
    if (!dueRaw) return { error: L.theTaskSDue, success: false };

    const res = await createTask({
      planId: String(formData.get("planId") ?? ""),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
      deliverable: String(formData.get("deliverable") ?? ""),
      ownerUserId: kind === "user" ? id : null,
      ownerMemberId: kind === "member" ? id : null,
      dueAt: new Date(dueRaw),
      weight: Number(formData.get("weight") ?? 1),
      priority: (String(formData.get("priority") ?? "normal") as "critical" | "high" | "normal" | "low"),
      goalId: String(formData.get("goalId") ?? "") || null,
      milestoneId: String(formData.get("milestoneId") ?? "") || null,
      objectiveId: String(formData.get("objectiveId") ?? "") || null,
      session,
    });
    if (!res.ok) return { error: res.reason, success: false };
    refresh();
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function updateTaskStateAction(
  taskId: string,
  state: "not_started" | "in_progress" | "blocked",
  blockedReason?: string
): Promise<Res> {
  try {
    const res = await updateTaskState({ taskId, state, blockedReason, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function submitTaskWorkAction(
  _prev: { error: string | null; success: boolean; message?: string },
  formData: FormData
): Promise<{ error: string | null; success: boolean; message?: string }> {
  try {
    const session = await need();
    const upload = formData.get("evidence");
    const file =
      upload instanceof File && upload.size > 0
        ? { name: upload.name, type: upload.type, bytes: new Uint8Array(await upload.arrayBuffer()) }
        : null;

    const res = await submitTaskWork({
      taskId: String(formData.get("taskId") ?? ""),
      note: String(formData.get("note") ?? ""),
      evidenceUrl: String(formData.get("evidenceUrl") ?? ""),
      file,
      session,
    });
    if (!res.ok) return { error: res.reason, success: false };
    refresh();
    return { error: null, success: true, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function reviewTaskAction(
  taskId: string,
  decision: "verified" | "returned" | "incomplete" | "flagged",
  note: string
): Promise<Res> {
  try {
    const res = await reviewTask({ taskId, decision, note, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function changeDeadlineAction(
  taskId: string,
  newDueAt: string,
  reason: string
): Promise<Res> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    if (!newDueAt) return { error: L.theNewDueDate };
    const res = await changeTaskDeadline({
      taskId,
      newDueAt: new Date(newDueAt),
      reason,
      session: await need(),
    });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function waiveTaskAction(
  taskId: string,
  kind: "waive" | "cancel" | "defer" | "supersede",
  reason: string
): Promise<Res> {
  try {
    const res = await waiveTask({ taskId, kind, reason, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function reassignTaskAction(
  taskId: string,
  owner: string,
  reason: string
): Promise<Res> {
  try {
    const [kind, id] = owner.split(":");
    const res = await reassignTask({
      taskId,
      ownerUserId: kind === "user" ? id : null,
      ownerMemberId: kind === "member" ? id : null,
      reason,
      session: await need(),
    });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ── الأهداف ────────────────────────────────────────────────────────

export async function createGoalAction(
  _prev: { error: string | null; success: boolean; message?: string },
  formData: FormData
): Promise<{ error: string | null; success: boolean; message?: string }> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const session = await need();
    const res = await createGoal({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      rationale: String(formData.get("rationale") ?? ""),
      impact: String(formData.get("impact") ?? ""),
      successCriteria: String(formData.get("successCriteria") ?? ""),
      baselineValue: String(formData.get("baselineValue") ?? ""),
      targetValue: String(formData.get("targetValue") ?? ""),
      startDate: new Date(String(formData.get("startDate") ?? "")),
      dueDate: new Date(String(formData.get("dueDate") ?? "")),
      priority: (String(formData.get("priority") ?? "normal") as "critical" | "high" | "normal" | "low"),
      accountableUserId: String(formData.get("accountableUserId") ?? "") || null,
      ownerUserId: String(formData.get("ownerUserId") ?? "") || null,
      session,
    });
    if (!res.ok) return { error: res.reason, success: false };
    refresh();
    revalidatePath("/admin/execution/goals");
    return {
      error: null,
      success: true,
      message: res.status === "approved" ? L.theGoalWasCreated : L.theProposalWasSent,
    };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function decideGoalAction(
  goalId: string,
  decision: "approved" | "rejected",
  note: string
): Promise<Res> {
  try {
    const res = await decideGoal({ goalId, decision, note, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    revalidatePath("/admin/execution/goals");
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function createMilestoneAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const res = await createMilestone({
      goalId: String(formData.get("goalId") ?? ""),
      title: String(formData.get("title") ?? ""),
      expectedResult: String(formData.get("expectedResult") ?? ""),
      acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
      startDate: new Date(String(formData.get("startDate") ?? "")),
      dueDate: new Date(String(formData.get("dueDate") ?? "")),
      ownerUserId: String(formData.get("ownerUserId") ?? "") || null,
      session: await need(),
    });
    if (!res.ok) return { error: res.reason, success: false };
    refresh();
    revalidatePath("/admin/execution/goals");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function proposeObjectiveAction(
  _prev: { error: string | null; success: boolean; message?: string },
  formData: FormData
): Promise<{ error: string | null; success: boolean; message?: string }> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const res = await proposeObjective({
      departmentId: String(formData.get("departmentId") ?? ""),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
      goalId: String(formData.get("goalId") ?? "") || null,
      dueDate: String(formData.get("dueDate") ?? "") ? new Date(String(formData.get("dueDate"))) : null,
      session: await need(),
    });
    if (!res.ok) return { error: res.reason, success: false };
    refresh();
    return {
      error: null,
      success: true,
      message: res.status === "approved" ? L.createdAsApproved : L.theProposalWasSent2,
    };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function decideObjectiveAction(
  objectiveId: string,
  decision: "approved" | "rejected",
  note: string
): Promise<Res> {
  try {
    const res = await decideObjective({ objectiveId, decision, note, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ── الاجتماع ───────────────────────────────────────────────────────

export async function saveMeetingSettingsAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const res = await saveMeetingSettings({
      weekday: Number(formData.get("weekday") ?? 6),
      hour: Number(formData.get("hour") ?? 21),
      minute: Number(formData.get("minute") ?? 0),
      durationMinutes: Number(formData.get("durationMinutes") ?? 60),
      organizerName: String(formData.get("organizerName") ?? ""),
      locationOrUrl: String(formData.get("locationOrUrl") ?? ""),
      agendaTemplate: String(formData.get("agendaTemplate") ?? ""),
      session: await need(),
    });
    if (!res.ok) return { error: res.reason, success: false };
    refresh();
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function markStageAction(
  periodId: string,
  stage: AgendaStageKey,
  done: boolean
): Promise<Res> {
  try {
    const res = await markAgendaStage({ periodId, stage, done, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function markMeetingHeldAction(periodId: string, notes: string): Promise<Res> {
  try {
    const res = await markMeetingHeld({ periodId, notes, session: await need() });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: res.message };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function addDecisionAction(
  periodId: string,
  text: string,
  dueAt?: string
): Promise<Res> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const res = await addMeetingDecision({
      periodId,
      text,
      dueAt: dueAt ? new Date(dueAt) : null,
      session: await need(),
    });
    if (!res.ok) return { error: res.reason };
    refresh();
    return { error: null, message: L.theDecisionWasRecorded };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** معالجُ الهدف — هدفٌ ومحطّاتُه في خطوةٍ واحدة من صاحبه.
 *
 *  لا قاعدةَ جديدة هنا: يُنادي `createGoal` ثم `createMilestone` لكل محطّة،
 *  وكلٌّ منهما يفرض شرطه كما كان (من يُنشئ، ومن يعتمد، والتواريخ). فإن
 *  رُفضت محطّةٌ بقي الهدف قائماً، ويُقال سببُ رفضها بعينه — لا يُمحى هدفٌ
 *  أُنشئ لأن محطّةً تأخّر موعدها عنه. */
export async function createGoalWizardAction(input: {
  title: string;
  description: string;
  rationale: string;
  impact: string;
  successCriteria: string;
  baselineValue: string;
  targetValue: string;
  priority: "critical" | "high" | "normal" | "low";
  accountableUserId: string;
  ownerUserId: string;
  startDate: string;
  dueDate: string;
  milestones: {
    title: string;
    expectedResult: string;
    acceptanceCriteria: string;
    startDate: string;
    dueDate: string;
    ownerUserId: string;
  }[];
}): Promise<
  | { ok: true; status: string; message: string; milestoneErrors: string[] }
  | { ok: false; error: string }
> {
  const L = getDictionary(await getLocale()).rExecActions;
  try {
    const session = await need();
    const res = await createGoal({
      title: input.title,
      description: input.description,
      rationale: input.rationale,
      impact: input.impact,
      successCriteria: input.successCriteria,
      baselineValue: input.baselineValue,
      targetValue: input.targetValue,
      startDate: new Date(input.startDate),
      dueDate: new Date(input.dueDate),
      priority: input.priority,
      accountableUserId: input.accountableUserId || null,
      ownerUserId: input.ownerUserId || null,
      session,
    });
    if (!res.ok) return { ok: false, error: res.reason };

    const milestoneErrors: string[] = [];
    // المحطّاتُ تُبنى لهدفٍ معتمَد وحده — والمقترَحُ تُضاف محطّاتُه بعد اعتماده
    if (res.status === "approved") {
      for (const m of input.milestones) {
        const r = await createMilestone({
          goalId: res.id,
          title: m.title,
          expectedResult: m.expectedResult,
          acceptanceCriteria: m.acceptanceCriteria,
          startDate: new Date(m.startDate),
          dueDate: new Date(m.dueDate),
          ownerUserId: m.ownerUserId || null,
          session,
        });
        if (!r.ok) milestoneErrors.push(`«${m.title || L.milestone}»: ${r.reason}`);
      }
    }
    refresh();
    revalidatePath("/admin/execution/goals");
    return {
      ok: true,
      status: res.status,
      message: res.status === "approved" ? L.theGoalWasCreated : L.theProposalWasSent,
      milestoneErrors,
    };
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) };
  }
}
