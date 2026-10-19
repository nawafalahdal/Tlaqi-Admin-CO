import type { ReactNode } from "react";

/** أيقوناتٌ مرسومةٌ لا حروفٌ من خطّ النصّ.
 *
 *  **وهذا إصلاحُ عطبٍ رأيتُه في لقطةِ الشاشة ثم تحقّقتُ منه في ملفّ
 *  الخطّ:** كانت الشمسُ والهلالُ حرفَين (`☀` و`☾`)، وكتبتُ حينها أن
 *  «الأيقونةَ من الخطّ نفسِه فلا ملفَّ يُحمَّل». وكان ذلك خطأً: فتحتُ
 *  ملفّ Cairo وبحثتُ عن `U+2600` و`U+263E` فلم أجدهما. فالحرفان ليسا
 *  من خطّ المنصة أصلاً — يَرسمهما كلُّ جهازٍ بخطٍّ احتياطيٍّ يَختاره
 *  بنفسه. فظهرت الشمسُ على الآيفون نجمةً سوداء مشوّهة، وظهر الهلالُ
 *  قوساً صغيراً لا يُعرَف.
 *
 *  فصارت مرسومةً هنا: شكلٌ واحدٌ على كل جهاز، يَتبع لونَ ما حوله
 *  (`currentColor`) ومقاسَه (`1em`)، ولا ملفَّ يُحمَّل ولا مكتبةَ تُضاف.
 */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  width: "1em",
  height: "1em",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

/** شمسٌ — قرصٌ وثمانيةُ أشعّة */
export function SunIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** هلالٌ — مرسومٌ بمسارٍ واحدٍ ممتلئ، فيُقرأ على أيّ مقاس */
export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} fill="currentColor" stroke="none">
      <path d="M20.3 14.6A8.5 8.5 0 0 1 9.4 3.7a1 1 0 0 0-1.3-1.2 10.5 10.5 0 1 0 13.4 13.4 1 1 0 0 0-1.2-1.3Z" />
    </svg>
  );
}

/** وميضٌ — وسمُ زرّ «تحسين» */
export function SparkIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} fill="currentColor" stroke="none">
      <path d="M12 2.5l1.8 5.2 5.2 1.8-5.2 1.8L12 16.5l-1.8-5.2L5 9.5l5.2-1.8L12 2.5Z" />
      <path d="M18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" opacity="0.75" />
    </svg>
  );
}

/** كرةٌ أرضيةٌ — وسمُ زرّ اللغة */
export function GlobeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </svg>
  );
}

/** أيقوناتُ القائمة الجانبية — خطٌّ واحد، سُمكٌ واحد، ومقاسُ النصّ.
 *  تُرسَم من اسم البند (`NavIcon`) فلا يحمل نموذجُ القائمة مكوّنات. */
const NAV_PATHS: Record<string, ReactNode> = {
  members: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  approvals: (
    <>
      <rect x="5" y="3.5" width="14" height="17.5" rx="2.5" />
      <path d="M9 3.5V2.5h6v1M8.8 12.5l2.2 2.2 4.4-4.4" />
    </>
  ),
  departments: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  execution: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  reports: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  plans: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H11l2 2.5h4.5A2.5 2.5 0 0 1 20 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z" />
    </>
  ),
  tickets: (
    <>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5Z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </>
  ),
  structure: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1.5" />
      <rect x="3" y="16" width="6" height="5" rx="1.5" />
      <rect x="15" y="16" width="6" height="5" rx="1.5" />
      <path d="M12 8v4M6 16v-2h12v2" />
    </>
  ),
  invites: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </>
  ),
  messages: (
    <>
      <path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20.5l1.4-4.5A7.5 7.5 0 1 1 20 12.5Z" />
    </>
  ),
  signature: (
    <>
      <path d="M3 18c2.5 0 3.5-9 6-9s1 7 3.5 7S15 11 17 11s2 4 4 4" />
      <path d="M3 21h18" />
    </>
  ),
  terminations: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M9 8l-4 4 4 4M5 12h11" />
    </>
  ),
  sheet: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M3.5 9h17M3.5 14.5h17M9.5 9v11.5" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19v-8.5Z" />
    </>
  ),
  operations: (
    <>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </>
  ),
  chevron: <path d="m14.5 6-6 6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function NavGlyph({ name, className }: IconProps & { name: string }) {
  return (
    <svg {...base} strokeWidth={1.8} className={className}>
      {NAV_PATHS[name] ?? null}
    </svg>
  );
}
