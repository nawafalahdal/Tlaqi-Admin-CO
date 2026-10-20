"use client";

import { useState, useTransition } from "react";
import { reportMissingWelcomeAction } from "@/app/admin/welcome-cards/actions";
import { sendWelcomeToUserAction } from "@/app/admin/people/actions";
import { Card, Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

/** بطاقة الانضمام: وصلت أم لم تصل — ومن لم تصله يطلبها ممّن يعلوه.
 *
 *  **قرارُ المؤسس — سلسلةٌ كاملة (`resenderRoleFor`):** لا يُرسل أحدٌ البطاقةَ
 *  لنفسه إلا المؤسس. والباقون يطلبونها: العضو والقائد من مسؤول التشغيل،
 *  ومسؤول التشغيل من الرئيس التنفيذي، والتنفيذيُّ من المؤسس — تذكرةٌ تصل من
 *  يتأكّد ثم يُعيدها، ولكل شخصٍ إعادةٌ واحدة. والخادمُ يفرض ذلك كلَّه.
 *
 *  ويظهر البلاغُ في الحالين: «لم تُرسَل بعد»، و«أُرسلت» حين يقول السجلُّ إنها
 *  قُبلت ولم يجدها صاحبُها (السبام يبتلع ما قبله المزوّد). */
export function WelcomeMailCard({
  theme,
  sentAt,
  canReport,
  selfSend,
  resenderLabel,
}: {
  theme: ReturnType<typeof themeFromColor>;
  /** متى قُبلت آخرُ بطاقة — null إن لم تُرسَل بعد */
  sentAt: string | null;
  /** أله أن يطلب أو يُرسل الآن: لم تُستنفد فرصةُ الإعادة */
  canReport: boolean;
  /** المؤسسُ وحده يُرسلها لنفسه — معرّفُه هنا، وغيرُه `undefined` */
  selfSend?: string;
  /** من يُعيدها لصاحب الصفحة في السلسلة (`RESENDER_LABEL`) */
  resenderLabel: string;
}) {
  const t = useTranslations().welcomeMail;
  const [ticket, setTicket] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [sentNow, setSentNow] = useState(false);
  function report() {
    setError(null);
    startTransition(async () => {
      if (selfSend) {
        const res = await sendWelcomeToUserAction(selfSend);
        if (res.error) setError(res.error);
        else setSentNow(true);
        return;
      }
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
          <p className="mt-1.5 text-xs text-black/40">
            {(selfSend ? t.selfOnce : t.onceOnly).replace("{who}", resenderLabel)}
          </p>

          {sentNow ? (
            <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t.receiptNow}
            </p>
          ) : ticket !== null ? (
            <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t.reported.replace("{n}", String(ticket)).replace("{who}", resenderLabel)}
            </p>
          ) : (
            canReport && (
              <>
                {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
                <Button theme={theme} variant="outline" className="mt-3" disabled={pending} onClick={report}>
                  {pending ? t.sending : (selfSend ? t.selfButton : t.button).replace("{who}", resenderLabel)}
                </Button>
              </>
            )
          )}
        </div>
      </div>
    </Card>
  );
}
