"use client";

import { useState, useTransition } from "react";
import { decideApprovalAction } from "./actions";
import { Button } from "@/components/ui";

import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
/** قرارُ المعتمِد — والاعتماد لا يقع بضغطةٍ واحدة.
 *
 *  **نافذةُ التأكيد ليست تزييناً.** الاعتماد يُطلِق التنفيذ ويُسجَّل
 *  باسم المعتمِد ووقته، فالضغطة الخاطئة تُجيز عملاً لم يُراجَع. فتُعرَض
 *  خطوةٌ ثانية تقول: هذا الطلب، ومن رفعه، وأن الاعتماد يُجيز الانتقال
 *  إلى التنفيذ — ثم «تأكيد الاعتماد» أو «إلغاء».
 *
 *  والردّ والرفض يُلزمان بملاحظة، والخادم يُلزم بها أيضاً: الواجهة
 *  تُعطّل الزرّ، والخادم يرفض — فالحرس في الموضعين.
 */
export function ApprovalDecide({
  ticketId,
  ticketNumber,
  subject,
  requesterName,
  isReviewing,
  theme,
}: {
  ticketId: string;
  ticketNumber: number;
  subject: string;
  requesterName: string;
  isReviewing: boolean;
  theme: Parameters<typeof Button>[0]["theme"];
}) {
  const L = useTranslations().rApprDecide;
  const [panel, setPanel] = useState<"none" | "approve" | "return" | "reject">("none");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(decision: "reviewing" | "approved" | "returned" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await decideApprovalAction(ticketId, decision, note);
      if (res.error) {
        setError(res.error);
        return;
      }
      setPanel("none");
      setNote("");
      setDone(
        decision === "approved"
          ? res.nextApproverName
            ? fmt(L.youApprovedItIt, res.nextApproverName)
            : L.youGaveFinalApproval
          : decision === "returned"
            ? L.returnedToItsOwner
            : decision === "rejected"
              ? L.theRequestWasRejected
              : L.itIsNowUnder
      );
    });
  }

  if (done) {
    return (
      <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold leading-relaxed text-green-800">
        {done}
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      {panel === "none" && (
        <div className="flex flex-wrap gap-2">
          <Button theme={theme} disabled={pending} onClick={() => setPanel("approve")}>{L.approveTheRequest}</Button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setNote("");
              setPanel("return");
            }}
            className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 px-4 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >{L.returnForChanges}</button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setNote("");
              setPanel("reject");
            }}
            className="inline-flex min-h-11 items-center rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"
          >{L.rejectTheRequest}</button>
          {!isReviewing && (
            <Button theme={theme} variant="ghost" disabled={pending} onClick={() => run("reviewing")}>{L.iMReviewingIt}</Button>
          )}
        </div>
      )}

      {/* خطوة التأكيد — الاعتماد لا يقع بضغطةٍ واحدة */}
      {panel === "approve" && (
        <div className="flex flex-col gap-3 rounded-2xl bg-green-50/70 p-4 ring-1 ring-green-200">
          <p className="text-xs font-bold text-green-900">{L.confirmApproval}</p>
          <p className="text-xs leading-relaxed text-green-900/80">{L.youAreAboutTo}<strong>#{ticketNumber} — {subject}</strong>{L.raisedBy}{" "}
            <strong>{requesterName}</strong>{L.approvalLetsItsOwner}</p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{L.noteOptional}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="rounded-xl border border-green-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400"
            />
          </label>
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run("approved")}
              className="inline-flex min-h-11 items-center rounded-xl bg-green-700 px-4 text-sm font-bold text-on-brand disabled:opacity-50"
            >
              {pending ? L.approving : L.confirmApproval}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setPanel("none")}>{L.cancel}</Button>
          </div>
        </div>
      )}

      {(panel === "return" || panel === "reject") && (
        <div
          className={`flex flex-col gap-3 rounded-2xl p-4 ring-1 ${
            panel === "return" ? "bg-amber-50/70 ring-amber-200" : "bg-red-50/70 ring-red-200"
          }`}
        >
          <p className="text-xs font-bold text-black/75">
            {panel === "return" ? L.returnTheRequestFor : L.rejectTheRequest}
          </p>
          <p className="text-xs leading-relaxed text-black/60">
            {panel === "return"
              ? L.writeWhatShouldChange
              : L.writeTheReasonFor}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={panel === "return" ? L.whatShouldChange : L.reasonForRejection}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || note.trim().length < 5}
              onClick={() => run(panel === "return" ? "returned" : "rejected")}
              className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-on-brand disabled:opacity-50 ${
                panel === "return" ? "bg-amber-700" : "bg-red-700"
              }`}
            >
              {pending ? L.working : panel === "return" ? L.returnItForChanges : L.rejectTheRequest2}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setPanel("none")}>{L.cancel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
