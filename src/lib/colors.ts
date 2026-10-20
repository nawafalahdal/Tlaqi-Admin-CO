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

/** لونُ التعبئة في السمة الداكنة: يُفتَّح اللونُ الداكن حتى يُرى.
 *
 *  **عطبٌ رأيتُه:** أزرارُ الإدارة العليا ملوّنةٌ ببنفسجها (#341D2B)،
 *  وتباينُه مع سطح الداكن **١٫٠٣:١** — أي أنه لا يُرى إلا نصُّه. فيُفتَّح
 *  هنا حتى يبلغ ٣:١ مع السطح (حدُّ العناصر الرسومية)، ويبقى النصُّ الأبيض
 *  عليه فوق ٤٫٥:١. والألوانُ الظاهرةُ أصلاً (المهوجني، الأخضر) لا تُمَسّ. */
export function liftForDark(hex: string, target = 3): string {
  if (contrastRatio(hex, DARK_SURFACE) >= target) return hex;
  // يُرفَع السطوعُ بدرجة اللون نفسها (HSL) لا بخلطه بالأبيض: الخلطُ يُبهِت
  // البنفسجَ رمادياً فيضيع أنه لونُ الإدارة العليا
  const { h, s, l } = toHsl(hex);
  const sat = Math.max(s, 0.28);
  let c = hex;
  for (let next = l; next < 0.95 && contrastRatio(c, DARK_SURFACE) < target; next += 0.02) {
    c = fromHsl(h, sat, next);
  }
  return c;
}

function toHsl(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === R ? ((G - B) / d + (G < B ? 6 : 0)) / 6 : max === G ? ((B - R) / d + 2) / 6 : ((R - G) / d + 4) / 6;
  return { h, s, l };
}

function fromHsl(h: number, s: number, l: number) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return rgbToHex(ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255);
}
