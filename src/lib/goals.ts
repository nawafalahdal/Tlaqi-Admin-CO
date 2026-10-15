import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import type { WorkPriority, Prisma } from "@prisma/client";
import { canPlanDepartment } from "@/lib/execution";

/** الأهدافُ الاستراتيجية ومحطّاتُها وأهدافُ الأقسام.
 *
 *  ## الاقتراحُ ليس التزاماً
 *
 *  قائدُ القسم **يقترح** هدفاً، ولا يصير التزاماً تنظيمياً إلا باعتماد
 *  الإدارة. وهذا هو الفرقُ بين خطةٍ للمنظمة وقائمةِ أمنياتٍ للأقسام.
 *  والحالةُ تُفرِّق بينهما صراحةً (`proposed` / `approved`)، فلا يُقرأ
 *  مقترَحٌ في تقرير الالتزامات.
 *
 *  ## والمحطّةُ نتيجةٌ لا قسمةٌ حسابية
 *
 *  «ثلث الهدف في الشهر الأول» ليست محطّة — هي قسمةٌ على ثلاثة. فالمحطّةُ
 *  تُلزَم بـ«النتيجة المتوقَّعة» و«معيار القبول»، فإن لم يُكتَبا لم
 *  تُقبَل: محطّةٌ بلا معيارٍ لا يُمكن الحكمُ عليها فتُؤجَّل إلى الأبد.
 */

export function canApproveGoal(role: string) {
  return role === "super_admin" || role === "executive";
}

/** إنشاءُ هدفٍ استراتيجي — تُنشئه الإدارة معتمَداً، ويقترحه غيرُها */
export async function createGoal(opts: {
  title: string;
  description: string;
  rationale: string;
  impact?: string | null;
  successCriteria: string;
  baselineValue?: string | null;
  targetValue?: string | null;
  startDate: Date;
  dueDate: Date;
  priority?: WorkPriority;
  accountableUserId?: string | null;
  ownerUserId?: string | null;
  session: Session;
}): Promise<{ ok: true; id: string; status: string } | { ok: false; reason: string }> {
  const role = opts.session.user.role;
  if (!canApproveGoal(role) && role !== "department_admin") {
    return { ok: false, reason: "الأهدافُ الاستراتيجية تُقترَح من القيادة" };
  }

  const title = opts.title.trim();
  const description = opts.description.trim();
  const rationale = opts.rationale.trim();
  const criteria = opts.successCriteria.trim();
  if (!title) return { ok: false, reason: "عنوان الهدف مطلوب" };
  if (!description) return { ok: false, reason: "وصفُ الهدف مطلوب" };
  if (!rationale) {
    return { ok: false, reason: "المسوّغُ مطلوب — هدفٌ بلا «لماذا» لا يُحاسَب على أثره" };
  }
  if (!criteria) {
    return { ok: false, reason: "معيارُ النجاح مطلوب — وبلا معيارٍ يُقاس لا يُعرَف أتحقّق أم لا" };
  }
  if (opts.dueDate <= opts.startDate) {
    return { ok: false, reason: "موعدُ الهدف بعد بدايته" };
  }

  // الإدارةُ تُنشئه معتمَداً، وقائدُ القسم يُنشئه مقترَحاً
  const approved = canApproveGoal(role);
  const goal = await prisma.strategicGoal.create({
    data: {
      title,
      description,
      rationale,
      impact: opts.impact?.trim() || null,
      successCriteria: criteria,
      baselineValue: opts.baselineValue?.trim() || null,
      targetValue: opts.targetValue?.trim() || null,
      startDate: opts.startDate,
      dueDate: opts.dueDate,
      priority: opts.priority ?? "normal",
      accountableUserId: opts.accountableUserId ?? null,
      ownerUserId: opts.ownerUserId ?? null,
      status: approved ? "approved" : "proposed",
      proposedById: opts.session.user.id,
      proposedByName: opts.session.user.name ?? "—",
      approvedAt: approved ? new Date() : null,
      approvedById: approved ? opts.session.user.id : null,
      approvedByName: approved ? (opts.session.user.name ?? "—") : null,
      createdByName: opts.session.user.name ?? "—",
    },
    select: { id: true, status: true },
  });
  return { ok: true, id: goal.id, status: goal.status };
}

/** قرارُ الإدارة في هدفٍ مقترَح */
export async function decideGoal(opts: {
  goalId: string;
  decision: "approved" | "rejected";
  note?: string | null;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canApproveGoal(opts.session.user.role)) {
    return { ok: false, reason: "اعتمادُ الأهداف للمؤسس والمدير التنفيذي" };
  }
  const note = opts.note?.trim() || null;
  if (opts.decision === "rejected" && !note) {
    return { ok: false, reason: "الردُّ لا يقع بلا سببٍ مكتوب" };
  }

  const written = await prisma.strategicGoal.updateMany({
    where: { id: opts.goalId, status: { in: ["draft", "proposed"] } },
    data: {
      status: opts.decision,
      approvedAt: opts.decision === "approved" ? new Date() : null,
      approvedById: opts.decision === "approved" ? opts.session.user.id : null,
      approvedByName: opts.decision === "approved" ? (opts.session.user.name ?? "—") : null,
      decisionNote: note,
    },
  });
  if (written.count === 0) {
    return { ok: false, reason: "هذا الهدف قُضي فيه سلفاً — ولا يُنقَض القرار من هنا" };
  }

  await prisma.workChange.create({
    data: {
      kind: "scope_change",
      goalId: opts.goalId,
      reason: note ?? (opts.decision === "approved" ? "اعتماد هدف" : "ردّ هدف"),
      nextJson: { status: opts.decision } as Prisma.InputJsonValue,
      actorId: opts.session.user.id,
      actorName: opts.session.user.name ?? "—",
    },
  });
  return {
    ok: true,
    message: opts.decision === "approved" ? "اعتُمد الهدف — وصار التزاماً تنظيمياً" : "رُدّ الهدف بسببه",
  };
}

/** محطّةٌ شهرية — بنتيجةٍ متوقَّعةٍ ومعيارِ قبول */
export async function createMilestone(opts: {
  goalId: string;
  title: string;
  expectedResult: string;
  acceptanceCriteria: string;
  ownerUserId?: string | null;
  startDate: Date;
  dueDate: Date;
  session: Session;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!canApproveGoal(opts.session.user.role)) {
    return { ok: false, reason: "المحطّاتُ الشهرية تُعتمَد من المؤسس والمدير التنفيذي" };
  }
  const title = opts.title.trim();
  const result = opts.expectedResult.trim();
  const criteria = opts.acceptanceCriteria.trim();
  if (!title) return { ok: false, reason: "عنوان المحطّة مطلوب" };
  if (!result) {
    return {
      ok: false,
      reason: "النتيجةُ المتوقَّعة مطلوبة — والمحطّةُ نتيجةٌ تُسلَّم لا قسمةٌ حسابيةٌ للهدف",
    };
  }
  if (!criteria) return { ok: false, reason: "معيارُ القبول مطلوب" };
  if (opts.dueDate <= opts.startDate) return { ok: false, reason: "موعدُ المحطّة بعد بدايتها" };

  const goal = await prisma.strategicGoal.findUnique({
    where: { id: opts.goalId },
    select: { id: true, status: true, startDate: true, dueDate: true },
  });
  if (!goal) return { ok: false, reason: "الهدف غير موجود" };
  if (goal.status === "proposed" || goal.status === "draft") {
    return { ok: false, reason: "لا تُبنى محطّاتٌ لهدفٍ لم يُعتمَد بعد" };
  }
  // المحطّةُ داخل مدى هدفها: محطّةٌ بعد موعد الهدف وعدٌ لا يُوفى
  if (opts.dueDate > goal.dueDate) {
    return { ok: false, reason: "موعدُ المحطّة بعد موعد الهدف نفسه — عدِّل أحدَهما" };
  }

  const count = await prisma.milestone.count({ where: { goalId: goal.id } });
  const milestone = await prisma.milestone.create({
    data: {
      goalId: goal.id,
      title,
      expectedResult: result,
      acceptanceCriteria: criteria,
      ownerUserId: opts.ownerUserId ?? null,
      startDate: opts.startDate,
      dueDate: opts.dueDate,
      order: count + 1,
    },
    select: { id: true },
  });
  return { ok: true, id: milestone.id };
}

/** هدفُ قسمٍ — يقترحه قائدُه ويعتمده التنفيذي */
export async function proposeObjective(opts: {
  departmentId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  goalId?: string | null;
  milestoneId?: string | null;
  dueDate?: Date | null;
  priority?: WorkPriority;
  session: Session;
}): Promise<{ ok: true; id: string; status: string } | { ok: false; reason: string }> {
  if (!canPlanDepartment(opts.session, opts.departmentId)) {
    return { ok: false, reason: "أهدافُ القسم يقترحها قائدُه — ومن يعلوه" };
  }
  const title = opts.title.trim();
  if (!title) return { ok: false, reason: "عنوان الهدف مطلوب" };

  const approved = canApproveGoal(opts.session.user.role);
  const objective = await prisma.departmentObjective.create({
    data: {
      departmentId: opts.departmentId,
      goalId: opts.goalId ?? null,
      milestoneId: opts.milestoneId ?? null,
      title,
      description: opts.description?.trim() || null,
      acceptanceCriteria: opts.acceptanceCriteria?.trim() || null,
      dueDate: opts.dueDate ?? null,
      priority: opts.priority ?? "normal",
      status: approved ? "approved" : "proposed",
      leadUserId: opts.session.user.role === "department_admin" ? opts.session.user.id : null,
      proposedByName: opts.session.user.name ?? "—",
      approvedAt: approved ? new Date() : null,
      approvedByName: approved ? (opts.session.user.name ?? "—") : null,
    },
    select: { id: true, status: true },
  });
  return { ok: true, id: objective.id, status: objective.status };
}

/** قرارُ التنفيذي في هدفِ قسم */
export async function decideObjective(opts: {
  objectiveId: string;
  decision: "approved" | "rejected";
  note?: string | null;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canApproveGoal(opts.session.user.role)) {
    return { ok: false, reason: "اعتمادُ أهداف الأقسام للمؤسس والمدير التنفيذي" };
  }
  const note = opts.note?.trim() || null;
  if (opts.decision === "rejected" && !note) {
    return { ok: false, reason: "الردُّ لا يقع بلا سببٍ مكتوب" };
  }
  const written = await prisma.departmentObjective.updateMany({
    where: { id: opts.objectiveId, status: "proposed" },
    data: {
      status: opts.decision,
      approvedAt: opts.decision === "approved" ? new Date() : null,
      approvedByName: opts.decision === "approved" ? (opts.session.user.name ?? "—") : null,
      decisionNote: note,
    },
  });
  if (written.count === 0) return { ok: false, reason: "قُضي في هذا الهدف سلفاً" };
  return {
    ok: true,
    message: opts.decision === "approved" ? "اعتُمد هدفُ القسم" : "رُدّ بسببه",
  };
}

/** الأهدافُ المعتمَدة — للوحات والقوائم */
export async function approvedGoals() {
  return prisma.strategicGoal.findMany({
    where: { status: { in: ["approved", "active"] } },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      successCriteria: true,
      startDate: true,
      dueDate: true,
      priority: true,
      status: true,
      accountable: { select: { fullName: true } },
      owner: { select: { fullName: true } },
      milestones: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          expectedResult: true,
          startDate: true,
          dueDate: true,
          status: true,
        },
      },
      _count: { select: { tasks: true, objectives: true } },
    },
  });
}

/** المقترَحاتُ المنتظِرةُ قراراً — طابورُ الإدارة */
export async function pendingProposals() {
  const [goals, objectives] = await Promise.all([
    prisma.strategicGoal.findMany({
      where: { status: "proposed" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        rationale: true,
        dueDate: true,
        proposedByName: true,
        createdAt: true,
      },
    }),
    prisma.departmentObjective.findMany({
      where: { status: "proposed" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        dueDate: true,
        proposedByName: true,
        createdAt: true,
        department: { select: { name: true, colorHex: true } },
        goal: { select: { title: true } },
      },
    }),
  ]);
  return { goals, objectives };
}
