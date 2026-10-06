"use client";

import { useTransition } from "react";
import { updateRequestStatusAction } from "../../actions";
import { Card, StatusBadge } from "@/components/ui";
import { themeFromColor } from "@/lib/brand";
import { readableTextOn } from "@/lib/colors";
import { formatDate } from "@/lib/format";
import { useTranslations } from "@/i18n/LocaleProvider";

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
  const t = useTranslations();

  const nextStatus =
    request.status === "new" ? "in_progress" : request.status === "in_progress" ? "done" : null;
  const nextLabel = request.status === "new" ? t.requestCard.startWork : t.requestCard.markDone;
  const typeLabel = (t.requestType as Record<string, string>)[request.type] ?? request.type;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{typeLabel}</p>
          {request.linkedMemberName && (
            <p className="text-xs text-black/50">{t.requestCard.relatedTo}: {request.linkedMemberName}</p>
          )}
        </div>
        <StatusBadge status={request.status} />
      </div>

      {request.note && <p className="text-xs leading-relaxed text-black/60">{request.note}</p>}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-black/40">
          {request.dueDate ? `${t.requestCard.deadline}: ${formatDate(request.dueDate)}` : ""}
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
