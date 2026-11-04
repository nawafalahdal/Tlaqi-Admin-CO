"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
import { resendIssuedCertificateAction } from "./actions";

/** إعادةُ إرسال شهادةٍ من السجل لم يصل بريدها — الشهادةُ نفسها برقمها، لا ثانية */
export function ResendIssuedButton({ id, number, name }: { id: string; number: string; name: string }) {
  const T = useTranslations().rIssueDesk;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="wizard-btn-2 !min-h-8 !px-2.5 !text-xs" onClick={() => setOpen(true)}>
        {T.resend}
      </button>
      <ConfirmDialog
        open={open}
        tone="brand"
        title={T.resendTitle}
        body={fmt(T.resendBody, number, name)}
        confirmLabel={T.resend}
        pending={pending}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setError(null);
          start(async () => {
            const res = await resendIssuedCertificateAction(id);
            if (res.error) return setError(res.error);
            setOpen(false);
            router.refresh();
          });
        }}
      />
    </>
  );
}
