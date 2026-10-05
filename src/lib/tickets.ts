import { prisma } from "@/lib/prisma";
import {
  sendTicketCreatedEmail,
  sendTicketConfirmationEmail,
  sendTicketEscalatedEmail,
  sendTicketResolvedEmail,
} from "@/lib/email";
import { appendTicketEvent } from "@/lib/googleSheets";

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
  lead_escalation: "قائد قسمك",
  ceo_escalation: "الإدارة التنفيذية",
};

async function emailsForDepartmentAdmins(departmentId: string) {
  const admins = await prisma.user.findMany({ where: { role: "department_admin", departmentId } });
  return admins.map((a) => a.email);
}

async function emailsForLeadership() {
  const leaders = await prisma.user.findMany({
    where: { role: { in: ["executive", "super_admin"] } },
  });
  return leaders.map((l) => l.email);
}

/** يرفع عضو تذكرة جديدة — تبدأ دائماً عند القسم المستهدف بمهلة يومين */
export async function raiseTicket(opts: {
  memberId: string;
  targetDepartmentId: string;
  subject: string;
  description: string;
}) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: opts.memberId } });
  const targetDepartment = await prisma.department.findUniqueOrThrow({ where: { id: opts.targetDepartmentId } });
  const stageDueAt = addDays(new Date(), TICKET_STAGE_DAYS);

  const ticket = await prisma.ticket.create({
    data: {
      subject: opts.subject,
      description: opts.description,
      memberId: opts.memberId,
      targetDepartmentId: opts.targetDepartmentId,
      stage: "department",
      stageDueAt,
    },
  });

  const targetAdmins = await emailsForDepartmentAdmins(opts.targetDepartmentId);
  await sendTicketCreatedEmail({
    to: targetAdmins,
    subject: opts.subject,
    description: opts.description,
    memberName: member.fullName,
    dueDate: stageDueAt,
    portalUrl: `${baseUrl()}/admin`,
  });
  await sendTicketConfirmationEmail({ to: member.email, subject: opts.subject, dueDate: stageDueAt });

  await appendTicketEvent({
    fullName: member.fullName,
    email: member.email,
    targetDepartment: targetDepartment.name,
    subject: opts.subject,
    details: opts.description,
    event: "رفع تذكرة",
    stage: TICKET_STAGE_LABELS.department,
    at: new Date(),
  });

  return ticket;
}

/** يحدّث حالة التذكرة (قيد المعالجة / تم الحل) مع ملاحظة — يرسل إشعاراً للعضو عند الحل */
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
    },
    include: { member: true, targetDepartment: true },
  });

  if (opts.status === "resolved") {
    await sendTicketResolvedEmail({
      to: ticket.member.email,
      subject: ticket.subject,
      resolutionNote: opts.resolutionNote ?? "تم حل التذكرة.",
    });
  }

  await appendTicketEvent({
    fullName: ticket.member.fullName,
    email: ticket.member.email,
    targetDepartment: ticket.targetDepartment.name,
    subject: ticket.subject,
    details: opts.resolutionNote ?? "",
    event: opts.status === "resolved" ? "تم الحل" : "قيد المعالجة",
    stage: TICKET_STAGE_LABELS[ticket.stage],
    at: new Date(),
  });

  return ticket;
}

/** يُشغَّل عند كل تحميل للوحات — يصعّد أي تذكرة تجاوزت مهلتها دون حل:
 *  القسم (يومان) ← قائد قسم العضو (يومان) ← الإدارة التنفيذية (نهائي) */
export async function sweepTicketEscalation() {
  const overdue = await prisma.ticket.findMany({
    where: {
      status: { in: ["open", "in_progress"] },
      stage: { in: ["department", "lead_escalation"] },
      stageDueAt: { lt: new Date() },
    },
    include: { member: true, targetDepartment: true },
  });

  for (const ticket of overdue) {
    if (ticket.stage === "department") {
      const nextDue = addDays(new Date(), TICKET_STAGE_DAYS);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { stage: "lead_escalation", stageDueAt: nextDue },
      });

      if (ticket.member.departmentId) {
        const leadEmails = await emailsForDepartmentAdmins(ticket.member.departmentId);
        await sendTicketEscalatedEmail({
          to: leadEmails,
          subject: ticket.subject,
          memberName: ticket.member.fullName,
          description: ticket.description,
          stageLabel: TICKET_STAGE_LABELS.lead_escalation,
          dueDate: nextDue,
          portalUrl: `${baseUrl()}/admin`,
        });
      }

      await appendTicketEvent({
        fullName: ticket.member.fullName,
        email: ticket.member.email,
        targetDepartment: ticket.targetDepartment.name,
        subject: ticket.subject,
        details: ticket.description,
        event: "تصعيد",
        stage: TICKET_STAGE_LABELS.lead_escalation,
        at: new Date(),
      });
    } else if (ticket.stage === "lead_escalation") {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { stage: "ceo_escalation" },
      });

      const leadershipEmails = await emailsForLeadership();
      await sendTicketEscalatedEmail({
        to: leadershipEmails,
        subject: ticket.subject,
        memberName: ticket.member.fullName,
        description: ticket.description,
        stageLabel: TICKET_STAGE_LABELS.ceo_escalation,
        dueDate: null,
        portalUrl: `${baseUrl()}/admin`,
      });

      await appendTicketEvent({
        fullName: ticket.member.fullName,
        email: ticket.member.email,
        targetDepartment: ticket.targetDepartment.name,
        subject: ticket.subject,
        details: ticket.description,
        event: "تصعيد نهائي",
        stage: TICKET_STAGE_LABELS.ceo_escalation,
        at: new Date(),
      });
    }
  }
}
