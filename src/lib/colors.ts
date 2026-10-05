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
