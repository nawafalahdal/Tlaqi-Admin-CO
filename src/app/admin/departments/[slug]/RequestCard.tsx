"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRequestStatusAction } from "../../actions";
import { Card, StatusBadge } from "@/components/ui";
import { themeFromColor } from "@/lib/brand";
import { formatDate } from "@/lib/format";
import { useTranslations } from "@/i18n/LocaleProvider";

/** طلبٌ موجَّهٌ لقسم — يبدأ العملُ عليه ثم يُغلق بسببٍ مكتوب.
 *
 *  الإغلاقُ لا يقع بنقرةٍ صامتة: يُكتب ما جرى (نتيجةُ اجتماع الشرح، أو سببُ الإغلاق)،
 *  والخادمُ يرفض ما لم يقع بعد (البنرُ قبل وصوله) ويقول لماذا. وما أُغلق يُعرض بمن أغلقه
 *  ومتى ولماذا — أو «آلياً» حين أغلقه إجراءٌ وقع فعلاً. */
export function RequestCard({
  request,
  theme,
  canAct = true,
}: {
  request: {
    id: string;
    type: string;
    status: string;
    note: string | null;
    dueDate: string | null;
    linkedMemberName: string | null;
    targetDepartmentName?: string | null;
    closedAt?: string | null;
    closedByName?: string | null;
    closeNote?: string | null;
    closedAutomatically?: boolean;
  };
  theme: ReturnType<typeof themeFromColor>;
  /** يملك العملَ عليه (والخادمُ يفرضه ثانيةً) */
  canAct?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const t = useTranslations();
  const RC = t.requestCard;

  const typeLabel = (t.requestType as Record<string, string>)[request.type] ?? request.type;
  const open = request.status !== "done";
  const isNew = request.status === "new" || request.status === "overdue";

  function act(status: "in_progress" | "done") {
    setError(null);
    startTransition(async () => {
      const res = await updateRequestStatusAction(request.id, status, status === "done" ? note : null);
      if (res.error) return setError(res.error);
      setClosing(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold">{typeLabel}</p>
          {request.linkedMemberName && (
            <p className="text-xs text-black/50">{RC.relatedTo}: {request.linkedMemberName}</p>
          )}
          {request.targetDepartmentName && <p className="text-xs text-black/45">{request.targetDepartmentName}</p>}
        </div>
        <StatusBadge status={request.status} />
      </div>

      {request.note && <p className="text-xs leading-relaxed text-black/60">{request.note}</p>}

      {!open && request.closedAt && (
        <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/60">
          {request.closedAutomatically ? RC.closedAuto : RC.closedBy.replace("{0}", request.closedByName ?? "—")}
          {" · "}
          {formatDate(request.closedAt)}
          {request.closeNote ? ` — ${request.closeNote}` : ""}
        </p>
      )}

      {closing && (
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold text-black/65">
            {request.type === "meeting" ? RC.meetingOutcome : request.type === "welcome_banner" ? RC.bannerNote : RC.closeReason}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
          />
        </label>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs text-black/40">
          {request.dueDate ? `${RC.deadline}: ${formatDate(request.dueDate)}` : ""}
        </span>
        {open && canAct && (
          <div className="flex flex-wrap gap-2">
            {isNew && !closing && (
              <button
                type="button"
                disabled={pending}
                onClick={() => act("in_progress")}
                className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {RC.startWork}
              </button>
            )}
            {!closing ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setClosing(true);
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: theme.fill, color: theme.onFill }}
              >
                {RC.markDone}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act("done")}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  style={{ background: theme.fill, color: theme.onFill }}
                >
                  {pending ? RC.closing : RC.confirmClose}
                </button>
                <button type="button" onClick={() => setClosing(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-black/55">
                  {t.common.cancel}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
