"use client";

import { useState, useTransition } from "react";
import { resubmitApprovalAction, advanceExecutionAction } from "./actions";
import { Button } from "@/components/ui";

import { useTranslations } from "@/i18n/LocaleProvider";
/** إجراءات صاحب الطلب — بحسب حالته، لا كلُّها في كل حال.
 *
 *  المردود للتعديل يُعاد، والمعتمَد يبدأ تنفيذه، والجاري يُعلَن إكماله.
 *  وما عدا ذلك فلا إجراء له — ينتظر قرار المعتمِد.
 *
 *  والخادم يرفض على كل حال: شرطُ الكتابة يحمل الحالة السابقة، فمن حاول
 *  تنفيذاً قبل اعتماد لم يُطابق صفّاً.
 */
export function RequesterActions({
  ticketId,
  state,
  theme,
}: {
  ticketId: string;
  state: string;
  theme: Parameters<typeof Button>[0]["theme"];
}) {
  const L = useTranslations().rApprRequester;
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
        {done}
      </p>
    );
  }

  if (state === "returned") {
    return (
      <div className="mt-3 border-t border-black/5 pt-3">
        {open ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-black/70">{L.whatYouChangedRecorded}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
              />
            </label>
            {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                theme={theme}
                disabled={pending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await resubmitApprovalAction(ticketId, note);
                    if (res.error) setError(res.error);
                    else setDone(L.resubmittedToTheSame);
                  });
                }}
              >
                {pending ? L.sending : L.resubmit}
              </Button>
              <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>{L.cancel}</Button>
            </div>
          </div>
        ) : (
          <Button theme={theme} onClick={() => setOpen(true)}>{L.iChangedItResubmit}</Button>
        )}
      </div>
    );
  }

  if (state === "approved" || state === "executing") {
    const to = state === "approved" ? "executing" : "completed";
    return (
      <div className="mt-3 border-t border-black/5 pt-3">
        {error && <p className="mb-2 text-sm font-semibold text-red-700">{error}</p>}
        <Button
          theme={theme}
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await advanceExecutionAction(ticketId, to);
              if (res.error) setError(res.error);
              else setDone(to === "executing" ? L.executionStarted : L.completionDeclared);
            });
          }}
        >
          {pending ? L.working : to === "executing" ? L.startExecution : L.declareCompletion}
        </Button>
      </div>
    );
  }

  return null;
}
