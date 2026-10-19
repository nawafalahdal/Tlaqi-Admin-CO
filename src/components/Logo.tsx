import Image from "next/image";

/** الشعار الرسمي — الأصل نفسه، صورةً، لا محاكاةً له.
 *
 *  كان اسم العلامة يُكتب هنا نصّاً («TLAQI» بخط الواجهة ونقطةٌ من CSS).
 *  وهو شعارٌ يُشبه الشعار ولا يكون هو: حرفُه غير حرفِ الهوية، ونسبةُ
 *  نقطته غير نسبتها، وكل تغيّرٍ في خطّ الواجهة يُغيّر العلامة من حيث
 *  لا نقصد. فصار الشعار ملفّ الهوية ذاته — بكسلاً ببكسل — ولا يُعاد
 *  رسمه ولا يُقارَب بـCSS.
 *
 *  ونُسخته نسختان لا أكثر: واحدة حبرها فاتح للخلفيات الداكنة، وأخرى
 *  حبرها داكن للفاتحة. وكلتاهما مولَّدة من الأصل بتغيير لون الحبر
 *  وحده — الهندسة واحدة، ودرع الرمز يبقى بلونه الرسمي في الحالتين. */

/** نسب الشعار الرسمي كما وردت: 880 × 259 */
const LOCKUP_RATIO = 259 / 880;

export type LogoTone = "light" | "dark";

/** الرمز وحده — درعٌ برتقالي بلونه الرسمي، فلا يتبدّل بالخلفية.
 *
 *  ولا `rounded-full` ولا `object-cover`: صورة الرمز بيضويّةٌ مدبَّبة
 *  من أسفل، وتدويرُها دائرةً يقصّ طرفها ويُسوّي حوافّها — فيخرج شكلٌ
 *  غير شكل الهوية. والقصّ تحويرٌ للشعار كالرسم من جديد. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      src="/brand/symbol.png"
      alt="تَـــلاقِ"
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
      priority
    />
  );
}

/** الشعار الكامل: الرمز واسم العلامة.
 *
 *  `height` ارتفاع الشعار بالبكسل — والعرض يتبعه بنسبة الأصل. */
export function LogoLockup({
  height = 32,
  tone = "dark",
}: {
  height?: number;
  tone?: LogoTone;
}) {
  const width = Math.round(height / LOCKUP_RATIO);
  return (
    <Image
      src={tone === "light" ? "/brand/lockup-on-dark.png" : "/brand/lockup-on-light.png"}
      alt="تَـــلاقِ — TLAQI"
      width={width}
      height={height}
      className="shrink-0"
      style={{ width, height }}
      priority
    />
  );
}


/** الشعارُ على سطحٍ يتبع السمة: نسختاه معاً، والسمةُ تُظهر المناسبة.
 *  (السمةُ تُقرأ قبل الرسم في `<html data-theme>`، فلا يعرفها الخادم ليختار.) */
export function ThemedLockup({ height = 30 }: { height?: number }) {
  return (
    <>
      <span className="logo-on-light-theme"><LogoLockup height={height} tone="dark" /></span>
      <span className="logo-on-dark-theme"><LogoLockup height={height} tone="light" /></span>
    </>
  );
}
