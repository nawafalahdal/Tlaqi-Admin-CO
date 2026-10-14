"use client";

import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark";

const STORAGE_KEY = "tlaqi-theme";

/** السمةُ المطبَّقة تُقرأ من الوثيقة نفسها لا من حالةٍ ثانية.
 *
 *  النصُّ المبكّر في `<head>` كتبها على `<html>` قبل أن يَحيا React،
 *  فالوثيقة هي المصدر الوحيد. ولو احتفظ المكوّن بنسخةٍ منها في `state`
 *  لصار مصدران قد يختلفان — ومن بدّل السمة في تبويبٍ آخر، أو بدّل جهازُه
 *  ليلاً، وجد الزرّ يقول غير الواقع.
 *
 *  و`useSyncExternalStore` هو بابُ React إلى حالةٍ خارج شجرته: يقرأ عند
 *  كل رسم ويُعيد الرسم عند الإشعار — بلا `setState` في `useEffect`
 *  يُطلق رسماً متتابعاً.
 */
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  /** تفضيلُ النظام يُتبَع لمن لم يختر بيده — ومن اختار لا يُعاد قسراً */
  const onSystem = (e: MediaQueryListEvent) => {
    let chosen: string | null = null;
    try {
      chosen = localStorage.getItem(STORAGE_KEY);
    } catch {
      chosen = null;
    }
    if (chosen) return;
    document.documentElement.dataset.theme = e.matches ? "dark" : "light";
    onChange();
  };

  media.addEventListener("change", onSystem);
  window.addEventListener("tlaqi-theme-change", onChange);
  // وتبويبٌ آخر بدّلها: الصفحتان لصاحبٍ واحد، فلا تتناقضان أمامه
  window.addEventListener("storage", onChange);

  return () => {
    media.removeEventListener("change", onSystem);
    window.removeEventListener("tlaqi-theme-change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readTheme(): ThemeChoice {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** على الخادم لا تُعرَف سمةُ الجهاز، فيُفترَض الفاتح ثم يُصحَّح بعد
 *  الترطيب مباشرةً — وهذا ما يفعله `useSyncExternalStore` بنفسه. */
function serverTheme(): ThemeChoice {
  return "light";
}

export function applyTheme(next: ThemeChoice) {
  const root = document.documentElement;
  // الانتقال يُفتَح لحظةَ التبديل ويُغلق بعده: لو بقي مفتوحاً لتباطأ كلُّ
  // تفاعلٍ في المنصة خلفه
  root.classList.add("theme-switching");
  root.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // متصفّحٌ يمنع التخزين: السمة تعمل لهذه الجلسة ولا تُحفَظ
  }
  window.dispatchEvent(new Event("tlaqi-theme-change"));
  window.setTimeout(() => root.classList.remove("theme-switching"), 260);
}

/** زرّ التبديل بين الفاتح والداكن — في ترويسة كل صفحة، لكل من يفتح
 *  المنصة: المؤسس والقائد والعضو سواء.
 *
 *  ويُلوَّن بلون الترويسة الذي يُمرَّر إليه كبقية أزرارها، فلا يشذّ عنها
 *  في سمةٍ ولا في قسم.
 */
export function ThemeToggle({ color }: { color: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const next: ThemeChoice = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      aria-label={next === "dark" ? "التبديل إلى الوضع الداكن" : "التبديل إلى الوضع الفاتح"}
      title={next === "dark" ? "الوضع الداكن" : "الوضع الفاتح"}
      onClick={() => applyTheme(next)}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold opacity-90 transition-opacity hover:opacity-100"
      style={{ color, border: `1px solid ${color}55` }}
    >
      {/* الأيقونة من الخطّ نفسه: لا ملفَّ يُحمَّل ولا مكتبةَ أيقونات */}
      <span aria-hidden className="text-sm leading-none">
        {theme === "dark" ? "☀" : "☾"}
      </span>
      <span className="hidden sm:inline">{theme === "dark" ? "فاتح" : "داكن"}</span>
    </button>
  );
}
