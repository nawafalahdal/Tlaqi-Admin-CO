import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import type { TaskExecState, WorkPriority, Prisma } from "@prisma/client";
import { assertPeriodWritable, canPlanDepartment, canReviewWork } from "@/lib/execution";
import { MAX_PLAN_FILE_BYTES, ALLOWED_PLAN_TYPES } from "@/lib/planFormats";

/** المهامُّ: إسنادُها، وتحديثُها، وتسليمُها، والتحقّقُ منها.
 *
 *  ## الفصلُ الذي تقوم عليه المحاسبة كلُّها
 *
 *  **ما يُعلنه صاحبُ العمل شيء، وما يَتحقّق منه التنفيذي شيءٌ آخر.**
 *  فالعضوُ يَرفع تسليمَه فتصير المهمّةُ `submitted` — لا `verified`.
 *  ولا ترتفع نسبةُ الإنجاز المعتمَد بضغطةٍ من صاحب المهمّة: ترتفع
 *  بقرارٍ من مُراجِعٍ اطّلع على الدليل. ولو جُعلا حالةً واحدةً لصارت
 *  «الإنجاز» إقراراً ذاتياً — وهذا بالضبط ما تُلغيه هذه المنصة.
 *
 *  ## ولا أحدَ يُصدّق على عمله
 *
 *  `verifyTask` تَرفض أن يكون المُراجِعُ هو صاحبَ المهمّة — ولو كان
 *  مديراً تنفيذياً. فمن رفع العمل لا يَحكم عليه.
 */

/** من يُحدِّث مهمّةً: صاحبُها، أو قائدُ قسمها، أو الإدارة.
 *
 *  والعضوُ لا جلسةَ `User` له بل جلسةُ عضو، فيُقارَن معرّفُه بـ
 *  `ownerMemberId`. والمقارنةُ على **المهمّة نفسها** لا على القسم:
 *  عضوٌ في القسم لا يُحدِّث مهمّةَ زميله. */
export function canUpdateTask(
  session: Session,
  task: { ownerUserId: string | null; ownerMemberId: string | null; departmentId: string | null }
) {
  if (canReviewWork(session.user.role)) return true;
  if (task.ownerUserId && task.ownerUserId === session.user.id) return true;
  if (task.ownerMemberId && task.ownerMemberId === session.user.id) return true;
  if (task.departmentId && canPlanDepartment(session, task.departmentId)) return true;
  return false;
}

export type TaskResult = { ok: true; id: string; message: string } | { ok: false; reason: string };

/** يُنشئ مهمّةً في خطة أسبوع.
 *
 *  **ولا تُقبَل مهمّةٌ بلا صاحبٍ وموعدٍ ومعيارِ إنجاز.** وهذا شرطُ
 *  المواصفة صريحاً، وله وجهٌ عمليّ: مهمّةٌ بلا معيارٍ لا يُمكن التحقّقُ
 *  منها، فتُناقَش في كل اجتماعٍ ولا تُغلَق. ومهمّةٌ بلا صاحبٍ لا
 *  يُحاسَب عليها أحد. */
export async function createTask(opts: {
  planId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria: string;
  deliverable?: string | null;
  ownerUserId?: string | null;
  ownerMemberId?: string | null;
  dueAt: Date;
  priority?: WorkPriority;
  weight?: number;
  goalId?: string | null;
  milestoneId?: string | null;
  objectiveId?: string | null;
  session: Session;
}): Promise<TaskResult> {
  const plan = await prisma.weekPlan.findUnique({
    where: { id: opts.planId },
    select: {
      id: true,
      departmentId: true,
      periodId: true,
      state: true,
      period: { select: { state: true, weekStart: true, weekEnd: true } },
    },
  });
  if (!plan) return { ok: false, reason: "خطة الأسبوع غير موجودة" };
  if (!canPlanDepartment(opts.session, plan.departmentId)) {
    return { ok: false, reason: "بناءُ خطة القسم لقائده — ومن يعلوه" };
  }
  // **الخطةُ المعتمَدة لا تُزاد مهامَّ بلا قرار:** الزيادةُ بعد الاعتماد
  // تُفرِغ الاعتمادَ من معناه — والمواصفةُ تُسمّيها تغييرَ نطاق.
  if (plan.state === "approved" && !canReviewWork(opts.session.user.role)) {
    return {
      ok: false,
      reason: "الخطةُ معتمَدة — إضافةُ مهمّةٍ إليها تغييرُ نطاقٍ يُقرّه التنفيذي",
    };
  }

  const title = opts.title.trim();
  const criteria = opts.acceptanceCriteria.trim();
  if (!title) return { ok: false, reason: "عنوان المهمّة مطلوب" };
  if (!criteria) {
    return {
      ok: false,
      reason: "معيارُ الإنجاز مطلوب — وبلا معيارٍ لا يُمكن التحقّقُ منها فتبقى مفتوحةً أبداً",
    };
  }
  if (!opts.ownerUserId && !opts.ownerMemberId) {
    return { ok: false, reason: "صاحبُ المهمّة مطلوب — ولا يُحاسَب على عملٍ بلا صاحب" };
  }
  if (opts.ownerUserId && opts.ownerMemberId) {
    return { ok: false, reason: "صاحبٌ واحدٌ لا اثنان" };
  }
  const weight = Math.max(1, Math.min(100, Math.round(opts.weight ?? 1)));

  const task = await prisma.planTask.create({
    data: {
      planId: plan.id,
      periodId: plan.periodId,
      departmentId: plan.departmentId,
      goalId: opts.goalId ?? null,
      milestoneId: opts.milestoneId ?? null,
      objectiveId: opts.objectiveId ?? null,
      title,
      description: opts.description?.trim() || null,
      acceptanceCriteria: criteria,
      deliverable: opts.deliverable?.trim() || null,
      ownerUserId: opts.ownerUserId ?? null,
      ownerMemberId: opts.ownerMemberId ?? null,
      priority: opts.priority ?? "normal",
      weight,
      // الموعدُ الأصليُّ يُكتَب مرّةً ولا يُمَسّ بعدها أبداً
      originalDueAt: opts.dueAt,
      dueAt: opts.dueAt,
      createdByName: opts.session.user.name ?? "—",
    },
    select: { id: true, title: true },
  });

  return { ok: true, id: task.id, message: `أُضيفت «${task.title}» إلى خطة الأسبوع` };
}

/** يُحدِّث حالةَ التنفيذ — ضمن ما يُسمَح به لصاحب المهمّة.
 *
 *  **ولا يَبلغ أحدٌ `verified` من هنا:** الحالاتُ المسموحةُ لصاحب
 *  العمل ثلاثٌ فقط — بدأ، أو توقّف بمعوّق، أو لم يبدأ. والتسليمُ له
 *  بابُه، والتحقّقُ ليس بيده أصلاً. */
export async function updateTaskState(opts: {
  taskId: string;
  state: Extract<TaskExecState, "not_started" | "in_progress" | "blocked">;
  blockedReason?: string | null;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  const task = await prisma.planTask.findUnique({
    where: { id: opts.taskId },
    select: {
      id: true,
      periodId: true,
      execState: true,
      ownerUserId: true,
      ownerMemberId: true,
      departmentId: true,
    },
  });
  if (!task) return { ok: false, reason: "المهمّة غير موجودة" };
  if (!canUpdateTask(opts.session, task)) {
    return { ok: false, reason: "تحديثُ المهمّة لصاحبها ولقائد قسمها" };
  }
  // القفلُ في الخادم: الأسبوعُ غيرُ المفتوح لا يُكتَب فيه مهما نُودي
  try {
    await assertPeriodWritable(task.periodId);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "الأسبوع غير مفتوح" };
  }
  if (task.execState === "verified") {
    return {
      ok: false,
      reason: "المهمّةُ متحقَّقٌ منها — ولا تُعاد إلى التنفيذ إلا بقرار مراجعةٍ يُبطل التحقّق",
    };
  }
  if (opts.state === "blocked" && !opts.blockedReason?.trim()) {
    return { ok: false, reason: "المعوّقُ يُسمّى — ولا تُعلَن مهمّةٌ متوقّفةً بلا سبب" };
  }

  await prisma.planTask.update({
    where: { id: task.id },
    data: {
      execState: opts.state,
      blockedReason: opts.state === "blocked" ? opts.blockedReason!.trim() : null,
    },
  });
  return { ok: true, message: "حُدِّثت حالةُ المهمّة" };
}

/** يَرفع تسليماً بدليله — فتنتقل المهمّةُ إلى انتظار التحقّق.
 *
 *  **ولا تُعَدّ منجَزةً بهذا.** هذه هي النقطةُ التي يَخلط فيها أكثرُ
 *  الأنظمة: زرُّ «تمّ» يرفع النسبة. وهنا يَرفع الطلبَ لا النسبة. */
export async function submitTaskWork(opts: {
  taskId: string;
  note: string;
  evidenceUrl?: string | null;
  file?: { name: string; type: string; bytes: Uint8Array } | null;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  const task = await prisma.planTask.findUnique({
    where: { id: opts.taskId },
    select: {
      id: true,
      periodId: true,
      execState: true,
      ownerUserId: true,
      ownerMemberId: true,
      departmentId: true,
      deliverable: true,
    },
  });
  if (!task) return { ok: false, reason: "المهمّة غير موجودة" };
  if (!canUpdateTask(opts.session, task)) {
    return { ok: false, reason: "رفعُ التسليم لصاحب المهمّة ولقائد قسمه" };
  }
  try {
    await assertPeriodWritable(task.periodId);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "الأسبوع غير مفتوح" };
  }

  const note = opts.note.trim();
  if (!note) return { ok: false, reason: "وصفُ ما أُنجز مطلوب — والمُراجِعُ يقرؤه قبل الدليل" };

  const url = opts.evidenceUrl?.trim() || null;
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "رابطُ الدليل غير صالح — يبدأ بـhttps://" };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "رابطُ الدليل يجب أن يبدأ بـhttps://" };
    }
  }

  const file = opts.file && opts.file.bytes.byteLength > 0 ? opts.file : null;
  if (file) {
    if (!ALLOWED_PLAN_TYPES[file.type]) {
      return { ok: false, reason: `نوعُ الملف غير مقبول (${file.type || "غير معروف"})` };
    }
    if (file.bytes.byteLength > MAX_PLAN_FILE_BYTES) {
      return {
        ok: false,
        reason: `حجم الدليل ${(file.bytes.byteLength / 1048576).toFixed(1)}MB — والحدّ ${(
          MAX_PLAN_FILE_BYTES / 1048576
        ).toFixed(0)}MB. ضَعه رابطاً.`,
      };
    }
  }
  if (!url && !file) {
    return { ok: false, reason: "الدليلُ مطلوب: رابطٌ أو ملف — والتحقّقُ لا يقع على كلامٍ وحده" };
  }

  await prisma.$transaction([
    prisma.taskSubmission.create({
      data: {
        taskId: task.id,
        note,
        evidenceUrl: url,
        evidenceFileName: file?.name ?? null,
        evidenceMime: file?.type ?? null,
        evidenceSize: file ? file.bytes.byteLength : null,
        evidenceData: file ? Buffer.from(file.bytes) : null,
        submittedById: opts.session.user.id,
        submittedByName: opts.session.user.name ?? "—",
      },
    }),
    prisma.planTask.update({
      where: { id: task.id },
      data: {
        execState: "submitted",
        reportedDoneAt: new Date(),
        reportedByName: opts.session.user.name ?? "—",
        blockedReason: null,
      },
    }),
  ]);

  return {
    ok: true,
    message: "رُفع تسليمُك للمراجعة — ولا يُحتسَب إنجازاً حتى يتحقّق منه التنفيذي",
  };
}

/** قرارُ المراجعة على تسليم: تحقُّقٌ، أو ردٌّ للتصحيح، أو عدمُ اكتمال.
 *
 *  **ولا يُصدّق أحدٌ على عمله**: المُراجِعُ الذي هو صاحبُ المهمّة
 *  يُرفَض ولو كان التنفيذي نفسه. */
export async function reviewTask(opts: {
  taskId: string;
  decision: "verified" | "returned" | "incomplete" | "flagged";
  note?: string | null;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canReviewWork(opts.session.user.role)) {
    return { ok: false, reason: "التحقّقُ من الإنجاز للمدير التنفيذي — ومعه المؤسس" };
  }
  const task = await prisma.planTask.findUnique({
    where: { id: opts.taskId },
    select: {
      id: true,
      title: true,
      execState: true,
      periodId: true,
      ownerUserId: true,
      ownerMemberId: true,
      submissions: { orderBy: { submittedAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  if (!task) return { ok: false, reason: "المهمّة غير موجودة" };

  // من رفع العمل لا يَحكم عليه — ولو ملك التحقّق
  if (task.ownerUserId && task.ownerUserId === opts.session.user.id) {
    return {
      ok: false,
      reason: "لا يُصدّق أحدٌ على عمله — هذه مهمّتُك، فليُراجِعها غيرُك",
    };
  }

  const note = opts.note?.trim() || null;
  if ((opts.decision === "returned" || opts.decision === "incomplete") && !note) {
    return { ok: false, reason: "الردُّ وعدمُ الاكتمال لا يقعان بلا سببٍ مكتوب" };
  }
  if (opts.decision === "verified" && task.execState !== "submitted") {
    return {
      ok: false,
      reason: "لا يُتحقَّق إلا من تسليمٍ مرفوع — واطّلِع على دليله قبل أن تقرّر",
    };
  }

  const nextState: TaskExecState =
    opts.decision === "verified"
      ? "verified"
      : opts.decision === "returned"
        ? "returned"
        : opts.decision === "incomplete"
          ? "incomplete"
          : task.execState;

  await prisma.$transaction([
    prisma.taskReview.create({
      data: {
        taskId: task.id,
        submissionId: task.submissions[0]?.id ?? null,
        periodId: task.periodId,
        decision: opts.decision,
        note,
        reviewerId: opts.session.user.id,
        reviewerName: opts.session.user.name ?? "—",
      },
    }),
    prisma.planTask.update({
      where: { id: task.id },
      data: {
        execState: nextState,
        verifiedAt: opts.decision === "verified" ? new Date() : null,
        verifiedById: opts.decision === "verified" ? opts.session.user.id : null,
        verifiedByName: opts.decision === "verified" ? (opts.session.user.name ?? "—") : null,
        // التحقّقُ يُنهي الترحيلَ المتتالي؛ وغيرُه لا يَمسّه
        ...(opts.decision === "verified" ? { consecutiveCarryover: 0 } : {}),
      },
    }),
  ]);

  const msg: Record<string, string> = {
    verified: `تحقّقتَ من «${task.title}» — وتُحتسَب الآن في الإنجاز المعتمَد`,
    returned: "رُدَّت للتصحيح — ووصل السببُ صاحبَها، والتسليمُ السابق محفوظ",
    incomplete: "سُجِّلت غيرَ مكتملة — وتبقى التزاماً قائماً يُرحَّل",
    flagged: "وُسِمت للنقاش في الاجتماع",
  };
  return { ok: true, message: msg[opts.decision] };
}

/** تغييرُ موعدٍ — بصلاحيةٍ، وبسببٍ، ومع حفظ الموعد الأصلي.
 *
 *  **والموعدُ الأصليُّ لا يُمَسّ أبداً:** التمديدُ لا يَمحو تأخّراً
 *  وقع، ولا يُعيد كتابة سجلِّ الالتزام. فيُقرأ في التقرير «مُدِّد» لا
 *  «كان موعدُه كذا» — وهذا الفرقُ هو كلُّ معنى المحاسبة. */
export async function changeTaskDeadline(opts: {
  taskId: string;
  newDueAt: Date;
  reason: string;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canReviewWork(opts.session.user.role)) {
    return {
      ok: false,
      reason: "تمديدُ الموعد المعتمَد للمدير التنفيذي — ومعه المؤسس. ويَطلبه قائدُ القسم بسببٍ مكتوب.",
    };
  }
  const reason = opts.reason?.trim();
  if (!reason) return { ok: false, reason: "التمديدُ لا يقع بلا سببٍ مكتوب" };

  const task = await prisma.planTask.findUnique({
    where: { id: opts.taskId },
    select: { id: true, dueAt: true, originalDueAt: true, title: true },
  });
  if (!task) return { ok: false, reason: "المهمّة غير موجودة" };

  await prisma.$transaction([
    prisma.planTask.update({
      where: { id: task.id },
      data: { dueAt: opts.newDueAt },
    }),
    prisma.workChange.create({
      data: {
        kind: "deadline_change",
        taskId: task.id,
        reason,
        previousJson: {
          dueAt: task.dueAt.toISOString(),
          originalDueAt: task.originalDueAt.toISOString(),
        } as Prisma.InputJsonValue,
        nextJson: { dueAt: opts.newDueAt.toISOString() } as Prisma.InputJsonValue,
        effectiveAt: new Date(),
        actorId: opts.session.user.id,
        actorName: opts.session.user.name ?? "—",
      },
    }),
  ]);

  return {
    ok: true,
    message: "مُدِّد الموعدُ المعتمَد — والموعدُ الأصليُّ محفوظٌ يُقاس به التأخّر",
  };
}

/** إسقاطُ التزامٍ أو إلغاؤه أو تأجيلُه — **ولا يُعَدّ إنجازاً**.
 *
 *  وهذا أخطرُ ما في النظام لو أُهمل: لو حُسب المُسقَطُ منجَزاً لأمكن
 *  بلوغُ مئةٍ بالمئة بإسقاط كل ما لم يُنجَز. فله حالاتُه الخاصة، ويُعَدّ
 *  في التقرير **منفصلاً** عن المنجَز وعن القائم. */
export async function waiveTask(opts: {
  taskId: string;
  kind: "waive" | "cancel" | "defer" | "supersede";
  reason: string;
  supersededById?: string | null;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canReviewWork(opts.session.user.role)) {
    return { ok: false, reason: "إسقاطُ الالتزام للمدير التنفيذي — ومعه المؤسس" };
  }
  const reason = opts.reason?.trim();
  if (!reason) return { ok: false, reason: "لا يُسقَط التزامٌ بلا سببٍ مكتوب" };

  const task = await prisma.planTask.findUnique({
    where: { id: opts.taskId },
    select: { id: true, title: true, execState: true },
  });
  if (!task) return { ok: false, reason: "المهمّة غير موجودة" };
  if (task.execState === "verified") {
    return { ok: false, reason: "المهمّةُ منجَزةٌ متحقَّقٌ منها — ولا تُسقَط بعد إنجازها" };
  }

  const state: TaskExecState =
    opts.kind === "waive"
      ? "waived"
      : opts.kind === "cancel"
        ? "cancelled"
        : opts.kind === "defer"
          ? "deferred"
          : "superseded";

  await prisma.$transaction([
    prisma.planTask.update({
      where: { id: task.id },
      data: {
        execState: state,
        waivedAt: new Date(),
        waivedReason: reason,
        supersededById: opts.kind === "supersede" ? (opts.supersededById ?? null) : null,
      },
    }),
    prisma.workChange.create({
      data: {
        kind: opts.kind === "waive" ? "waive" : opts.kind === "cancel" ? "cancel" : opts.kind === "defer" ? "defer" : "supersede",
        taskId: task.id,
        reason,
        previousJson: { execState: task.execState } as Prisma.InputJsonValue,
        nextJson: { execState: state } as Prisma.InputJsonValue,
        effectiveAt: new Date(),
        actorId: opts.session.user.id,
        actorName: opts.session.user.name ?? "—",
      },
    }),
  ]);

  const label: Record<string, string> = {
    waive: "أُسقط الالتزامُ بقرارك — ولا يُحتسَب إنجازاً، ويبقى في السجل",
    cancel: "أُلغيت — ولا تُحتسَب إنجازاً",
    defer: "أُجّلت إلى التزامٍ لاحق — ولا تُحتسَب إنجازاً",
    supersede: "حلّ محلَّها التزامٌ آخر — ولا تُحتسَب إنجازاً",
  };
  return { ok: true, message: label[opts.kind] };
}

/** نقلُ مسؤوليةٍ بقرار — والمسؤوليةُ الأصلية تبقى مكتوبة */
export async function reassignTask(opts: {
  taskId: string;
  ownerUserId?: string | null;
  ownerMemberId?: string | null;
  departmentId?: string | null;
  reason: string;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canReviewWork(opts.session.user.role)) {
    return { ok: false, reason: "نقلُ المسؤولية للمدير التنفيذي — ومعه المؤسس" };
  }
  const reason = opts.reason?.trim();
  if (!reason) return { ok: false, reason: "النقلُ لا يقع بلا سببٍ مكتوب" };
  if (!opts.ownerUserId && !opts.ownerMemberId) {
    return { ok: false, reason: "الصاحبُ الجديد مطلوب — ولا تُترَك مهمّةٌ بلا صاحب" };
  }

  const task = await prisma.planTask.findUnique({
    where: { id: opts.taskId },
    select: { id: true, ownerUserId: true, ownerMemberId: true, departmentId: true },
  });
  if (!task) return { ok: false, reason: "المهمّة غير موجودة" };

  await prisma.$transaction([
    prisma.planTask.update({
      where: { id: task.id },
      data: {
        ownerUserId: opts.ownerUserId ?? null,
        ownerMemberId: opts.ownerMemberId ?? null,
        ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
      },
    }),
    prisma.workChange.create({
      data: {
        kind: "reassign",
        taskId: task.id,
        reason,
        previousJson: {
          ownerUserId: task.ownerUserId,
          ownerMemberId: task.ownerMemberId,
          departmentId: task.departmentId,
        } as Prisma.InputJsonValue,
        nextJson: {
          ownerUserId: opts.ownerUserId ?? null,
          ownerMemberId: opts.ownerMemberId ?? null,
          departmentId: opts.departmentId ?? task.departmentId,
        } as Prisma.InputJsonValue,
        effectiveAt: new Date(),
        actorId: opts.session.user.id,
        actorName: opts.session.user.name ?? "—",
      },
    }),
  ]);
  return { ok: true, message: "نُقلت المسؤولية — والمسؤوليةُ السابقة مكتوبةٌ في السجل" };
}

/** دليلُ تسليمٍ واحد — لمسار التنزيل، وهو الموضع الوحيد الذي تُقرأ فيه بايتاتُه */
export async function submissionEvidence(submissionId: string) {
  const row = await prisma.taskSubmission.findUnique({
    where: { id: submissionId },
    select: { evidenceFileName: true, evidenceMime: true, evidenceData: true, taskId: true },
  });
  if (!row?.evidenceData || !row.evidenceMime) return null;
  if (!ALLOWED_PLAN_TYPES[row.evidenceMime]) return null;
  return {
    taskId: row.taskId,
    fileName: row.evidenceFileName ?? "evidence",
    mimeType: row.evidenceMime,
    bytes: Buffer.from(row.evidenceData),
  };
}

/** هل المهمّةُ متأخّرة؟ — يُحسَب ولا يُخزَّن حالةً */
export function isOverdue(
  task: { dueAt: Date; execState: TaskExecState },
  now: Date = new Date()
) {
  if (["verified", "waived", "cancelled", "superseded", "deferred"].includes(task.execState)) {
    return false;
  }
  return task.dueAt.getTime() < now.getTime();
}
