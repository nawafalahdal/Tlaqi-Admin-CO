"use client";

import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open: { bg: "#FBE5E1", text: "#9A2E1C" },
  in_progress: { bg: "#FFF1DE", text: "#8A5A00" },
  resolved: { bg: "#E3F3E8", text: "#1F6B3A" },
};

export function MyTicketCard({
  ticket,
}: {
  ticket: {
    id: string;
    ticketNumber: number;
    subject: string;
    description: string;
    status: string;
    stage: string;
    stageDueAt: string;
    resolutionNote: string | null;
  };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const t = useTranslations();
  const statusColor = STATUS_COLORS[ticket.status] ?? STATUS_COLORS.open;
  const statusLabel = (t.ticketStatus as Record<string, string>)[ticket.status];
  const stageLabel = (t.ticketStage.member as Record<string, string>)[ticket.stage];

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono text-black/40" dir="ltr">
          #{ticket.ticketNumber}
        </span>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: statusColor.bg, color: statusColor.text }}
        >
          {statusLabel}
        </span>
        {ticket.status !== "resolved" && (
          <span className="text-xs text-black/40">
            {t.member.currentHandler}: {stageLabel}
          </span>
        )}
      </div>
      <p className="text-sm font-bold">{ticket.subject}</p>
      <p className="mt-1 text-sm text-black/60">{ticket.description}</p>
      {ticket.resolutionNote ? (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          {t.member.replyLabel}: {ticket.resolutionNote}
        </p>
      ) : (
        <p className="mt-2 text-xs text-black/40">
          {t.member.currentDeadline}: {formatDate(ticket.stageDueAt)}
        </p>
      )}
    </Card>
  );
}
