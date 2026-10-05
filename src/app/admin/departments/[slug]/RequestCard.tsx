"use client";

import { useTransition } from "react";
import { updateRequestStatusAction } from "../../actions";
import { Card, StatusBadge } from "@/components/ui";
import { themeFromColor } from "@/lib/brand";
import { readableTextOn } from "@/lib/colors";
import { formatDate } from "@/lib/format";

const TYPE_LABELS: Record<string, string> = {
  welcome_banner: "بانر ترحيبي",
  custom_design: "تصميم مخصص",
  dept_contact: "تواصل قسم",
  meeting: "اجتماع شرح",
};

export function RequestCard({
  request,
  theme,
}: {
  request: {
    id: string;
    type: string;
    status: string;
    note: string | null;
    dueDate: string | null;
    linkedMemberName: string | null;
  };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [pending, startTransition] = useTransition();

  const nextStatus =
    request.status === "new" ? "in_progress" : request.status === "in_progress" ? "done" : null;
  const nextLabel = request.status === "new" ? "بدء التنفيذ" : "تمييز كمنجز";

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{TYPE_LABELS[request.type] ?? request.type}</p>
          {request.linkedMemberName && (
            <p className="text-xs text-black/50">متعلق بـ: {request.linkedMemberName}</p>
          )}
        </div>
        <StatusBadge status={request.status} />
      </div>

      {request.note && <p className="text-xs leading-relaxed text-black/60">{request.note}</p>}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-black/40">
          {request.dueDate ? `المهلة: ${formatDate(request.dueDate)}` : ""}
        </span>
        {nextStatus && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                updateRequestStatusAction(request.id, nextStatus as "in_progress" | "done")
              )
            }
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: theme.accentDark, color: readableTextOn(theme.accentDark) }}
          >
            {nextLabel}
          </button>
        )}
      </div>
    </Card>
  );
}
