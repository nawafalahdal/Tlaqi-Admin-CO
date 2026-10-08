"use client";

import { useState, useTransition } from "react";
import { resendWelcomeAction } from "@/app/admin/profile/actions";
import { Card, Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

/** «لم يصلني البريد الترحيبي».
 *
 *  رسالة تضيع في السبام أو تُحذف سهواً تترك صاحبها بلا الوثيقة الوحيدة
 *  التي فيها اسمه ومهمته كما سُجِّلا. وطلبها من أحدٍ آخر إذلال صغير
 *  متكرّر — فيُعطى الزرّ لصاحبه مباشرة، ويُحسب كل إرسال في السجل. */
export function WelcomeMailCard({
  theme,
  sentAt,
  count,
}: {
  theme: ReturnType<typeof themeFromColor>;
  /** متى وصلته آخر مرة — null إن لم يُرسل قط */
  sentAt: string | null;
  count: number;
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

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">{t.title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/55">{t.body}</p>

      <p className="mt-2 text-xs text-black/45">
        {sentAt ? `${t.lastSent}: ${sentAt}${count > 1 ? ` · ${t.timesSent}: ${count}` : ""}` : t.neverSent}
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      {done ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800">
          {t.done}
        </p>
      ) : (
        <Button theme={theme} variant="outline" className="mt-3" disabled={pending} onClick={resend}>
          {pending ? t.sending : t.button}
        </Button>
      )}
    </Card>
  );
}
