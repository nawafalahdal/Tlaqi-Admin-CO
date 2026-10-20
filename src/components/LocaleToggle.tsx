"use client";

import { useLocale } from "@/i18n/LocaleProvider";
import { GlobeIcon } from "./icons";

/** زرُّ اللغة — ساكنُ شريطِ الأدوات مع السمة و«تحسين».
 *
 *  **واللافتةُ تقول ما يَنتقل إليه لا ما هو فيه.** وهذا خلافُ مفتاح
 *  السمة عمداً: المفتاحُ له قبضةٌ تُرى فتَقول الحالَ بلا كلمة، أما
 *  الزرُّ فلا قبضةَ له — فلو كُتب عليه «العربية» وهو في العربية لقُرئ
 *  لافتةً لا زرّاً، ولم يَعرف أحدٌ أين يَضغط ليُغيّر.
 *
 *  والنصُّ يُكتَب بلغته هو (`English` بالإنجليزية، `العربية` بالعربية)
 *  فيَعرفه من يَطلبه ولو لم يَقرأ الأخرى.
 *
 *  ولا حدَّ له ولا سطح: الإطارُ إطارُ المجموعة.
 */
export function LocaleToggle() {
  const { locale, setLocale, switching } = useLocale();
  const next = locale === "ar" ? "en" : "ar";
  const label = next === "en" ? "English" : "العربية";

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      // الزرُّ يُنفّذ الانتقالَ فعلاً — واللافتةُ وحدها لا تُبدَّل
      aria-label={next === "en" ? "Switch to English" : "التبديل إلى العربية"}
      title={next === "en" ? "Switch to English" : "التبديل إلى العربية"}
      lang={next}
      // يقول إنه يُبدّل وهو ينتظر نصَّ الخادم — والصفحةُ باقيةٌ كما هي
      aria-busy={switching}
      disabled={switching}
      className="ctl-group__item locale-toggle"
    >
      <GlobeIcon className="ctl-group__icon" />
      <span className="ctl-group__label">{label}</span>
    </button>
  );
}
