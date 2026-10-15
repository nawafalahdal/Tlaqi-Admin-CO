"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { SunIcon, MoonIcon } from "./icons";

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

/** مفتاحُ السمة — ساكنُ شريطِ الأدوات مع اللغة و«تحسين».
 *
 *  **ولماذا يُعرَض الحالُ لا البديل:** الزرُّ الذي يقول «داكن» يُربك —
 *  أهو وصفٌ لما أنا فيه أم لما سأصير إليه؟ فصار مفتاحاً: الشمسُ
 *  والهلالُ مرسومان على طرفيه، والقبضةُ واقفةٌ على المُطبَّق،
 *  و`aria-checked` يقول للقارئ الآليّ ما تقوله القبضةُ للعين.
 *
 *  **والأيقونتان مرسومتانِ لا حرفانِ** — انظر `@/components/icons`:
 *  كانتا `☀` و`☾`، وليستا في خطّ المنصة أصلاً، فكان كلُّ جهازٍ يَرسمهما
 *  بخطٍّ يَختاره بنفسه. وظهرت الشمسُ على الآيفون نجمةً مشوّهة.
 *
 *  ولا حدَّ له ولا سطحَ: الإطارُ إطارُ المجموعة، فلا تُرسَم حدودٌ فوق
 *  حدود.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  // النصُّ يُقرأ من المعجم لا يُمرَّر من ثلاثين موضعاً
  const { t } = useLocale();
  const isDark = theme === "dark";
  const next: ThemeChoice = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={next === "dark" ? t.common.themeToDark : t.common.themeToLight}
      title={next === "dark" ? t.common.themeToDark : t.common.themeToLight}
      onClick={() => applyTheme(next)}
      className="ctl-group__item theme-switch"
    >
      <SunIcon className="theme-switch__icon theme-switch__icon--sun" />
      <span aria-hidden className="theme-switch__track">
        <span className="theme-switch__knob" />
      </span>
      <MoonIcon className="theme-switch__icon theme-switch__icon--moon" />
      {/* النصُّ يُطوى على الجوّال: القبضةُ والأيقونتان تَكفيان */}
      <span className="ctl-group__label">
        {isDark ? t.common.themeDark : t.common.themeLight}
      </span>
    </button>
  );
}
