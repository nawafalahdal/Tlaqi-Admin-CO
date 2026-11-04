"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { issueAppreciationDeskAction, issueFinalCertificateDeskAction } from "./actions";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";

/** زرُّ الشهادة في صفحة «الترحيب والتكريم».
 *
 *  - `issue`: صدرت في موعدها — تأكيدٌ ثم إصدارٌ وإرسال.
 *  - `early`: قبل موعدها — لا تصدر إلا بقرارٍ إداريٍّ مكتوب يُسجَّل بنصّه.
 *  - `resend`: صدرت ولم يصل بريدها — يُعاد بالشهادة نفسها.
 *
 *  والخادمُ هو الحَكَم: الصلاحية، والاستحقاق، وحمايةُ التكرار، وطولُ القرار.
 *  والخطأُ يُقال في النافذة كما جاء، لا تُغلَق عليه. */
export function CertificateAction({
  type,
  mode,
  memberId,
  name,
  dueLabel,
}: {
  type: "appreciation" | "final";
  mode: "issue" | "early" | "resend";
  memberId: string;
  name: string;
  /** موعدُ الاستحقاق مكتوباً — لنافذة الإصدار المبكر */
  dueLabel?: string;
}) {
  const L = useTranslations().rRecognitionDesk;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const label = mode === "early" ? L.aIssueEarly : mode === "resend" ? L.aResend : L.aIssueNow;
  const title =
    mode === "early" ? L.dlgEarlyTitle : mode === "resend" ? L.dlgResendTitle : type === "final" ? L.dlgFinalTitle : L.dlgIssueTitle;
  const body =
    mode === "early"
      ? fmt(L.dlgEarlyBody, name, dueLabel ?? "—")
      : mode === "resend"
        ? fmt(L.dlgResendBody, name)
        : fmt(type === "final" ? L.dlgFinalBody : L.dlgIssueBody, name);

  function confirm() {
    setError(null);
    if (mode === "early" && reason.trim().length < 5) return setError(L.earlyReasonRequired);
    start(async () => {
      const res =
        type === "final"
          ? await issueFinalCertificateDeskAction(memberId)
          : await issueAppreciationDeskAction(memberId, mode === "early" ? reason : null);
      if (res.error) return setError(res.error);
      setOpen(false);
      setDone(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <span role="status" className="text-xs font-bold text-green-800">
        {L.done}
      </span>
    );
  }

  return (
    <div className="flex items-center justify-end">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          mode === "early"
            ? "wizard-btn-2 !min-h-9 !px-3 !text-xs"
            : "btn-brand inline-flex min-h-9 items-center justify-center rounded-xl px-3 text-xs font-semibold"
        }
        aria-label={`${label} — ${name}`}
      >
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        tone="brand"
        body={
          <>
            <p>{body}</p>
            {mode === "early" && (
              <label className="mt-3 flex flex-col gap-1.5 text-start">
                <span className="text-xs font-bold">{L.earlyReasonLabel}</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                  rows={3}
                  required
                  placeholder={L.earlyReasonPlaceholder}
                  className="w-full rounded-xl border border-black/15 bg-white p-2.5 text-sm"
                />
              </label>
            )}
          </>
        }
        confirmLabel={mode === "resend" ? L.aResend : L.confirmIssue}
        pending={pending}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />
    </div>
  );
}
