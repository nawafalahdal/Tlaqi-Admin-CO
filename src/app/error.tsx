"use client";

import { useEffect } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";

/** حدُّ الخطأ لكل الصفحات: جملةٌ بشرية وزرُّ إعادة — لا أثرَ مكدّسٍ ولا رسالةٌ
 *  داخلية. ويقول صراحةً إن شيئاً لم يُحفَظ بسببه، لأن من رأى الخطأ بعد ضغطِ
 *  زرٍّ يسأل أولاً: هل نُفّذ ما طلبت؟ والمعرّفُ (`digest`) يُعرض ليُبلَغ به. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="state-error" role="alert">
        <p className="text-lg font-bold">{t.shell.errorTitle}</p>
        <p className="mt-2 text-sm leading-relaxed text-black/55">{t.shell.errorBody}</p>
        {error.digest && (
          <p className="mt-2 text-[11px] text-black/40" dir="ltr">
            ref: {error.digest}
          </p>
        )}
        <button type="button" onClick={reset} className="btn-brand mt-5 min-h-11 rounded-xl px-5 text-sm font-semibold">
          {t.shell.retry}
        </button>
      </div>
    </main>
  );
}
