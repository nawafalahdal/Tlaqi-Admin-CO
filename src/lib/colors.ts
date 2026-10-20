function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function rgbToHex(r: number, g: number, b: number) {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** يُفتّح أو يُغمّق لوناً سداسياً بنسبة amount (-1 إلى 1) */
export function shade(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  const mix = amount > 0 ? 255 : 0;
  const factor = Math.abs(amount);
  return rgbToHex(
    r + (mix - r) * factor,
    g + (mix - g) * factor,
    b + (mix - b) * factor
  );
}

/** يحدد لون نص مقروء (داكن/فاتح) فوق خلفية معيّنة */
export function readableTextOn(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1A1023" : "#FDFBF6";
}

/** نسبةُ التباين بين لونين (WCAG 2.x) */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const { r, g, b: bl } = hexToRgb(hex);
    const f = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** سطحُ البطاقة في السمة الداكنة — المرجعُ الذي يُقاس عليه الزرّ */
export const DARK_SURFACE = "#202327";

/** بيجُ الهوية — بديلُ الألوان الداكنة في السمة الداكنة */
export const BRAND_BEIGE = "#EEF6DF";

/** لونُ التعبئة والحبر في السمة الداكنة: الداكنُ يصير بيجَ الهوية.
 *
 *  **عطبٌ رأيتُه:** أزرارُ الإدارة العليا ملوّنةٌ ببنفسجها (#341D2B)،
 *  وتباينُه مع سطح الداكن **١٫٠٣:١** — لا يُرى إلا نصُّه. فجُرِّب أولاً رفعُه
 *  بدرجته فجاء ورديّاً غريباً عن الهوية (قرار المؤسس: لا). فصار اللونُ الذي
 *  لا يبلغ الحدّ على الداكن **بيجَ تَـــلاقِ** (تباينُه ١٤:١ مع السطح، وحبرُه
 *  البنفسجيُّ عليه ١٣:١). والألوانُ الظاهرةُ أصلاً (المهوجني، الأخضر) تبقى
 *  ألوانَ أقسامها. `target` ٣ للأسطح والحدود و٤٫٥ للنصّ. */
export function liftForDark(hex: string, target = 3): string {
  if (contrastRatio(hex, DARK_SURFACE) >= target) return hex;
  // اللونُ القريبُ من الحدّ (مهوجنيُّ التسويق، أخضرُ التقنية) يُفتَّح قليلاً
  // فيبقى لونَ قسمه؛ والداكنُ جداً لا يبلغه إلا باهتاً فيصير بيجَ الهوية
  // الداكنُ جداً (بنفسجُ الإدارة العليا) لا يُفتَّح: تفتيحُه يُخرجه ورديّاً
  if (contrastRatio(hex, "#000000") < 1.8) return BRAND_BEIGE;
  for (let amt = 0.04; amt <= 0.44; amt += 0.04) {
    const c = shade(hex, amt);
    if (contrastRatio(c, DARK_SURFACE) >= target) return c;
  }
  return BRAND_BEIGE;
}
