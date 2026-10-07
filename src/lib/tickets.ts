import { prisma } from "@/lib/prisma";
import type { Ticket, Member, Department, User } from "@prisma/client";
import {
  sendTicketCreatedEmail,
  sendTicketConfirmationEmail,
  sendTicketEscalatedEmail,
  sendTicketResolvedEmail,
  sendTicketReminderEmail,
} from "@/lib/email";
import { upsertTicketRow } from "@/lib/googleSheets";
import { ROLE_LABELS } from "@/lib/testTracks";

export const TICKET_STAGE_DAYS = 2;

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function baseUrl() {
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
};

export const TICKET_INCLUDE = {
  member: true,
  raisedByUser: true,
  targetDepartment: true,
  targetUser: true,
  targetMember: true,
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
    const role = ROLE_LABELS[ticket.targetUser.role as keyof typeof ROLE_LABELS] ?? ticket.targetUser.role;
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
  const isLate = resolved ? ticket.stage !== "department" : new Date() > ticket.stageDueAt;
  const author = ticketAuthor(ticket);

  const result = await upsertTicketRow({
    sheetRow: ticket.sheetRow,
    ticketNumber: ticket.ticketNumber,
    fullName: author.name,
    email: author.email,
    targetDepartment: ticketTargetLabel(ticket),
    subject: ticket.subject,
    details: ticket.resolutionNote ?? ticket.description,
    status: TICKET_STATUS_LABELS[ticket.status],
    currentOwner: TICKET_STAGE_LABELS[ticket.stage],
    isLate,
    createdAt: ticket.createdAt,
    closedOrDueAt: ticket.resolvedAt ?? ticket.stageDueAt,
    closedOnTime: resolved ? ticket.stage === "department" : null,
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
      stage: "department",
      stageDueAt,
    },
    include: TICKET_INCLUDE,
  });

  const author = ticketAuthor(created);
  const recipients = await recipientsForStage(created);

  if (recipients.length > 0) {
    await sendTicketCreatedEmail({
      to: recipients,
      subject: opts.subject,
      description: opts.description,
      memberName: author.name,
      dueDate: stageDueAt,
      portalUrl: `${baseUrl()}/admin/tickets`,
    });
  }
  if (author.email) {
    await sendTicketConfirmationEmail({ to: author.email, subject: opts.subject, dueDate: stageDueAt });
  }

  await syncTicketSheetRow(created);
  return created;
}

/** يحدّث حالة التذكرة (قيد المعالجة / تم الحل) مع ملاحظة — يرسل إشعاراً لصاحبها عند الحل */
export async function respondToTicket(opts: {
  ticketId: string;
  status: "in_progress" | "resolved";
  resolutionNote?: string;
}) {
  const ticket = await prisma.ticket.update({
    where: { id: opts.ticketId },
    data: {
      status: opts.status,
      resolutionNote: opts.resolutionNote,
      resolvedAt: opts.status === "resolved" ? new Date() : null,
    },
    include: TICKET_INCLUDE,
  });

  if (opts.status === "resolved") {
    const author = ticketAuthor(ticket);
    if (author.email) {
      await sendTicketResolvedEmail({
        to: author.email,
        subject: ticket.subject,
        resolutionNote: opts.resolutionNote ?? "تم حل التذكرة.",
      });
    }
  }

  await syncTicketSheetRow(ticket);
  return ticket;
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

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { stage: next, stageDueAt: nextDue },
      include: TICKET_INCLUDE,
    });

    const recipients = await recipientsForStage(updated);
    if (recipients.length > 0) {
      await sendTicketEscalatedEmail({
        to: recipients,
        subject: ticket.subject,
        memberName: ticketAuthor(ticket).name,
        description: ticket.description,
        stageLabel: TICKET_STAGE_LABELS[next],
        dueDate: isFinal ? null : nextDue,
        portalUrl: `${baseUrl()}/admin/tickets`,
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
    portalUrl: `${baseUrl()}/admin/tickets`,
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
      portalUrl: `${baseUrl()}/admin/tickets`,
    });
  }

  await syncTicketSheetRow(updated);
  return updated;
}
