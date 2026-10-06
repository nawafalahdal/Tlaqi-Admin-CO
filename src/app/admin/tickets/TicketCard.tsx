"use client";

import { useState, useTransition } from "react";
import { respondToTicketAction } from "../departments/[slug]/actions";
import { Card, Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open: { bg: "#FBE5E1", text: "#9A2E1C" },
  in_progress: { bg: "#FFF1DE", text: "#8A5A00" },
  resolved: { bg: "#E3F3E8", text: "#1F6B3A" },
};

type TicketData = {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  status: string;
  stage: string;
  stageDueAt: string;
  resolutionNote: string | null;
  memberName: string;
  targetDepartmentName: string;
};

export function TicketCard({
  ticket,
  theme,
  readOnly = false,
}: {
  ticket: TicketData;
  theme: ReturnType<typeof themeFromColor>;
  readOnly?: boolean;
}) {
  const [responding, setResponding] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  const statusColor = STATUS_COLORS[ticket.status] ?? STATUS_COLORS.open;
  const statusLabel = (t.ticketStatus as Record<string, string>)[ticket.status];
  const stageLabel = (t.ticketStage.admin as Record<string, string>)[ticket.stage];

  function respond(status: "in_progress" | "resolved") {
    startTransition(async () => {
      await respondToTicketAction(ticket.id, status, note);
      setResponding(false);
    });
  }

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
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: theme.surface, color: theme.accentDark }}>
          {stageLabel}
        </span>
        <span className="text-xs text-black/40">
          {t.ticketCard.deadline}: {formatDate(ticket.stageDueAt)}
        </span>
      </div>
      <p className="text-sm font-bold">{ticket.subject}</p>
      <p className="mt-1 text-sm text-black/60">{ticket.description}</p>
      <p className="mt-2 text-xs text-black/40">
        {t.ticketCard.from}: {ticket.memberName} — {t.ticketCard.to}: {ticket.targetDepartmentName}
      </p>

      {ticket.resolutionNote && (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          {t.ticketCard.reply}: {ticket.resolutionNote}
        </p>
      )}

      {!readOnly && ticket.status !== "resolved" && (
        <div className="mt-3 border-t border-black/5 pt-3">
          {responding ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t.ticketCard.replyPlaceholder}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
              />
              <div className="flex gap-2">
                {ticket.status === "open" && (
                  <Button theme={theme} variant="outline" disabled={pending} onClick={() => respond("in_progress")}>
                    {t.ticketCard.markInProgress}
                  </Button>
                )}
                <Button theme={theme} disabled={pending || !note.trim()} onClick={() => respond("resolved")}>
                  {t.ticketCard.markResolved}
                </Button>
                <Button theme={theme} variant="ghost" onClick={() => setResponding(false)}>
                  {t.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <Button theme={theme} variant="outline" onClick={() => setResponding(true)}>
              {t.ticketCard.respondButton}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
