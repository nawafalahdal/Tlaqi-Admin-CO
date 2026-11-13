"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";
import { resendReopenedTestAction } from "./actions";

/** «إعادة إرسال رسالة الاختبار» — لمرشّحٍ أُعيد فتحُ اختباره ولم يدخل بعد.
 *
 *  كانت رسالةُ الإعادة مكتومةً فلا يعلم المرشّح، ولا طريقَ لإبلاغه: لا يُعاد الفتحُ مرتين، ولا تُنشأ له
 *  دعوةٌ ثانية. فهذا الزرُّ يُرسلها ويبدأ مهلةَ الدخول من الآن — في «دعوات مفتوحة» بلوحة القسم وفي «العالقون». */
export function ResendReopenedTestButton({
  memberId,
  theme,
}: {
  memberId: string;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const s = useTranslations().stuck;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function resend() {
    setResult(null);
    startTransition(async () => {
      const res = await resendReopenedTestAction(memberId);
      setResult(res.error ? { ok: false, text: res.error } : { ok: true, text: s.resendReopenDone });
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <p className="text-xs text-black/50">{s.resendReopenHint}</p>
      <Button theme={theme} variant="outline" onClick={resend} disabled={pending || result?.ok === true}>
        {pending ? s.working : s.resendReopen}
      </Button>
      {result && (
        <p role="status" className={`text-xs font-semibold ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
