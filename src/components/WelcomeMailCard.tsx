"use client";

import { useState, useTransition } from "react";
import { reportMissingWelcomeAction } from "@/app/admin/welcome-cards/actions";
import { Card, Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

/** بطاقة الانضمام: وصلت أم لم تصل — ومن لم تصله يُبلغ ولا يُرسل.
 *
 *  **قرارُ المؤسس:** لا يُرسل أحدٌ البطاقةَ لنفسه. كان هنا زرٌّ يُرسلها لصاحب
 *  الحساب مباشرةً؛ فصار «لم تصلني» يرفع تذكرةً إلى مسؤول المتابعة والتشغيل
 *  (`reportMissingWelcomeAction`)، فيتأكّد ثم يُعيدها — ولكل شخصٍ إعادةٌ
 *  واحدة. والخادمُ يفرض ذلك كلَّه، والزرّ تبعٌ له.
 *
 *  ويظهر البلاغُ في الحالين: «لم تُرسَل بعد»، و«أُرسلت» حين يقول السجلُّ إنها
 *  قُبلت ولم يجدها صاحبُها (السبام يبتلع ما قبله المزوّد). */
export function WelcomeMailCard({
  theme,
  sentAt,
  canReport,
}: {
  theme: ReturnType<typeof themeFromColor>;
  /** متى قُبلت آخرُ بطاقة — null إن لم تُرسَل بعد */
  sentAt: string | null;
  /** أله أن يُبلغ: ليس المؤسس، ولم تُستنفد فرصةُ الإعادة */
  canReport: boolean;
}) {
  const t = useTranslations().welcomeMail;
  const [ticket, setTicket] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function report() {
    setError(null);
    startTransition(async () => {
      const res = await reportMissingWelcomeAction();
      if (res.error) setError(res.error);
      else setTicket(res.ticketNumber ?? null);
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        {sentAt && (
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700"
          >
            ✓
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">{t.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-black/55">
            {sentAt ? t.receipt.replace("{date}", sentAt) : t.body}
          </p>
          {!sentAt && <p className="mt-1.5 text-xs text-black/45">{t.neverSent}</p>}
          <p className="mt-1.5 text-xs text-black/40">{t.onceOnly}</p>

          {ticket !== null ? (
            <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t.reported.replace("{n}", String(ticket))}
            </p>
          ) : (
            canReport && (
              <>
                {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
                <Button theme={theme} variant="outline" className="mt-3" disabled={pending} onClick={report}>
                  {pending ? t.sending : t.button}
                </Button>
              </>
            )
          )}
        </div>
      </div>
    </Card>
  );
}
