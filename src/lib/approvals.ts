import { prisma } from "@/lib/prisma";
import type { ApprovalKind, ApprovalState } from "@prisma/client";
import { sendApprovalRequestEmail, sendApprovalDecisionEmail } from "@/lib/email";
import { baseUrl } from "@/lib/tickets";

/** الاعتمادات الإدارية على التذاكر.
 *
 *  **الفكرة:** بعض الأعمال لا تبدأ إلا باعتماد المخوَّل. فالتذكرة تحمل
 *  — اختياراً — طلبَ اعتماد: يُسمّي صاحبُها المعتمِد ونوعَ الطلب، فيصل
 *  المعتمِدَ قائمةُ «بانتظار اعتمادي» ويقرّر.
 *
 *  **والاختيارية مقصودة:** `approvalState` فارغٌ في التذكرة العادية —
 *  وهي الأكثر. ولو لزم الاعتماد كلَّ تذكرة لصار على كل سؤالٍ يوميٍّ
 *  بابُ موافقة.
 *
 *  **والحالة تعكس آخر إجراءٍ فعلي.** فتحُ الطلب واستعراضُه لا يُغيّرها:
 *  «قيد المراجعة» إعلانٌ صريح من المعتمِد لا أثرُ نقرة.
 *
 *  **والقرارات صفٌّ لكل قرار** في `ApprovalDecision`، لا عمودٌ يُستبدَل:
 *  الطلب الذي رُدّ ثم أُعيد ثم اعتُمد له ثلاثة قرارات، ولو كُتب كلٌّ فوق
 *  سابقه لم يبقَ من التاريخ إلا آخرُه. وهذا سجلّ التدقيق.
 */

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  marketing_plan: "خطة تسويقية",
  financial_plan: "خطة مالية",
  initiative: "مبادرة أو مشروع",
  resources: "تخصيص موارد أو ميزانية",
  operational: "مقترح تشغيلي",
  other: "طلب آخر",
};

export const APPROVAL_STATE_LABELS: Record<ApprovalState, string> = {
  draft: "مسودة",
  awaiting: "بانتظار الاعتماد",
  reviewing: "قيد المراجعة",
  returned: "مُعاد للتعديل",
  approved: "معتمد",
  rejected: "مرفوض",
  executing: "قيد التنفيذ",
  completed: "مكتمل",
};

/** الحالات التي ما زال الطلب فيها على طاولة المعتمِد */
const OPEN_FOR_APPROVER: ApprovalState[] = ["awaiting", "reviewing"];

const APPROVAL_INCLUDE = {
  raisedByUser: { select: { id: true, fullName: true, jobTitle: true, role: true, department: { select: { name: true } } } },
  member: { select: { id: true, fullName: true, jobTitle: true, department: { select: { name: true } } } },
  approverUser: { select: { id: true, fullName: true, email: true } },
  approvedByUser: { select: { id: true, fullName: true } },
  decisions: { orderBy: { decidedAt: "asc" } },
} as const;

export type ApprovalTicket = Awaited<ReturnType<typeof approvalTicket>>;

export async function approvalTicket(ticketId: string) {
  return prisma.ticket.findUnique({ where: { id: ticketId }, include: APPROVAL_INCLUDE });
}

/** يُعلِّق طلبَ اعتمادٍ على تذكرة.
 *
 *  والمسار المتسلسل اختياريٌّ: `chain` فارغٌ يعني اعتماداً واحداً، ولو
 *  حُمِّل كلُّ طلبٍ سلسلةَ موافقاتٍ كاملة لصار أبسطُ طلبٍ ينتظر ثلاثة.
 */
export async function requestApproval(opts: {
  ticketId: string;
  /** صاحب الطلب — يُقرأ من الجلسة لا من الواجهة */
  requesterUserId: string;
  kind: ApprovalKind;
  /** المعتمِد الأول */
  approverUserId: string;
  /** معتمِدون بعده بالترتيب — فارغٌ يعني اعتماداً واحداً */
  chain?: string[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    select: { id: true, raisedByUserId: true, approvalState: true, subject: true, ticketNumber: true },
  });
  if (!ticket) return { ok: false, reason: "التذكرة غير موجودة" };
  if (ticket.raisedByUserId !== opts.requesterUserId) {
    return { ok: false, reason: "طلب الاعتماد يُعلّقه صاحب التذكرة" };
  }
  if (ticket.approvalState) return { ok: false, reason: "لهذه التذكرة طلبُ اعتمادٍ قائم" };

  // **ولا يعتمد أحدٌ طلبَ نفسه.** ولو أُجيز لصار الاعتماد توقيعاً على
  // الذات: الطلب يُرفع ليراه غيرُ صاحبه.
  if (opts.approverUserId === opts.requesterUserId) {
    return { ok: false, reason: "لا تُرسل طلبك إلى نفسك — الاعتماد من مسؤولٍ آخر" };
  }
  const chain = (opts.chain ?? []).filter((id) => id && id !== opts.requesterUserId);
  if (chain.includes(opts.approverUserId)) {
    return { ok: false, reason: "المعتمِد مكرّر في المسار" };
  }

  const approver = await prisma.user.findUnique({
    where: { id: opts.approverUserId },
    select: { id: true, fullName: true, email: true, isActive: true },
  });
  if (!approver || !approver.isActive) {
    return { ok: false, reason: "المعتمِد غير موجود أو حسابه مُنحّى" };
  }

  const written = await prisma.ticket.updateMany({
    // الحرس في `where`: الطلب لا يُعلَّق مرّتين ولو ضُغط الزرّ مرّتين
    where: { id: opts.ticketId, approvalState: null },
    data: {
      approvalState: "awaiting",
      approvalKind: opts.kind,
      approverUserId: approver.id,
      approvalChain: chain,
      approvalStep: 1,
    },
  });
  if (written.count === 0) return { ok: false, reason: "لهذه التذكرة طلبُ اعتمادٍ قائم" };

  const requester = await prisma.user.findUnique({
    where: { id: opts.requesterUserId },
    select: { fullName: true, jobTitle: true, department: { select: { name: true } } },
  });

  await sendApprovalRequestEmail({
    to: approver.email,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    kindLabel: APPROVAL_KIND_LABELS[opts.kind],
    requesterName: requester?.fullName ?? "—",
    requesterRole: [requester?.jobTitle, requester?.department?.name].filter(Boolean).join(" — ") || "—",
    stepsTotal: 1 + chain.length,
    url: `${baseUrl()}/t/${ticket.ticketNumber}`,
  });

  return { ok: true };
}

/** هل لهذا الشخص أن يقرّر في هذا الطلب الآن؟
 *
 *  **والشرط واحدٌ لا رتبة:** أن يكون هو المعتمِد المنتظَر الآن. فلا
 *  الإدارة العليا تقرّر لأنها الإدارة العليا، ولا من وصل الرابط يقرّر
 *  لأنه وصله. والصفة لا تُدخِل أحداً — الدور في الحدث يُدخِله.
 *
 *  وصاحبُ الطلب لا يقرّر فيه ولو كان هو المعتمِد المسجَّل — وهذا لا
 *  يحدث لأن `requestApproval` يمنعه، والفحص هنا حرسٌ ثانٍ.
 */
export function canDecideApproval(
  ticket: {
    approvalState: ApprovalState | null;
    approverUserId: string | null;
    raisedByUserId: string | null;
  },
  session: { user: { id: string } }
): boolean {
  if (!ticket.approvalState) return false;
  if (!OPEN_FOR_APPROVER.includes(ticket.approvalState)) return false;
  if (ticket.raisedByUserId === session.user.id) return false;
  return ticket.approverUserId === session.user.id;
}

/** القرارات التي يملكها المعتمِد */
export type ApprovalDecisionInput = "reviewing" | "approved" | "returned" | "rejected";

const NOTE_REQUIRED: ApprovalDecisionInput[] = ["returned", "rejected"];

/** يُسجّل قرار المعتمِد، ويُحرّك المسار إن كان متسلسلاً.
 *
 *  **والاعتماد لا يكتمل بأول موافقة في المسار المتسلسل:** يُنقَل الطلب
 *  إلى المعتمِد الذي يليه ويبقى `awaiting`. ولا يُكتب `approvedAt` إلا
 *  حين تكتمل كل الموافقات المطلوبة.
 *
 *  **والحرس في `where` لا قبله:** شرطُ الكتابة يحمل المعتمِد والحالة
 *  معاً، فالنقرة المزدوجة لا تُسجّل قرارين، ومن لم يكن المعتمِد المنتظَر
 *  لا يُطابق صفّاً فلا يكتب شيئاً — ولو نادى الإجراء من طرفه.
 */
export async function decideApproval(opts: {
  ticketId: string;
  actorUserId: string;
  actorName: string;
  decision: ApprovalDecisionInput;
  note?: string;
}): Promise<
  | { ok: true; state: ApprovalState; nextApproverName: string | null }
  | { ok: false; reason: string }
> {
  const note = (opts.note ?? "").trim();
  if (NOTE_REQUIRED.includes(opts.decision) && note.length < 5) {
    return {
      ok: false,
      reason: opts.decision === "rejected" ? "اكتب سبب الرفض" : "اكتب ملاحظاتك للتعديل",
    };
  }

  const before = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    select: {
      id: true, ticketNumber: true, subject: true, approvalState: true,
      approverUserId: true, raisedByUserId: true, approvalChain: true,
      approvalStep: true, approvalKind: true,
    },
  });
  if (!before) return { ok: false, reason: "التذكرة غير موجودة" };
  if (!before.approvalState) return { ok: false, reason: "لا طلب اعتماد على هذه التذكرة" };
  if (before.raisedByUserId === opts.actorUserId) {
    return { ok: false, reason: "لا تعتمد طلبك بنفسك" };
  }
  if (before.approverUserId !== opts.actorUserId) {
    return { ok: false, reason: "الاعتماد لمن أُسنِد إليه الطلب" };
  }

  // «قيد المراجعة» إعلانُ المعتمِد أنه يدرسه — إجراءٌ صريح
  if (opts.decision === "reviewing") {
    const moved = await prisma.ticket.updateMany({
      where: { id: before.id, approverUserId: opts.actorUserId, approvalState: "awaiting" },
      data: { approvalState: "reviewing" },
    });
    if (moved.count === 0) return { ok: false, reason: "حالة الطلب تغيّرت — أعد تحميل الصفحة" };
    await recordDecision(before.id, opts, "reviewing", note || null, before.approvalStep);
    return { ok: true, state: "reviewing", nextApproverName: null };
  }

  if (opts.decision === "returned" || opts.decision === "rejected") {
    const moved = await prisma.ticket.updateMany({
      where: {
        id: before.id,
        approverUserId: opts.actorUserId,
        approvalState: { in: OPEN_FOR_APPROVER },
      },
      data: {
        approvalState: opts.decision,
        ...(opts.decision === "returned" ? { returnCount: { increment: 1 } } : {}),
      },
    });
    if (moved.count === 0) return { ok: false, reason: "حالة الطلب تغيّرت — أعد تحميل الصفحة" };
    await recordDecision(before.id, opts, opts.decision, note, before.approvalStep);
    await notifyRequester(before.id, opts.decision, note, opts.actorName);
    return { ok: true, state: opts.decision, nextApproverName: null };
  }

  // الاعتماد: إن بقي في المسار معتمِدٌ فالطلب يُنقَل إليه ولا يُختَم
  const chain = before.approvalChain;
  const nextIndex = before.approvalStep - 1; // المرحلة ١ تعني أن التالي هو chain[0]
  const nextApproverId = chain[nextIndex] ?? null;

  if (nextApproverId) {
    const next = await prisma.user.findUnique({
      where: { id: nextApproverId },
      select: { id: true, fullName: true, email: true, isActive: true },
    });
    if (!next || !next.isActive) {
      return { ok: false, reason: "المعتمِد التالي في المسار حسابُه مُنحّى — راجع المسار" };
    }
    const moved = await prisma.ticket.updateMany({
      where: {
        id: before.id,
        approverUserId: opts.actorUserId,
        approvalState: { in: OPEN_FOR_APPROVER },
      },
      data: {
        approvalState: "awaiting",
        approverUserId: next.id,
        approvalStep: before.approvalStep + 1,
      },
    });
    if (moved.count === 0) return { ok: false, reason: "حالة الطلب تغيّرت — أعد تحميل الصفحة" };
    await recordDecision(before.id, opts, "approved", note || null, before.approvalStep);

    const requester = await prisma.user.findUnique({
      where: { id: before.raisedByUserId ?? "" },
      select: { fullName: true, jobTitle: true, department: { select: { name: true } } },
    });
    await sendApprovalRequestEmail({
      to: next.email,
      ticketNumber: before.ticketNumber,
      subject: before.subject,
      kindLabel: before.approvalKind ? APPROVAL_KIND_LABELS[before.approvalKind] : "طلب اعتماد",
      requesterName: requester?.fullName ?? "—",
      requesterRole:
        [requester?.jobTitle, requester?.department?.name].filter(Boolean).join(" — ") || "—",
      stepsTotal: 1 + chain.length,
      url: `${baseUrl()}/t/${before.ticketNumber}`,
      afterStepBy: opts.actorName,
    });
    await notifyRequester(before.id, "approved", note, opts.actorName, next.fullName);
    return { ok: true, state: "awaiting", nextApproverName: next.fullName };
  }

  // آخر المسار: الاعتماد النهائي
  const sealed = await prisma.ticket.updateMany({
    where: {
      id: before.id,
      approverUserId: opts.actorUserId,
      approvalState: { in: OPEN_FOR_APPROVER },
    },
    data: {
      approvalState: "approved",
      approvedAt: new Date(),
      approvedByUserId: opts.actorUserId,
    },
  });
  if (sealed.count === 0) return { ok: false, reason: "حالة الطلب تغيّرت — أعد تحميل الصفحة" };
  await recordDecision(before.id, opts, "approved", note || null, before.approvalStep);
  await notifyRequester(before.id, "approved", note, opts.actorName);
  return { ok: true, state: "approved", nextApproverName: null };
}

async function recordDecision(
  ticketId: string,
  opts: { actorUserId: string; actorName: string },
  decision: ApprovalState,
  note: string | null,
  step: number
) {
  await prisma.approvalDecision.create({
    data: {
      ticketId,
      deciderId: opts.actorUserId,
      deciderName: opts.actorName,
      decision,
      note,
      step,
    },
  });
}

async function notifyRequester(
  ticketId: string,
  decision: ApprovalState,
  note: string,
  byName: string,
  nextApproverName?: string
) {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      ticketNumber: true,
      subject: true,
      raisedByUser: { select: { email: true } },
    },
  });
  const to = t?.raisedByUser?.email;
  if (!to || !t) return;
  await sendApprovalDecisionEmail({
    to,
    ticketNumber: t.ticketNumber,
    subject: t.subject,
    stateLabel: APPROVAL_STATE_LABELS[decision],
    note,
    byName,
    nextApproverName,
    url: `${baseUrl()}/t/${t.ticketNumber}`,
  });
}

/** صاحبُ الطلب يُعيد إرساله بعد التعديل.
 *
 *  ويعود إلى المعتمِد نفسه الذي ردّه، وفي مرحلته نفسها — فلا يتخطّى
 *  أحداً بردٍّ ثم إعادة. والإصدارات والقرارات السابقة باقيةٌ في
 *  `decisions`، فيرى المعتمِد ما طلبه وما صار إليه.
 */
export async function resubmitApproval(opts: {
  ticketId: string;
  requesterUserId: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const moved = await prisma.ticket.updateMany({
    where: {
      id: opts.ticketId,
      raisedByUserId: opts.requesterUserId,
      approvalState: "returned",
    },
    data: { approvalState: "awaiting" },
  });
  if (moved.count === 0) {
    return { ok: false, reason: "لا يُعاد إلا طلبٌ رُدّ إليك للتعديل" };
  }

  // **وإعادة الإرسال تُسجَّل في السجل أيضاً.**
  //
  // كانت لا تُسجَّل، فتُقرأ السلسلة بفجوة: «قيد المراجعة ← مُعاد للتعديل
  // ← معتمد» — ولا يُعرَف من السجل أن صاحبه عدّله وأعاده، ولا متى. وقد
  // كُتب في الطلب: «يجب الاحتفاظ بسجل واضح للإصدارات والقرارات
  // السابقة» — والإصدارُ حدثٌ كالقرار.
  //
  // والفاعل هنا صاحبُ الطلب لا معتمِد، فيُنسَب إليه باسمه.
  const requester = await prisma.user.findUnique({
    where: { id: opts.requesterUserId },
    select: { fullName: true },
  });
  await prisma.approvalDecision.create({
    data: {
      ticketId: opts.ticketId,
      deciderId: opts.requesterUserId,
      deciderName: requester?.fullName ?? "—",
      decision: "awaiting",
      note: (opts.note ?? "").trim() || "أعاد صاحبُ الطلب إرساله بعد التعديل",
      step: 0,
    },
  });

  const t = await prisma.ticket.findUniqueOrThrow({
    where: { id: opts.ticketId },
    select: {
      ticketNumber: true, subject: true, approvalKind: true, approvalChain: true,
      approverUser: { select: { email: true, fullName: true } },
      raisedByUser: { select: { fullName: true, jobTitle: true, department: { select: { name: true } } } },
    },
  });
  if (t.approverUser?.email) {
    await sendApprovalRequestEmail({
      to: t.approverUser.email,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      kindLabel: t.approvalKind ? APPROVAL_KIND_LABELS[t.approvalKind] : "طلب اعتماد",
      requesterName: t.raisedByUser?.fullName ?? "—",
      requesterRole:
        [t.raisedByUser?.jobTitle, t.raisedByUser?.department?.name].filter(Boolean).join(" — ") || "—",
      stepsTotal: 1 + t.approvalChain.length,
      url: `${baseUrl()}/t/${t.ticketNumber}`,
      resubmitted: true,
    });
  }
  return { ok: true };
}

/** صاحبُ الطلب المعتمَد ينتقل إلى التنفيذ، ثم يُعلن إكماله.
 *
 *  **ولا يُمنَح التنفيذ قبل الاعتماد:** الشرط في `where` — من لم يُعتمد
 *  طلبُه لا يُطابق صفّاً.
 */
export async function advanceExecution(opts: {
  ticketId: string;
  requesterUserId: string;
  to: "executing" | "completed";
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const from: ApprovalState = opts.to === "executing" ? "approved" : "executing";
  const moved = await prisma.ticket.updateMany({
    where: { id: opts.ticketId, raisedByUserId: opts.requesterUserId, approvalState: from },
    data: { approvalState: opts.to },
  });
  if (moved.count === 0) {
    return {
      ok: false,
      reason:
        opts.to === "executing"
          ? "التنفيذ يبدأ بعد الاعتماد — ولصاحب الطلب"
          : "الإكمال يُعلَن على طلبٍ قيد التنفيذ",
    };
  }
  return { ok: true };
}

/** «بانتظار اعتمادي» — ما يقف على طاولة هذا المعتمِد الآن */
export async function approvalsAwaiting(userId: string) {
  return prisma.ticket.findMany({
    where: { approverUserId: userId, approvalState: { in: OPEN_FOR_APPROVER } },
    include: APPROVAL_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

/** طلباتي — لأتابع حالتها وأُعدّل ما رُدّ إليّ */
export async function myApprovalRequests(userId: string) {
  return prisma.ticket.findMany({
    where: { raisedByUserId: userId, approvalState: { not: null } },
    include: APPROVAL_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

/** من يصحّ أن يُرسَل إليه طلبُ اعتماد: القيادة النشطة، لا صاحب الطلب */
export async function possibleApprovers(requesterUserId: string) {
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ["super_admin", "executive", "operations_officer", "department_admin"] },
      id: { not: requesterUserId },
    },
    select: { id: true, fullName: true, role: true, department: { select: { name: true } } },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });
  return rows;
}
