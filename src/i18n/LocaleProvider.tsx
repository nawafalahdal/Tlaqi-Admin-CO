"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "./actions";
import { getDictionary, type Dictionary, type Locale } from "./index";

type LocaleContextValue = {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
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

  const [refreshing, startRefresh] = useTransition();
  // «waiting»: بُدّلت اللغةُ وطُلبت حمولةُ الخادم — والمحتوى خفيٌّ حتى تصل
  const [phase, setPhase] = useState<"idle" | "waiting">("idle");

  // يعود المحتوى ظاهراً حين تصل حمولةُ الخادم باللغة الجديدة — لا قبلها، فلا
  // يُرى نصٌّ بلغتين لحظةً
  useEffect(() => {
    if (phase !== "waiting" || refreshing) return;
    const id = window.setTimeout(() => {
      document.documentElement.classList.remove("locale-fading");
      setPhase("idle");
    }, 40);
    return () => window.clearTimeout(id);
  }, [phase, refreshing]);

  const setLocale = useCallback((next: Locale) => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // **يتلاشى ثم ينقلب ثم يعود.** كان الاتجاهُ ينقلب والمحتوى ظاهر، فيقفز
    // كلُّ شيءٍ من جهةٍ إلى جهةٍ قطعةً واحدة. فيُخفى أولاً (١٨٠ م.ث)، ويُبدَّل
    // الاتجاهُ واللغة وهو خفيّ، ثم يظهر حين تكتمل حمولةُ الخادم.
    const apply = () => {
      setLocaleState(next);
      document.cookie = `locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
      root.lang = next;
      root.dir = next === "ar" ? "rtl" : "ltr";
      // **والخادمُ يُعاد رسمُه أيضاً.** أكثرُ الصفحات تُرسَم في الخادم بقاموسٍ
      // يُقرأ من الكعكة، و`refresh` يُعيد حمولته دون تحميلٍ كامل: تبقى
      // النماذجُ المفتوحة والسمةُ وموضعُ القائمة كما هي.
      void setLocaleAction(next).finally(() => {
        setPhase("waiting");
        startRefresh(() => router.refresh());
      });
    };
    if (reduce) return apply();
    root.classList.add("locale-fading");
    window.setTimeout(apply, 180);
    // شبكةُ أمان: لا يبقى المحتوى خفيّاً إن تعثّرت الحمولة
    window.setTimeout(() => root.classList.remove("locale-fading"), 3000);
  }, [router]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: getDictionary(locale), setLocale }),
    [locale, setLocale]
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
