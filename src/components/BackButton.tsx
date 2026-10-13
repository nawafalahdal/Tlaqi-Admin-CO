"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/i18n/LocaleProvider";
import { hasInAppHistory, consumeInAppStep } from "@/components/NavDepth";

/** زرّ الرجوع — يطوف فوق الصفحة، ولا يخرج من المنصة.
 *
 *  **عطبان كانا فيه:**
 *
 *  الأول: كان يسأل `window.history.length > 1`. وهذا طولُ تاريخ التبويب
 *  كلِّه، لا تاريخُ المنصة. فمن فتح صفحةً من رابطٍ في بريده وكان قد
 *  تصفّح في التبويب نفسه موقعاً آخر، كان الشرط صحيحاً فيُنادى
 *  `router.back()` فيعود إلى ذلك الموقع — **فيخرج من المنصة**. والآن
 *  يُسأل عدّادُنا في `NavDepth`: لا يَرجع إلا وخلفه خطوةٌ من خطواتنا،
 *  وإلا صعد إلى وجهته الصريحة داخل المنصة. فالخروج صار غير ممكن.
 *
 *  الثاني: كان سطراً رمادياً باهتاً (`text-black/50`) في أعلى المحتوى،
 *  يصعد مع الصفحة فيغيب عند أول تمرير — فمن نزل في صفحةٍ طويلة لم يجد
 *  طريقاً للعودة إلا شريطَ المتصفّح. والآن يثبت في الزاوية: قرصٌ أبيض
 *  بظلٍّ وحدٍّ واضح، فوق كل شيء، وفي متناول الإبهام على الجوال.
 */
export function BackButton({ fallbackHref = "/admin" }: { fallbackHref?: string }) {
  const router = useRouter();
  const t = useTranslations();

  // الزرّ يطوف، فقد يحجب آخر سطرٍ في الصفحة على الجوال. فيُوسَّع أسفلُ
  // الصفحة ما دام معروضاً، ويُعاد كما كان عند مغادرتها — بدل أن يُضاف
  // حشوٌ يدويٌّ في ثمانية عشر ملفاً ويُنسى في التاسع عشر.
  useEffect(() => {
    document.body.classList.add("has-floating-back");
    return () => document.body.classList.remove("has-floating-back");
  }, []);

  function handleClick() {
    if (hasInAppHistory()) {
      consumeInAppStep();
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={t.common.back}
        className="fixed bottom-5 z-50 inline-flex min-h-12 items-center gap-2 rounded-full border border-black/10 bg-white/95 px-5 text-sm font-bold text-black/75 shadow-lg backdrop-blur transition-colors hover:bg-white hover:text-black ltr:left-5 rtl:right-5"
      >
        {/* السهم يتبع اتجاه القراءة: في العربية يشير يميناً */}
        <span className="text-base leading-none rtl:-scale-x-100" aria-hidden>
          ←
        </span>
        {t.common.back}
      </button>
    </>
  );
}
