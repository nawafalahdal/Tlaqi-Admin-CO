"use client";

import { useLocale } from "@/i18n/LocaleProvider";

export function LocaleToggle({ color }: { color: string }) {
  const { locale, t, setLocale } = useLocale();

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
      className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
      style={{ color, border: `1px solid ${color}55` }}
    >
      {t.common.localeToggle}
    </button>
  );
}
