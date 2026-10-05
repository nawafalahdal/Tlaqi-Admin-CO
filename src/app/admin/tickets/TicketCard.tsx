"use client";

import { useState, useTransition } from "react";
import { respondToTicketAction } from "../departments/[slug]/actions";
import { Card, Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { themeFromColor } from "@/lib/brand";

const STATUS_LABELS: Record<string, string> = {
  open: "جديدة",
  in_progress: "قيد المعالجة",
  resolved: "تم الحل",
};
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open: { bg: "#FBE5E1", text: "#9A2E1C" },
  in_progress: { bg: "#FFF1DE", text: "#8A5A00" },
  resolved: { bg: "#E3F3E8", text: "#1F6B3A" },
};
const STAGE_LABELS: Record<string, string> = {
  department: "القسم المستهدف",
  lead_escalation: "مصعّدة لقائد قسم العضو",
  ceo_escalation: "مصعّدة للإدارة التنفيذية",
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

  const statusColor = STATUS_COLORS[ticket.status] ?? STATUS_COLORS.open;

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
          {STATUS_LABELS[ticket.status]}
        </span>
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: theme.surface, color: theme.accentDark }}>
          {STAGE_LABELS[ticket.stage]}
        </span>
        <span className="text-xs text-black/40">المهلة: {formatDate(ticket.stageDueAt)}</span>
      </div>
      <p className="text-sm font-bold">{ticket.subject}</p>
      <p className="mt-1 text-sm text-black/60">{ticket.description}</p>
      <p className="mt-2 text-xs text-black/40">
        من: {ticket.memberName} — إلى: {ticket.targetDepartmentName}
      </p>

      {ticket.resolutionNote && (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          الرد: {ticket.resolutionNote}
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
                placeholder="اكتب رداً أو سبب الحل..."
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
              />
              <div className="flex gap-2">
                {ticket.status === "open" && (
                  <Button theme={theme} variant="outline" disabled={pending} onClick={() => respond("in_progress")}>
                    قيد المعالجة
                  </Button>
                )}
                <Button theme={theme} disabled={pending || !note.trim()} onClick={() => respond("resolved")}>
                  تم الحل
                </Button>
                <Button theme={theme} variant="ghost" onClick={() => setResponding(false)}>
                  إلغاء
                </Button>
              </div>
            </div>
          ) : (
            <Button theme={theme} variant="outline" onClick={() => setResponding(true)}>
              الرد على التذكرة
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
