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
