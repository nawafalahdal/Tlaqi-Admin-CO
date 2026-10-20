"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { getDictionary, type Dictionary, type Locale } from "./index";

type LocaleContextValue = {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
  /** التبديلُ جارٍ: نصُّ الخادم باللغة الأخرى في الطريق */
  switching: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const router = useRouter();
  const [switching, startSwitch] = useTransition();

  // **الاتجاهُ واللغةُ يتبعان اللغةَ المُثبَتة — في الإطار نفسه.** يُبدَّلان
  // قبل الرسم مع وصول نصّ الخادم، ثم يعود المحتوى ظاهراً بتلاشٍ قصير
  // (`locale-swap`). وما لم تتغيّر اللغةُ فلا حركة — ولا في الرسم الأول.
  const shown = useRef(locale);
  useLayoutEffect(() => {
    if (shown.current === locale) return;
    shown.current = locale;
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === "ar" ? "rtl" : "ltr";
    root.classList.remove("locale-swap");
    void root.offsetWidth; // يُعاد تشغيلُ الحركة لو تتابع تبديلان
    root.classList.add("locale-swap");
    const id = window.setTimeout(() => root.classList.remove("locale-swap"), 360);
    return () => window.clearTimeout(id);
  }, [locale]);

  /** **يتبدّل كلُّه دفعةً واحدة.** كان المحتوى يُخفى ثم ينقلب الاتجاه ونصُّ
   *  المتصفح وهو خفيّ، ثم ينتظر نصَّ الخادم — فإن تأخّر ظهر بلغتين، أو بقي
   *  باهتاً حتى يصل. وهذا ما رآه المؤسس بطئاً وتقطّعاً.
   *
   *  والآن تبقى الصفحةُ كما هي ظاهرةً تعمل، وزرُّ اللغة يقول إنه يُبدّل
   *  (`switching`)؛ ولغةُ المتصفح وتحديثُ الخادم في انتقالٍ واحد
   *  (`startSwitch`) — فلا يُثبِت React أحدَهما قبل الآخر: يصل نصُّ الخادم
   *  فتتبدّل اللغةُ والاتجاهُ والنصوصُ كلُّها في إطارٍ واحد.
   *
   *  والكعكةُ تُكتب هنا قبل الطلب، فيُرسَم الخادمُ مرّةً واحدة بلغته. */
  const setLocale = useCallback(
    (next: Locale) => {
      if (next === locale || switching) return;
      document.cookie = `locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      startSwitch(() => {
        setLocaleState(next);
        router.refresh();
      });
    },
    [router, locale, switching]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: getDictionary(locale), setLocale, switching }),
    [locale, setLocale, switching]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

export function useTranslations() {
  return useLocale().t;
}
