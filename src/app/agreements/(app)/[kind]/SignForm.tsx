"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { requestOtpAction, signAction } from "../../actions";

type Theme = ReturnType<typeof themeFromColor>;
const field = "min-h-11 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2 text-sm outline-none focus:border-black/40";

/** **نموذجُ التوقيع** — تأكيدُ القراءة يُتاح بعد بلوغ آخر النص؛ ثم رمزُ البريد، والاسمُ المكتوب، والموافقة.
 *  عرضٌ لا إذن: الخادمُ يفحص كلَّ شرطٍ ثانيةً. */
export function SignForm(p: { kind: string; templateId: string; documentHash: string; accountName: string; roleLabel: string; email: string; next: string; theme: Theme }) {
  const [reachedEnd, setReachedEnd] = useState(false);
  const [otpState, otpAction, otpPending] = useActionState(requestOtpAction, { error: null, success: false });
  const [signState, sign, signPending] = useActionState(signAction, { error: null, success: false });
  useEffect(() => {
    const el = document.getElementById("agreement-text");
    if (!el) return;
    const check = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReachedEnd(true);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, []);
  const masked = p.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-hairline bg-white p-5">
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-black/55">الاسم في حسابك</dt><dd className="font-semibold">{p.accountName}</dd></div>
        <div><dt className="text-xs text-black/55">صفتك</dt><dd className="font-semibold">{p.roleLabel}</dd></div>
        <div><dt className="text-xs text-black/55">بريد التحقّق</dt><dd className="font-semibold" dir="ltr">{masked}</dd></div>
      </dl>
      {!reachedEnd && <p className="text-xs text-amber-900">مرّر النص حتى آخره لتأكيد القراءة.</p>}
      <form action={otpAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="kind" value={p.kind} />
        <Button theme={p.theme} type="submit" variant="outline" disabled={otpPending || !reachedEnd}>
          {otpPending ? "يُرسَل…" : "إرسال رمز التحقّق إلى بريدي"}
        </Button>
        {otpState.error && <span role="alert" className="text-sm text-red-700">{otpState.error}</span>}
        {otpState.success && <span role="status" className="text-sm text-emerald-800">{otpState.message}</span>}
      </form>
      <form action={sign} className="flex flex-col gap-3">
        <input type="hidden" name="kind" value={p.kind} />
        <input type="hidden" name="templateId" value={p.templateId} />
        <input type="hidden" name="documentHash" value={p.documentHash} />
        <input type="hidden" name="next" value={p.next} />
        <label className="flex min-h-10 items-start gap-2.5 text-sm">
          <input type="checkbox" name="readAll" required disabled={!reachedEnd} className="mt-1 h-4 w-4" />
          قرأتُ نصَّ الاتفاقية كاملاً وفهمتُه.
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">اكتب اسمك الكامل كما في حسابك (توقيعٌ مكتوب)</span>
          <input name="typedName" required autoComplete="off" className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">رمز التحقّق (ستة أرقام)</span>
          <input name="otp" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" dir="ltr" className={field} />
        </label>
        <label className="flex min-h-10 items-start gap-2.5 text-sm">
          <input type="checkbox" name="consent" required className="mt-1 h-4 w-4" />
          أوافق على أن توقيعي الإلكتروني هنا تعبيرٌ عن موافقتي على هذه الاتفاقية.
        </label>
        <Button theme={p.theme} type="submit" disabled={signPending || !reachedEnd}>
          {signPending ? "يُوقَّع…" : "أوافق على الاتفاقية وأوقع إلكترونيًا"}
        </Button>
        {signState.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{signState.error}</p>}
      </form>
    </div>
  );
}
