import { prisma } from "@/lib/prisma";
import { singleRecipient } from "@/lib/emailPolicy";
import { visibleTicketWhere } from "@/lib/retention";
import type { Ticket, Member, Department, User, TicketStatus } from "@prisma/client";
import {
  sendTicketCreatedEmail,
  sendTicketEscalatedEmail,
  sendTicketResolvedEmail,
  sendTicketWithdrawnEmail,
  sendTicketReminderEmail,
} from "@/lib/email";
import { upsertTicketRow } from "@/lib/googleSheets";
import { ROLE_LABELS, accountRoleLabel } from "@/lib/testTracks";

export const TICKET_STAGE_DAYS = 2;

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function baseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

export const TICKET_STAGE_LABELS: Record<string, string> = {
  department: "القسم المعني",
  lead_escalation: "قائد القسم",
  ceo_escalation: "المدير التنفيذي",
  founder_escalation: "الإدارة العليا",
};

const TICKET_STATUS_LABELS: Record<string, "جديدة" | "قيد المعالجة" | "تم الحل"> = {
  open: "جديدة",
  in_progress: "قيد المعالجة",
  resolved: "تم الحل",
};

/** التذكرة الكاملة بأطرافها — صاحبها (عضو أو حساب إداري) ووجهتها (قسم أو شخص) */
export type FullTicket = Ticket & {
  member: Member | null;
  raisedByUser: User | null;
  targetDepartment: Department | null;
  targetUser: User | null;
  targetMember: Member | null;
  resolvedByUser: User | null;
};

export const TICKET_INCLUDE = {
  member: true,
  raisedByUser: true,
  targetDepartment: true,
  targetUser: true,
  targetMember: true,
  // من أغلقها: يُقرأ هنا ليُكتب في الشيت باسمه لا بمعرّفه
  resolvedByUser: true,
} as const;

/** اسم صاحب التذكرة وبريده، أياً كان نوع حسابه */
export function ticketAuthor(ticket: FullTicket) {
  if (ticket.member) return { name: ticket.member.fullName, email: ticket.member.email };
  if (ticket.raisedByUser)
    return { name: ticket.raisedByUser.fullName, email: ticket.raisedByUser.email };
  return { name: "—", email: "" };
}

/** الجهة التي وُجِّهت إليها التذكرة ابتداءً، كما تُعرض وتُكتب في الشيت */
export function ticketTargetLabel(ticket: FullTicket) {
  if (ticket.targetDepartment) return ticket.targetDepartment.name;
  if (ticket.targetUser) {
    const role = accountRoleLabel(ticket.targetUser.role);
    return `${ticket.targetUser.fullName} — ${role}`;
  }
  if (ticket.targetMember) return `${ticket.targetMember.fullName} — عضو`;
  return "—";
}

async function emailsForDepartmentAdmins(departmentId: string) {
  const admins = await prisma.user.findMany({
    where: { role: "department_admin", departmentId, isActive: true },
  });
  return admins.map((a) => a.email);
}

/** بريد المدير التنفيذي. إن لم يكن هناك تنفيذي نشط تذهب للإدارة العليا بدلاً
 *  من أن تضيع التذكرة في الفراغ — التصعيد لا يجوز أن ينتهي عند لا أحد. */
async function emailsForExecutive() {
  const execs = await prisma.user.findMany({ where: { role: "executive", isActive: true } });
  if (execs.length > 0) return execs.map((e) => e.email);
  return emailsForFounder();
}

async function emailsForFounder() {
  const founders = await prisma.user.findMany({ where: { role: "super_admin", isActive: true } });
  return founders.map((f) => f.email);
}

/** من يملك التذكرة في مرحلتها الحالية */
async function recipientsForStage(ticket: FullTicket): Promise<string[]> {
  switch (ticket.stage) {
    case "department":
      if (ticket.targetUser) return [ticket.targetUser.email];
      if (ticket.targetMember) return [ticket.targetMember.email];
      return ticket.targetDepartmentId ? emailsForDepartmentAdmins(ticket.targetDepartmentId) : [];
    case "lead_escalation": {
      const deptId =
        ticket.targetMember?.departmentId ??
        ticket.member?.departmentId ??
        ticket.raisedByUser?.departmentId ??
        null;
      return deptId ? emailsForDepartmentAdmins(deptId) : emailsForExecutive();
    }
    case "ceo_escalation":
      return emailsForExecutive();
    default:
      return emailsForFounder();
  }
}

/** المرحلة التالية في سلسلة التصعيد.
 *
 *  تذكرة موجَّهة لقسم تمرّ بقائد قسم صاحبها قبل التنفيذي. أما الموجَّهة لشخص
 *  بعينه فتقفز مباشرة للتنفيذي: ليس لها "قسم معنيّ" يُراجَع قبله.
 *  وتنتهي السلسلة دائماً عند الإدارة العليا — لا تذكرة تموت بلا مسؤول. */
function nextStage(ticket: FullTicket): "lead_escalation" | "ceo_escalation" | "founder_escalation" | null {
  if (ticket.stage === "department") {
    // تذكرة موجَّهة لعضو تُصعَّد لقائد قسمه: هو أول من يُسأل عن تأخّره
    const hasLeadAbove = Boolean(
      ticket.targetMember?.departmentId ??
        (ticket.targetDepartmentId
          ? (ticket.member?.departmentId ?? ticket.raisedByUser?.departmentId)
          : null)
    );
    if (hasLeadAbove) return "lead_escalation";
    return "ceo_escalation";
  }
  if (ticket.stage === "lead_escalation") return "ceo_escalation";
  if (ticket.stage === "ceo_escalation") return "founder_escalation";
  return null;
}

/** يكتب/يحدّث الصف الثابت الخاص بالتذكرة في الشيت، ويحفظ رقم الصف على التذكرة
 *  أول مرة فقط — كل استدعاء لاحق يحدّث نفس الصف بدل إضافة صف جديد */
export async function syncTicketSheetRow(ticket: FullTicket) {
  const resolved = ticket.status === "resolved";

  // التأخّر يُقاس بالموعد الأصلي لا بالمرحلة.
  //
  // كان: `resolved ? stage !== "department" : …` — أي «إن صُعِّدت فقد
  // تأخّرت». وهو استنتاجٌ هشّ: أيُّ مسٍّ للمرحلة يُفسد العمود، وهذا
  // بعينه ما وقع في عطب الكنس. فصار القياس صريحاً: أُغلقت بعد موعدها
  // الأصلي أم قبله. ولتذاكرٍ قديمة لا `firstDueAt` لها يبقى الاستنتاج
  // القديم بديلاً — لا يُخترَع تاريخٌ لم يُسجَّل.
  const baseline = ticket.firstDueAt;
  const isLate = resolved
    ? baseline
      ? (ticket.resolvedAt ?? new Date()) > baseline
      : ticket.stage !== "department"
    : new Date() > (baseline ?? ticket.stageDueAt);
  const author = ticketAuthor(ticket);

  const result = await upsertTicketRow({
    sheetRow: ticket.sheetRow,
    ticketNumber: ticket.ticketNumber,
    fullName: author.name,
    email: author.email,
    targetDepartment: ticketTargetLabel(ticket),
    subject: ticket.subject,
    details: ticket.resolutionNote ?? ticket.description,
    status: ticket.withdrawnAt
      ? "أُغلقت بسحب صاحبها"
      : TICKET_STATUS_LABELS[ticket.status],
    currentOwner: TICKET_STAGE_LABELS[ticket.stage],
    isLate: ticket.withdrawnAt ? false : isLate,
    createdAt: ticket.createdAt,
    closedOrDueAt: ticket.resolvedAt ?? ticket.stageDueAt,
    // المسحوبة لا تُقاس بـ«أُجيبت في وقتها»: لم تُجَب أصلاً، فالعمود
    // يبقى فارغاً بدل أن يُسجَّل التزامٌ لم يحدث أو تأخّرٌ لا معنى له
    closedOnTime: ticket.withdrawnAt ? null : resolved ? !isLate : null,
    // من أغلقها — الإغلاق تصرّفٌ يُنسَب لصاحبه في السجل أيضاً
    resolvedByName: ticket.resolvedByUser?.fullName ?? null,
  });

  if (!ticket.sheetRow && result.sheetRow) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { sheetRow: result.sheetRow } });
  }
}

/** يرفع تذكرة جديدة.
 *
 *  صاحبها إما عضو أو حساب إداري، ووجهتها إما قسم كامل أو شخص بعينه. هذا هو
 *  ما يجعل التذاكر قناة العمل الفعلية: كاتب المحتوى يرفعها للمصمّم باسمه،
 *  والمصمّم يردّها لمسؤول النشر، وكلٌّ منها له مهلة ومسار تصعيد مكتوب. */
export async function raiseTicket(opts: {
  memberId?: string;
  raisedByUserId?: string;
  targetDepartmentId?: string;
  targetUserId?: string;
  targetMemberId?: string;
  subject: string;
  description: string;
  /** رابط مرفق اختياري — منشور أو ملف أو اجتماع يخصّ التذكرة */
  linkUrl?: string | null;
}) {
  if (!opts.memberId && !opts.raisedByUserId) throw new Error("التذكرة تحتاج صاحباً");
  const targets = [opts.targetDepartmentId, opts.targetUserId, opts.targetMemberId].filter(Boolean);
  if (targets.length === 0) throw new Error("التذكرة تحتاج وجهة");
  if (targets.length > 1) throw new Error("اختر وجهة واحدة: قسماً أو شخصاً");

  const stageDueAt = addDays(new Date(), TICKET_STAGE_DAYS);
  const created = await prisma.ticket.create({
    data: {
      subject: opts.subject,
      description: opts.description,
      memberId: opts.memberId ?? null,
      raisedByUserId: opts.raisedByUserId ?? null,
      targetDepartmentId: opts.targetDepartmentId ?? null,
      targetUserId: opts.targetUserId ?? null,
      targetMemberId: opts.targetMemberId ?? null,
      linkUrl: opts.linkUrl || null,
      stage: "department",
      stageDueAt,
      // الموعد الأصلي يُحفظ هنا ولا يُمَسّ بعدها
      firstDueAt: stageDueAt,
    },
    include: TICKET_INCLUDE,
  });

  const author = ticketAuthor(created);
  // مستلمٌ واحد لا نسخةَ مجاملة: التذكرة عملٌ على شخص، وحين تتعدّد
  // الجهات (ثلاثة تنفيذيين، أو أكثر من قائد) تُرسَل إلى واحدٍ ثابتٍ
  // والبقية يرونها في لوحتهم
  const recipients = singleRecipient(await recipientsForStage(created));

  if (recipients.length > 0) {
    await sendTicketCreatedEmail({
      to: recipients,
      subject: opts.subject,
      description: opts.description,
      memberName: author.name,
      dueDate: stageDueAt,
      portalUrl: `${baseUrl()}/t/${created.ticketNumber}`,
      linkUrl: created.linkUrl,
    });
  }
  // لا تأكيد لصاحب التذكرة: رآه على الشاشة لحظة رفعها، وتكراره بريداً
  // يستهلك حصّة الإرسال في إخبار أحدٍ بما يعلمه

  await syncTicketSheetRow(created);
  return created;
}

/** يحدّث حالة التذكرة (قيد المعالجة / تم الحل) مع ملاحظة.
 *
 *  **القاعدة التي تُحكَم بالقاعدة لا بالتطبيق:** الإغلاق يُكتب بـ
 *  `updateMany` مشروطاً بأن التذكرة ليست مُغلقة أصلاً. فالضغطتان
 *  المتسارعتان على «تم الحل» — أو نقرتان على زرٍّ بطيء — تمرّان على
 *  الشرط مرّةً واحدة: الثانية تُصيب صفراً من الصفوف فلا تُرسل رسالةً
 *  ثانية ولا تَكتب `resolvedAt` جديداً فوق القديم. ولو كان الحرس في
 *  التطبيق («اقرأ ثم تحقّق ثم اكتب») لمرّت الاثنتان معاً.
 *
 *  **وإعادة الفتح لا تقع ضمناً:** كانت `status: "in_progress"` على
 *  تذكرةٍ مُغلقة تُعيد فتحها وتمسح `resolvedAt` بلا إذنٍ ولا أثر. فصارت
 *  تُرفض إلا بـ`reopen: true` صريحة، وتُسجَّل بعدّادها وتاريخها. */
export async function respondToTicket(opts: {
  ticketId: string;
  status: "in_progress" | "resolved";
  resolutionNote?: string;
  /** من يُجري التصرّف — يُنسَب إليه الإغلاق في السجل */
  actorUserId?: string | null;
  /** إعادة فتح تذكرةٍ مُغلقة: تصرّفٌ صريح لا أثرٌ جانبي */
  reopen?: boolean;
}): Promise<
  | { ok: true; ticket: FullTicket; changed: boolean }
  | { ok: false; reason: string }
> {
  const before = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    include: TICKET_INCLUDE,
  });
  if (!before) return { ok: false, reason: "التذكرة غير موجودة" };

  const alreadyResolved = before.status === "resolved";

  if (opts.status === "resolved") {
    // الشرط في `where`: الصفّ المُغلق لا يُطابَق، فلا يُكتب ولا يُراسَل
    const at = new Date();
    const written = await prisma.ticket.updateMany({
      where: { id: opts.ticketId, status: { not: "resolved" } },
      data: {
        status: "resolved",
        resolutionNote: opts.resolutionNote,
        resolvedAt: at,
        resolvedByUserId: opts.actorUserId ?? null,
      },
    });

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: opts.ticketId },
      include: TICKET_INCLUDE,
    });

    if (written.count === 0) {
      // كانت مُغلقة: نُطابق الشيت على الحالة الحقيقية ولا نُرسل شيئاً
      await syncTicketSheetRow(ticket);
      return { ok: true, ticket, changed: false };
    }

    // إشعار الحل يذهب لصاحبها — ومن رفعها هو من يُخبَر بحلّها، فاوندراً
    // كان أو عضواً. وهذا ليس «بريداً تشغيلياً للفاوندر»: هو صاحب الطلب.
    const author = ticketAuthor(ticket);
    if (author.email) {
      await sendTicketResolvedEmail({
        to: author.email,
        subject: ticket.subject,
        resolutionNote: opts.resolutionNote ?? "تم حل التذكرة.",
      });
    }

    await recordTicketOutcome(ticket);
    await syncTicketSheetRow(ticket);
    return { ok: true, ticket, changed: true };
  }

  // «قيد المعالجة» على تذكرةٍ مُغلقة = إعادة فتح، ولا تمرّ ضمناً
  if (alreadyResolved && !opts.reopen) {
    return { ok: false, reason: "التذكرة مُغلقة — إعادة الفتح تحتاج إجراءً صريحاً" };
  }

  const ticket = await prisma.ticket.update({
    where: { id: opts.ticketId },
    data: {
      status: "in_progress",
      resolutionNote: opts.resolutionNote,
      ...(alreadyResolved
        ? {
            // تُمحى ختوم الإغلاق لأنها لم تعد صحيحة، ويُسجَّل أن فتحاً وقع
            resolvedAt: null,
            resolvedByUserId: null,
            reopenCount: { increment: 1 },
            reopenedAt: new Date(),
            // وتعود مهلتها من اليوم: مهلةٌ انقضت وهي مُغلقة ليست تأخّراً
            stageDueAt: addDays(new Date(), TICKET_STAGE_DAYS),
          }
        : {}),
    },
    include: TICKET_INCLUDE,
  });

  await syncTicketSheetRow(ticket);
  return { ok: true, ticket, changed: true };
}

/** يسحب صاحبُ التذكرة تذكرتَه — إغلاقٌ ليس إجابة.
 *
 *  **العطب الذي أوجب هذا:** القاعدة «لا يردّ أحد على تذكرة رفعها بنفسه»
 *  صحيحة — إغلاقُ صاحبِها إقرارٌ بأن الطرف الآخر أجاب. لكن التذكرة التي
 *  يرفعها الفاوندر وتُصعَّد حتى `founder_escalation` لا يملك الردّ عليها
 *  في تلك المرحلة إلا الفاوندر، وهو صاحبها. فكان المصرَّح له الوحيد
 *  ممنوعاً، والتذكرة تقف إلى الأبد لا تُغلق ولا تُحَلّ.
 *
 *  والحلّ ليس كسر القاعدة — بل الاعتراف بتصرّفٍ آخر: أن يسحب صاحبُ الطلب
 *  طلبَه. فلا يُقال في السجل إن أحداً أجاب وقد لم يُجب: العمود يقول
 *  «أُغلقت بسحب صاحبها»، و«أُجيبت في وقتها» يبقى فارغاً.
 *
 *  والحرس في `where` لا قبله: السحب المكرّر لا يُغلق مرّتين ولا يُراسِل
 *  مرّتين، وسحبُ تذكرةِ غيرك لا يُطابق صفّاً فلا يكتب شيئاً. */
export async function withdrawTicket(opts: {
  ticketId: string;
  /** صاحبها — ويُتحقَّق منه في `where` لا بقراءةٍ سابقة */
  actorUserId: string;
  reason: string;
}): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  const reason = opts.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "اكتب سبب السحب" };

  const at = new Date();
  const written = await prisma.ticket.updateMany({
    where: {
      id: opts.ticketId,
      raisedByUserId: opts.actorUserId,
      status: { not: "resolved" },
    },
    data: {
      status: "resolved",
      resolutionNote: `سحبها صاحبها: ${reason}`,
      resolvedAt: at,
      withdrawnAt: at,
      resolvedByUserId: opts.actorUserId,
    },
  });

  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.ticketId },
    include: TICKET_INCLUDE,
  });
  if (!ticket) return { ok: false, reason: "التذكرة غير موجودة" };

  if (written.count === 0) {
    // إمّا ليست تذكرته، أو كانت مُغلقة. نُطابق الشيت على الحقيقة ولا نُراسل.
    await syncTicketSheetRow(ticket);
    if (ticket.raisedByUserId !== opts.actorUserId) {
      return { ok: false, reason: "لا تُسحب إلا تذكرةٌ رفعتَها أنت" };
    }
    return { ok: true, changed: false };
  }

  // من كان الطلب في يده يُخبَر ليتوقّف — لا إخباراً بما يعلمه، بل رفعاً
  // لعملٍ صار بلا داعٍ. وصاحبها هو الفاعل فلا يُراسَل بفعل نفسه.
  const owners = await recipientsForStage(ticket);
  const author = ticketAuthor(ticket);
  const notify = owners.filter((e) => e && e !== author.email);
  if (notify.length > 0) {
    await sendTicketWithdrawnEmail({
      to: notify,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      reason,
      byName: author.name,
    });
  }

  await recordTicketOutcome(ticket);
  await syncTicketSheetRow(ticket);
  return { ok: true, changed: true };
}

/** يُشغَّل عند كل تحميل للوحات — يصعّد أي تذكرة تجاوزت مهلتها دون حل:
 *  الجهة المعنية (يومان) ← قائد القسم (يومان) ← المدير التنفيذي (يومان)
 *  ← الإدارة العليا (نهائي). الفاوندر آخر السلسلة لا أولها. */
export async function sweepTicketEscalation() {
  const overdue = await prisma.ticket.findMany({
    where: {
      status: { in: ["open", "in_progress"] },
      stage: { in: ["department", "lead_escalation", "ceo_escalation"] },
      stageDueAt: { lt: new Date() },
    },
    include: TICKET_INCLUDE,
  });

  for (const ticket of overdue) {
    const next = nextStage(ticket);
    if (!next) continue;

    // المرحلة الأخيرة بلا مهلة جديدة: ليس بعدها من يُصعَّد إليه
    const isFinal = next === "founder_escalation";
    const nextDue = isFinal ? ticket.stageDueAt : addDays(new Date(), TICKET_STAGE_DAYS);

    // **هذا الشرط هو إصلاح العطب الذي أبلغت عنه.** كان التصعيد
    // `update` بالمعرّف وحده. وبين `findMany` أعلى الدالة وهذه السطور
    // تمرّ انتظاراتٌ طويلة — جمعُ المستلمين، ثم إرسال بريدٍ قد يأخذ
    // ثوانٍ لكل تذكرة. فمن أغلق المدير التنفيذي أو الفاوندر تذكرتَه
    // في تلك الثواني، كان الكنس يُصعّدها بعد إغلاقها: يُقدّم `stage`
    // ويُجدّد `stageDueAt`.
    //
    // والضرر ليس في المرحلة وحدها: `syncTicketSheetRow` يحسب
    // `isLate = resolved ? stage !== "department" : ...`. فتذكرةٌ
    // أُغلقت في موعدها عند القسم تُقرأ في الإكسل **متأخّرة** و
    // «أُغلقت في الوقت = لا» بعد أن يُقدّم الكنس مرحلتها. وهذا هو
    // عَرَضُ «تذكرة أغلقها الفاوندر تظهر متأخّرة أو غير محلولة».
    //
    // فصار الشرط في `where` لا في الذاكرة: لا تُصعَّد إلا إن كانت
    // **ما تزال** مفتوحة وما تزال في مرحلتها وما تزال متأخّرة. وإن
    // تبدّل شيء من ذلك أصابت صفراً وتُركت وشأنها.
    const advanced = await prisma.ticket.updateMany({
      where: {
        id: ticket.id,
        status: { in: ["open", "in_progress"] },
        stage: ticket.stage,
        stageDueAt: { lt: new Date() },
      },
      data: { stage: next, stageDueAt: nextDue },
    });
    if (advanced.count === 0) continue;

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: TICKET_INCLUDE,
    });
    // حارسٌ ثانٍ قبل البريد: الإغلاق قد يقع بين الكتابة والإرسال أيضاً،
    // ورسالة «تأخّرت تذكرتك» عن تذكرةٍ مُغلقة لا يُصلحها شيء بعد وصولها
    if (updated.status === "resolved") {
      await syncTicketSheetRow(updated);
      continue;
    }

    const recipients = await recipientsForStage(updated);
    if (recipients.length > 0) {
      await sendTicketEscalatedEmail({
        to: recipients,
        subject: ticket.subject,
        memberName: ticketAuthor(ticket).name,
        description: ticket.description,
        stageLabel: TICKET_STAGE_LABELS[next],
        dueDate: isFinal ? null : nextDue,
        portalUrl: `${baseUrl()}/t/${ticket.ticketNumber}`,
      });
    }

    await syncTicketSheetRow(updated);
  }
}

/** تذكير يدوي للجهة المسؤولة حالياً عن تذكرة لم تُحل بعد */
export async function remindTicket(ticketId: string, fromName: string) {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: TICKET_INCLUDE,
  });
  if (ticket.status === "resolved") return;

  const recipients = await recipientsForStage(ticket);
  if (recipients.length === 0) return;

  await sendTicketReminderEmail({
    to: recipients,
    subject: ticket.subject,
    memberName: ticketAuthor(ticket).name,
    stageLabel: TICKET_STAGE_LABELS[ticket.stage],
    dueDate: ticket.stageDueAt,
    fromName,
    portalUrl: `${baseUrl()}/t/${ticket.ticketNumber}`,
  });
}

/** تصعيد يدوي فوري — لمن لا يريد انتظار المهلة.
 *  متاح لصاحب التذكرة ولمن يملكها الآن، ولا يتجاوز نهاية السلسلة. */
export async function escalateTicketNow(ticketId: string, byName: string) {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: TICKET_INCLUDE,
  });
  if (ticket.status === "resolved") return ticket;

  const next = nextStage(ticket);
  if (!next) return ticket;

  const isFinal = next === "founder_escalation";
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      stage: next,
      stageDueAt: isFinal ? ticket.stageDueAt : addDays(new Date(), TICKET_STAGE_DAYS),
    },
    include: TICKET_INCLUDE,
  });

  const recipients = await recipientsForStage(updated);
  if (recipients.length > 0) {
    await sendTicketEscalatedEmail({
      to: recipients,
      subject: ticket.subject,
      memberName: `${ticketAuthor(ticket).name} (صعّدها: ${byName})`,
      description: ticket.description,
      stageLabel: TICKET_STAGE_LABELS[next],
      dueDate: isFinal ? null : updated.stageDueAt,
      portalUrl: `${baseUrl()}/t/${ticket.ticketNumber}`,
    });
  }

  await syncTicketSheetRow(updated);
  return updated;
}

/** ما يحقّ لكل دور أن يراه من التذاكر.
 *
 *  الفاوندر استثناء مقصود: لا تصله تذاكر الأقسام وهي تعمل. التصعيد نظامٌ
 *  لا يعمل إن كان أعلى الهرم يقرأ كل شيء من أوله — يصير مرجعاً أولَ بدل
 *  أن يكون ملاذاً أخيراً، ويُفرَّغ دور التنفيذي من معناه. فلا يرى إلا ما
 *  بلغ مرحلته الأخيرة بعد أن وقف عند الجميع، وما هو طرف فيه بنفسه.
 *
 *  التنفيذي ومسؤول التشغيل يريان كل شيء: إدارة العمل اليومي وظيفتهما.
 *  وقائد القسم يرى ما يخصّ قسمه أو ما وُجّه إليه. */
/** يَعُدّ نتيجةَ التذكرة لحظةَ إغلاقها — ليبقى الرقم بعد أرشفتها.
 *
 *  **ولماذا عند الإغلاق لا عند التقرير؟** التذكرة المغلقة تُحال إلى
 *  الإكسل كلَّ سبت، فلو حُسب التقرير من صفوفها لما بقي منه شيء. فتُعَدّ
 *  هنا مرّةً واحدة في صفٍّ لكل نطاق — ويبقى العدّ وإن زال الصفّ.
 *
 *  والعدّ ذرّيٌّ (`increment`) لا قراءةٌ ثم كتابة: إغلاقان متزامنان
 *  يزيدان اثنين لا واحداً.
 */
async function recordTicketOutcome(ticket: {
  targetDepartmentId: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  firstDueAt: Date | null;
  stageDueAt: Date;
  withdrawnAt: Date | null;
  stage: string;
}) {
  const field = ticket.withdrawnAt
    ? ("withdrawn" as const)
    : (() => {
        const baseline = ticket.firstDueAt ?? ticket.stageDueAt;
        const at = ticket.resolvedAt ?? new Date();
        return at > baseline ? ("late" as const) : ("onTime" as const);
      })();

  const scopes: string[] = [];
  if (ticket.targetDepartmentId) scopes.push(`dept:${ticket.targetDepartmentId}`);
  if (ticket.resolvedByUserId) scopes.push(`user:${ticket.resolvedByUserId}`);

  for (const scope of scopes) {
    try {
      await prisma.ticketTally.upsert({
        where: { scope },
        create: { scope, [field]: 1 },
        update: { [field]: { increment: 1 } },
      });
    } catch (err) {
      // العدّاد إحصاءٌ لا حوكمة: إخفاقُه لا يُفشل إغلاق التذكرة
      console.error("تعذّر عدّ نتيجة التذكرة:", err);
    }
  }
}


export function ticketVisibilityWhere(session: {
  user: { id: string; role: string; departmentId?: string | null };
}) {
  // الرؤية والأرشفة يُضَمّان هنا لا في كل شاشة: من يرى تذكرةً لا يرى
  // المؤرشَف منها، ولو تُرك الشرط لكل صفحةٍ لنسيته واحدةٌ فظهر فيها ما
  // اختفى من غيرها — وذاك أسوأ من ألّا يختفي شيء.
  return { AND: [visibleTicketWhere(), ticketScopeWhere(session)] };
}

/** نطاقُ الرؤية وحدَه بلا قاعدة الأرشفة.
 *
 *  يُستعمل حين نحتاج أن نعرف: هل كانت هذه التذكرة تخصّه قبل أن تُؤرشَف؟
 *  فيُقال له «أُرشفت» بدل «لا تخصّك» — والأولى صادقة والثانية كذبٌ
 *  يُربكه. ولا يُكشَف بهذا شيءٌ لمن يُجرّب الأرقام: الشرط نطاقُه هو. */
export function ticketScopeWhere(session: {
  user: { id: string; role: string; departmentId?: string | null };
}) {
  const { id, role, departmentId } = session.user;

  if (role === "super_admin") {
    return {
      OR: [
        { stage: "founder_escalation" as const },
        { raisedByUserId: id },
        { targetUserId: id },
      ],
    };
  }

  if (role === "department_admin") {
    const dept = departmentId ?? "__none__";
    return {
      OR: [
        { targetDepartmentId: dept },
        { targetUserId: id },
        { raisedByUserId: id },
        { member: { departmentId: dept } },
        { targetMember: { departmentId: dept } },
        { raisedByUser: { departmentId: dept } },
      ],
    };
  }

  if (role === "member") {
    // العضو يرى تذاكره، وما وُجِّه إليه باسمه، **وما وُجِّه إلى قسمه**.
    // كان الأخير ناقصاً: مسار العمل اليومي (محتوى ← تصميم ← نشر) يُوجَّه
    // إلى القسم لا إلى شخصٍ بعينه، فكانت تذاكر القسم لا تصل أحداً من
    // أعضائه — تُرفع فلا يراها إلا قائده.
    return {
      OR: [
        { memberId: id },
        { targetMemberId: id },
        ...(departmentId ? [{ targetDepartmentId: departmentId }] : []),
      ],
    };
  }

  // التنفيذي ومسؤول التشغيل: لا قيد
  return {};
}

/** التذاكر المفتوحة التي يراها صاحب الجلسة — استعلامٌ واحد لكل الشاشات.
 *
 *  كانت كل لوحة تكتب استعلامها بيدها، فاختلفت: لوحة القسم تنسى التذاكر
 *  الموجَّهة إلى قائدها باسمه وما رفعه هو، ولوحة المؤسس لا تُصفّي
 *  المُغلَقة فتزحمها القديمة حتى تختفي المفتوحة تحت سقف العدد. وكلّما
 *  صُحّحت قاعدة الرؤية في موضع بقي الموضعان الآخران على خطئهما.
 *
 *  فصار الاستعلام واحداً: من يرى ماذا يُحسم في `ticketVisibilityWhere`،
 *  و«المفتوح» يُصفّى في القاعدة لا في الذاكرة. */
export function openTicketsWhere(session: {
  user: { id: string; role: string; departmentId?: string | null };
}) {
  return {
    AND: [{ status: { in: ["open", "in_progress"] as TicketStatus[] } }, ticketVisibilityWhere(session)],
  };
}

/** من يملك الردّ على التذكرة وإغلاقها.
 *
 *  **القاعدة الحاكمة: من رفع التذكرة لا يُغلقها.** التذكرة سؤالٌ موجَّه
 *  إلى طرف، وإغلاقها إقرارٌ بأن الطرف أجاب. فإن أغلقها صاحبها صار
 *  السائل والمجيب واحداً، وفقدت التذكرة معناها كأداة مساءلة — وهذا ما
 *  كان يحدث: المؤسس يرفع تذكرة للمدير التنفيذي ثم يردّ عليها ويقفلها
 *  بنفسه، فلا يبقى في السجل أثرٌ لأن التنفيذي لم يُجب.
 *
 *  ومن يملكها هو صاحب المرحلة الحالية وحدها — نفس من يصله إشعارها في
 *  `recipientsForStage`. فلا الرتبة وحدها تكفي: المؤسس لا يُغلق تذكرة
 *  داخل قسم لم تصعّد إليه، والتنفيذي لا يُغلق ما لم يصل إليه بعد. */
export function canRespondToTicket(
  ticket: {
    raisedByUserId: string | null;
    targetUserId: string | null;
    targetDepartmentId: string | null;
    stage: string;
    targetMember?: { departmentId: string | null } | null;
    member?: { departmentId: string | null } | null;
    raisedByUser?: { departmentId: string | null } | null;
  },
  session: { user: { id: string; role: string; departmentId?: string | null } }
): boolean {
  const { id, role, departmentId } = session.user;

  // صاحب التذكرة لا يردّ على نفسه مهما علت رتبته
  if (ticket.raisedByUserId === id) return false;

  switch (ticket.stage) {
    case "department":
      // الموجَّهة لشخص بعينه: هو وحده. والموجَّهة لقسم: قادته.
      if (ticket.targetUserId) return ticket.targetUserId === id;
      if (ticket.targetDepartmentId) {
        return role === "department_admin" && departmentId === ticket.targetDepartmentId;
      }
      return false;
    case "lead_escalation": {
      const deptId =
        ticket.targetMember?.departmentId ??
        ticket.member?.departmentId ??
        ticket.raisedByUser?.departmentId ??
        null;
      // بلا قسم فوقها، تؤول للتنفيذي كما في سلسلة التصعيد نفسها
      if (!deptId) return role === "executive";
      return role === "department_admin" && departmentId === deptId;
    }
    case "ceo_escalation":
      return role === "executive";
    default:
      return role === "super_admin";
  }
}
