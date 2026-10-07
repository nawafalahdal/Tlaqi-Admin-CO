import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  TICKET_INCLUDE,
  TICKET_STAGE_LABELS,
  ticketAuthor,
  ticketTargetLabel,
  ticketVisibilityWhere,
} from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** يهرّب الأحرف التي تكسر صيغة iCalendar */
function ics(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function stamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** يُنزّل موعد التذكرة النهائي كحدث تقويم.
 *
 *  ملفّ .ics بدل ربط بتقويم بعينه: يفتح في تقويم آبل وجوجل وأوتلوك على
 *  السواء، ولا يطلب من أحد أن يصل حسابه بالمنصة ولا يمنح المنصة وصولاً
 *  إلى تقويمه. موعد واحد يُضاف، لا مزامنة دائمة.
 *
 *  والصلاحية هي صلاحية رؤية التذكرة نفسها: من لا يراها لا يُنزّل موعدها. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role === "member") {
    return new Response("unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findFirst({
    where: { AND: [{ id }, ticketVisibilityWhere(session)] },
    include: TICKET_INCLUDE,
  });
  if (!ticket) return new Response("not found", { status: 404 });

  const due = ticket.stageDueAt;
  // ساعة واحدة تنتهي عند الموعد النهائي: الحدث تذكيرٌ بالاستحقاق لا بالبدء
  const start = new Date(due.getTime() - 3600_000);

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tlaqi//Tickets//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:ticket-${ticket.id}@tlaqiteam.site`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(due)}`,
    `SUMMARY:${ics(`تذكرة #${ticket.ticketNumber}: ${ticket.subject}`)}`,
    `DESCRIPTION:${ics(
      `${ticket.description}\n\nمن: ${ticketAuthor(ticket).name}\nإلى: ${ticketTargetLabel(ticket)}\nالمرحلة: ${TICKET_STAGE_LABELS[ticket.stage]}\n\n${process.env.APP_BASE_URL ?? ""}/admin/tickets`
    )}`,
    `URL:${process.env.APP_BASE_URL ?? ""}/admin/tickets`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${ics(`يقترب موعد تذكرة #${ticket.ticketNumber}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="tlaqi-ticket-${ticket.ticketNumber}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
