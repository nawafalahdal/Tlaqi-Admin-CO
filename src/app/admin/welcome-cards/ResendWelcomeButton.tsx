"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { sendWelcomeToMemberAction } from "../actions";
import { sendWelcomeToUserAction } from "../people/actions";
import { requestWelcomeResendAction } from "./actions";

import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
/** زرُّ بطاقة الانضمام — إعادةٌ لمسؤول التشغيل، وطلبُ إعادةٍ لقيادة التسويق.
 *
 *  كلاهما يمرّ بنافذة تأكيد ثم بإجرائه الخادمي.
 *
 *  والخادمُ هو من يقرّر: من يملك الإعادة، ولمن، ومتى (عشرُ دقائق بين
 *  إرسالين). ويُقال سببُ الرفض كما جاء. ولا يُعرَض البريد: النتيجةُ
 *  «قُبلت عند مزوّد البريد» — لا «وصلت» ولا «فُتحت». */
export function ResendWelcomeButton({
  kind,
  id,
  name,
  mode,
  capped,
}: {
  kind: "user" | "member";
  id: string;
  name: string;
  /** `resend` يُرسل الآن، و`request` يرفع تذكرةً إلى مسؤول التشغيل */
  mode: "resend" | "request";
  /** بلغ السقف — لا إعادةَ ولا طلب */
  capped: boolean;
}) {
  const L = useTranslations().rWelcomeResend;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      if (mode === "request") {
        const r = await requestWelcomeResendAction(kind, id);
        if (r.error) return setError(r.error);
        setOpen(false);
        setNote(fmt(L.requestRaisedTicket, r.ticketNumber));
        return router.refresh();
      }
      const res = kind === "member" ? await sendWelcomeToMemberAction(id) : await sendWelcomeToUserAction(id);
      if (res.error) return setError(res.error);
      setOpen(false);
      setNote(L.acceptedByTheEmail);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {note && <span role="status" className="text-xs font-bold text-green-800">{note}</span>}
      {capped ? (
        <span className="text-xs font-bold text-black/45">{L.resendUsedUp}</span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="wizard-btn-2 !min-h-9 !px-3 !text-xs"
          aria-label={fmt(L.ariaLabel, mode === "request" ? L.ariaRequest : L.ariaResend, name)}
        >
          {mode === "request" ? L.requestAResend : L.resend}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={mode === "request" ? L.requestAWelcomeCard : L.resendTheWelcomeCard}
        body={
          mode === "request"
            ? fmt(L.aRequestIsRaised, name)
            : fmt(L.sureTheyDidNot, name)
        }
        confirmLabel={mode === "request" ? L.raiseTheRequest : L.send}
        tone="brand"
        pending={pending}
        error={error}
        onConfirm={send}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />
    </div>
  );
}
