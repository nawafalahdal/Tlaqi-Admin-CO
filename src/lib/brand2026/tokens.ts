import { contrastRatio } from "@/lib/colors";

/** **نظامُ التصميم — هوية تلاق 2026 (الإصدار 1.0).** المرجعُ الوحيد: حزمةُ الهوية (`brand-assets/2026`،
 *  `docs/brand/KIT-README.md`). لا لونَ ولا خطَّ ولا نمطَ من خارجها.
 *
 *  - **أربعة ألوان فقط** — لا أزرق، ولا شفافية تصنع لوناً خامساً.
 *  - **الأدوار** (`ROLE`) تُشتقّ من الألوان الأربعة وأزواج التباين المعتمدة وحدها، فلا يُكتب لونٌ في مكوّن.
 *  - **القراراتُ المفتوحة** (ق1–ق11 في `docs/brand/BRAND-AUDIT.md`) مقترحاتٌ هنا، ولا تُفعَّل قبل اعتماد المؤسس.
 *
 *  هذا الملفُّ لا يغيّر شيئاً في المنصة الحية: يُقرأ في مركز المراجعة وحده حتى يُفعَّل الإصدار. */

export const BRAND_VERSION = { number: 1, label: "هوية تلاق 2026 · الإصدار 1.0", date: "نوفمبر 2026" } as const;

export const COLORS = {
  beige: { name: "Beige", hex: "#EEF6DF", roleAr: "الخلفية الأساسية" },
  temptress: { name: "Temptress", hex: "#341D2B", roleAr: "النص والخلفيات الداكنة" },
  mahogany: { name: "Mahogany", hex: "#C34900", roleAr: "العناوين والنمط على الفاتح" },
  greenSheen: { name: "Green Sheen", hex: "#67C090", roleAr: "أغلفة كاملة مع Temptress" },
} as const;
export type BrandColor = keyof typeof COLORS;
export const HEX = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v.hex])) as Record<BrandColor, string>;

/** أزواجُ التباين كما في ملف الهوية — ومعها القيمةُ المحسوبة هنا للتحقّق (لا تُفترض) */
export const CONTRAST_PAIRS = [
  { fg: "temptress", bg: "beige", kit: 13.9, use: "أعلى تباين؛ مناسب لكل النصوص", text: true },
  { fg: "temptress", bg: "greenSheen", kit: 7.0, use: "مناسب للنصوص", text: true },
  { fg: "mahogany", bg: "beige", kit: 4.4, use: "للعناوين الكبيرة والعناصر غير النصية؛ لا للنص الصغير", text: false },
  { fg: "greenSheen", bg: "beige", kit: 2.0, use: "لا للنص؛ للكتل والأنماط الزخرفية فقط", text: false },
  { fg: "mahogany", bg: "temptress", kit: null, use: "غير مدرج في ملف الهوية — للعلامة والنمط فقط", text: false },
] as const satisfies readonly { fg: BrandColor; bg: BrandColor; kit: number | null; use: string; text: boolean }[];

export function measuredContrast(fg: BrandColor, bg: BrandColor) {
  return Math.round(contrastRatio(HEX[fg], HEX[bg]) * 10) / 10;
}

/** الخط المعتمد — بأوزانه الأربعة. **رخصته غير مرفقة (ق1):** لا يُضمَّن علناً قبل تأكيدها */
export const TYPEFACE = {
  family: "The Year of The Camel",
  weights: [
    { weight: 400, name: "Regular", file: "TheYearofTheCamel-Regular.otf" },
    { weight: 500, name: "Medium", file: "TheYearofTheCamel-Medium.otf" },
    { weight: 700, name: "Bold", file: "TheYearofTheCamel-Bold.otf" },
    { weight: 800, name: "ExtraBold", file: "TheYearofTheCamel-ExtraBold.otf" },
  ],
  /** احتياطٌ لا بديل: يظهر حيث يتعذّر الخط (البريد، أو قبل تحميله) */
  fallback: "Tahoma, Arial, sans-serif",
} as const;

export const LOGOS = {
  full: [
    { file: "TLAQI-logo-full_on-beige", bg: "beige", noteAr: "النسخة الافتراضية — Mahogany للعلامة وTemptress للكلمة", derived: false },
    { file: "TLAQI-logo-full_on-temptress", bg: "temptress", noteAr: "على الداكن — الكلمة Beige والعلامة Mahogany", derived: false },
    { file: "TLAQI-logo-full_on-mahogany", bg: "mahogany", noteAr: "لون واحد: كل الشعار Beige", derived: false },
    { file: "TLAQI-logo-full_on-green-sheen", bg: "greenSheen", noteAr: "لون واحد Temptress — مشتقّة، غير معروضة في ملف الهوية (ق5)", derived: true },
  ],
  mark: [
    { file: "TLAQI-mark_mahogany", bg: "beige", noteAr: "العلامة على الفاتح أو الداكن — حين يقلّ عرض الشعار عن 70 مم" },
    { file: "TLAQI-mark_beige", bg: "mahogany", noteAr: "العلامة على Mahogany" },
    { file: "TLAQI-mark_temptress", bg: "greenSheen", noteAr: "العلامة على Green Sheen" },
  ],
  /** نسبةُ الشعار الكامل من ملفّه (2400×706) */
  fullRatio: 706 / 2400,
  /** مقترح ق4: أدنى عرضٍ رقميٍّ للشعار الكامل، وإلا العلامة وحدها */
  minFullWidthPx: 160,
} as const;

export const PATTERNS = [
  { key: "talent", ar: "موهبة", en: "TALENT", meaningAr: "ثماني قطرات متساوية تنطلق من مركز واحد، صغيرة ومتزنة في كل اتجاه.", primary: true },
  { key: "innovation", ar: "ابتكار", en: "INNOVATION", meaningAr: "أربع قطرات تتجه من مركز واحد إلى الخارج، كزهرة تنمو.", primary: false },
  { key: "link", ar: "ربط", en: "LINK", meaningAr: "قوس يصل بين نقطتين، تمثّل الصلة بين الموهبة والجهة.", primary: false },
] as const;

export const LETTER_MARKS = [
  { letter: "T", en: "TALENT", ar: "موهبة" },
  { letter: "L", en: "LINK", ar: "ربط" },
  { letter: "A", en: "ADVANCING", ar: "تقدّم" },
  { letter: "Q", en: "QUALITY", ar: "جودة" },
  { letter: "I", en: "INNOVATION", ar: "ابتكار" },
] as const;

export const ICONS = [
  "landmark", "shield-check", "badge-check", "chart-line", "building", "check", "receipt", "target", "rocket", "wallet",
  "clock", "layout-template", "building-2", "sparkles", "user", "link", "repeat", "minus", "gavel", "search",
  "file-check", "piggy-bank", "arrow-left", "award", "users", "layers", "bell", "trophy", "megaphone", "lightbulb",
] as const;

/** **أدوارُ الألوان في الواجهة** — كلُّ مكوّنٍ يقرأ دوراً لا لوناً. والمقترحاتُ (ق2، ق9، ق10) موسومة. */
export const ROLE = {
  light: {
    page: HEX.beige,
    surface: HEX.beige,
    ink: HEX.temptress,
    heading: HEX.mahogany, // العناوين الكبيرة وحدها (4.4:1)
    border: HEX.temptress, // حدٌّ رفيعٌ صلب كما في ملف الهوية (ق10)
    primaryBg: HEX.temptress, // ق9: الزر الأساسي Temptress بنص Beige (13.9:1)
    primaryInk: HEX.beige,
    accentBg: HEX.greenSheen, // ق9: الثانوي Green Sheen بنص Temptress (7.0:1)
    accentInk: HEX.temptress,
    focus: HEX.mahogany,
  },
  dark: {
    page: HEX.temptress,
    surface: HEX.temptress,
    ink: HEX.beige,
    heading: HEX.beige,
    border: HEX.beige,
    primaryBg: HEX.beige,
    primaryInk: HEX.temptress,
    accentBg: HEX.greenSheen,
    accentInk: HEX.temptress,
    focus: HEX.greenSheen,
  },
} as const;

/** ق2: حالاتُ الواجهة بالألوان الأربعة — والمعنى بالأيقونة والكلمة لا باللون وحده */
export const STATES = {
  success: { label: "نجاح", icon: "check", bg: HEX.greenSheen, ink: HEX.temptress, border: HEX.greenSheen, borderStyle: "solid" },
  error: { label: "خطأ", icon: "shield-check", bg: HEX.beige, ink: HEX.temptress, border: HEX.mahogany, borderStyle: "solid" },
  warning: { label: "تنبيه", icon: "bell", bg: HEX.beige, ink: HEX.temptress, border: HEX.mahogany, borderStyle: "dashed" },
  info: { label: "معلومة", icon: "lightbulb", bg: HEX.beige, ink: HEX.temptress, border: HEX.temptress, borderStyle: "solid" },
} as const;

/** متغيّراتُ CSS لنطاق المعاينة — تُلصق على حاويةٍ واحدة فلا تمسّ بقية الصفحة */
export function previewCssVars(mode: "light" | "dark" = "light"): Record<string, string> {
  const r = ROLE[mode];
  return {
    "--b26-page": r.page,
    "--b26-surface": r.surface,
    "--b26-ink": r.ink,
    "--b26-heading": r.heading,
    "--b26-border": r.border,
    "--b26-primary": r.primaryBg,
    "--b26-on-primary": r.primaryInk,
    "--b26-accent": r.accentBg,
    "--b26-on-accent": r.accentInk,
    "--b26-focus": r.focus,
    "--b26-mahogany": HEX.mahogany,
    "--b26-green": HEX.greenSheen,
    "--b26-font": `"${TYPEFACE.family}", ${TYPEFACE.fallback}`,
  };
}
