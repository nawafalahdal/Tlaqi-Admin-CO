"use client";

import { createContext, startTransition, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
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

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    // **والخادمُ يُعاد رسمُه أيضاً.** أكثرُ الصفحات تُرسَم في الخادم بقاموسٍ
    // يُقرأ من الكعكة، فكان التبديلُ يُغيّر ما في المتصفّح وحده وتبقى
    // العناوينُ والجداول بلغتها القديمة حتى التنقّل التالي. و`refresh` يُعيد
    // حمولة الخادم دون تحميلٍ كامل: تبقى النماذجُ المفتوحة والسمةُ وموضعُ
    // القائمة كما هي.
    void setLocaleAction(next).finally(() => startTransition(() => router.refresh()));
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
