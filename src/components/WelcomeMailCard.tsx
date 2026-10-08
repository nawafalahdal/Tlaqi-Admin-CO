"use client";

import { useState, useTransition } from "react";
import { resendWelcomeAction } from "@/app/admin/profile/actions";
import { Card, Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

/** بطاقة الانضمام: وصلت أم لم تصل.
 *
 *  تُرسل مرة واحدة — لحظة الاعتماد — فإن وصلت لم يبقَ ما يُفعل: يُعرض
 *  إيصالُ وصولها بتاريخه ويختفي الزرّ. وبقاء زرٍّ لا عمل له يُغري بضغطه
 *  ثم يُرفض، وهو وعدٌ كاذب متكرّر.
 *
 *  ويبقى الزرّ لمن لم تصله أصلاً — شبكة أمان لرسالةٍ ابتلعها السبام —
 *  والخادم يفرض المرّة الواحدة أيضاً، لا الواجهة وحدها. */
export function WelcomeMailCard({
  theme,
  sentAt,
}: {
  theme: ReturnType<typeof themeFromColor>;
  /** متى وصلته — null إن لم تُرسل بعد */
  sentAt: string | null;
}) {
  const t = useTranslations().welcomeMail;
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resend() {
    setError(null);
    startTransition(async () => {
      const res = await resendWelcomeAction();
      if (res.error) setError(res.error);
      else setDone(true);
    });
  }

  // وصلت: إيصالٌ لا زرّ
  if (sentAt || done) {
    return (
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700"
          >
            ✓
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold">{t.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-black/55">
              {sentAt ? t.receipt.replace("{date}", sentAt) : t.receiptNow}
            </p>
            <p className="mt-1.5 text-xs text-black/40">{t.onceOnly}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">{t.title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/55">{t.body}</p>
      <p className="mt-2 text-xs text-black/45">{t.neverSent}</p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      <Button theme={theme} variant="outline" className="mt-3" disabled={pending} onClick={resend}>
        {pending ? t.sending : t.button}
      </Button>
    </Card>
  );
}
