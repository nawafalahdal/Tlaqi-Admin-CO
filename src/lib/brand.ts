import { shade, readableTextOn, liftForDark } from "./colors";

export const BRAND = {
  beige: "#EEF6DF",
  mahogany: "#C34900",
  temptress: "#341D2B",
  greenSheen: "#67C090",
  ink: "#1A1023",
} as const;

export type DepartmentSlug = "senior-administration" | "marketing" | "technical" | "hr";

/** The single visual identity registry for the platform's official departments.
 * Database identifiers remain unchanged; this registry only maps known names/slugs
 * to semantic identity colors used by badges, navigation, charts, and headers.
 */
export const DEPARTMENT_THEME: Record<
  DepartmentSlug,
  { name: string; colorHex: string; token: string }
> = {
  "senior-administration": { name: "الإدارة العليا", colorHex: BRAND.temptress, token: "senior-admin" },
  marketing: { name: "التسويق", colorHex: BRAND.mahogany, token: "marketing" },
  technical: { name: "التقنية", colorHex: BRAND.greenSheen, token: "technical" },
  hr: { name: "الموارد البشرية", colorHex: BRAND.beige, token: "hr" },
};

export const SUPER_ADMIN_THEME = DEPARTMENT_THEME["senior-administration"];

const DEPARTMENT_NAME_TO_SLUG: Record<string, DepartmentSlug> = Object.fromEntries(
  Object.entries(DEPARTMENT_THEME).map(([slug, value]) => [value.name, slug as DepartmentSlug]),
);

/** Resolve a database slug or official Arabic name without changing stored records. */
export function departmentSlugFor(value: string | null | undefined): DepartmentSlug | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized in DEPARTMENT_THEME) return normalized as DepartmentSlug;
  // المعرّفُ المخزَّن في القاعدة للقسم التقني هو `tech` لا `technical`
  if (normalized === "tech") return "technical";
  return DEPARTMENT_NAME_TO_SLUG[value!.trim()] ?? null;
}

export function departmentIdentity(value: string | null | undefined) {
  const slug = departmentSlugFor(value);
  return slug ? DEPARTMENT_THEME[slug] : null;
}

/** يبني لوحة ألوان كاملة (خلفية/نص/حدّ/زر) من لون القسم الأساسي.
 *
 *  ## الأسطحُ تَنقلب مع السمة — وهذا إصلاحُ عطبٍ رُئي في لقطة شاشة
 *
 *  **العطب:** كان `surface` لوناً فاتحاً مشتقّاً من لون القسم، يُوضَع
 *  في `style` مباشرةً. والأنماطُ السطرية لا تَنقلب مع السمة أبداً — لا
 *  `@media` يَطالها ولا `[data-theme]`. فبقيت الأسطحُ بيضاءَ في الوضع
 *  الداكن: لوحٌ ساطعٌ في شاشةِ ليلٍ، وحبرٌ فاتحٌ كُتب عليه فلم يُقرأ
 *  حرف. ورأيتُه في صفحة الترحيب بعضوٍ جديد — أوّلُ شاشةٍ يَفتحها من
 *  ينضمّ إلى الفريق.
 *
 *  **والعلاج `light-dark()` لا صنفٌ ثانٍ:** الدالّةُ تَتبع
 *  `color-scheme`، والمنصةُ تَكتبه على الجذر مع السمة. فقيمةٌ واحدةٌ
 *  تَحمل الوجهين، وتَصلح في `style` السطريّ كما تَصلح في ورقة الأنماط
 *  — ولا تُكرَّر الأصنافُ ولا تُفتَح شجرةُ شروطٍ في كل مكوّن.
 *
 *  **وما يُبنى عليه نصٌّ يَنقلب معه:** `onSurface` هو حبرُ هذا السطح،
 *  ويَنقلب حيث ينقلب. وكان الحبرُ `accentDark` — وهو داكنٌ دائماً
 *  (لأنه يُستعمَل أيضاً حدّاً بإلحاق شفافية: `accentDark + "55"`)،
 *  فلو قُلب لانكسر ذلك الاستعمال. فبقي كما هو، وجاء `onSurface` إلى
 *  جانبه لما يُكتَب على السطح.
 */
export function themeFromColor(colorHex: string) {
  const isLight = readableTextOn(colorHex) === BRAND.ink;
  const lightSurface = shade(colorHex, isLight ? 0.55 : 0.85);
  const lightSurfaceStrong = shade(colorHex, isLight ? 0.2 : 0.65);
  const lightBorder = shade(colorHex, isLight ? -0.1 : 0.4);
  const accentDark = shade(colorHex, isLight ? -0.35 : -0.1);

  return {
    base: colorHex,
    text: readableTextOn(colorHex),

    /** سطحُ البطاقة المصبوغ بلون القسم — فاتحٌ في الفاتح، غمزةٌ في الداكن */
    surface: `light-dark(${lightSurface}, color-mix(in oklab, ${colorHex} 20%, var(--surface)))`,
    surfaceStrong: `light-dark(${lightSurfaceStrong}, color-mix(in oklab, ${colorHex} 32%, var(--surface)))`,
    border: `light-dark(${lightBorder}, color-mix(in oklab, ${colorHex} 42%, transparent))`,

    /** حبرُ ما يُكتَب على `surface` — يَنقلب معه فيُقرأ في السمتين */
    onSurface: `light-dark(${accentDark}, color-mix(in oklab, ${colorHex} 35%, var(--ink)))`,

    /** لونٌ داكنٌ صريحٌ يبقى **قيمةً سداسية**: تُلحَق به شفافيةٌ نصّاً
     *  في مواضع (`accentDark + "55"`)، ويُستعمَل في قوالب البريد حيث لا
     *  `light-dark()` ولا متغيّرات. */
    accentDark,

    /** تعبئةُ الأزرار والأسطح الملوّنة — تتبع السمة.
     *
     *  `accentDark` قيمةٌ سداسيةٌ ثابتة (للبريد والشفافية الملحَقة)، ولو
     *  مُلئ بها زرٌّ لذاب في الداكن حين يكون اللونُ داكناً. فهذه تُفتّحه في
     *  الداكن وحده (`liftForDark`)، وحبرُها `onFill` يُحسَب لكل سمة. */
    fill: `light-dark(${accentDark}, ${liftForDark(accentDark)})`,
    onFill: `light-dark(${readableTextOn(accentDark)}, ${readableTextOn(liftForDark(accentDark))})`,
  };
}

/** أيّ نسختَي الشعار تصحّ على هذه الخلفية.
 *
 *  القرار واحد في موضع واحد: الخلفية الفاتحة تطلب حبراً داكناً، والداكنة
 *  فاتحاً. وتركُه لكل صفحة يعني أن تُنسى نسخةٌ في صفحة فيختفي الشعار. */
export function logoToneFor(theme: ReturnType<typeof themeFromColor>): "light" | "dark" {
  return theme.text === BRAND.ink ? "dark" : "light";
}

export function themeForDepartment(value: DepartmentSlug | string) {
  const identity = departmentIdentity(value);
  return themeFromColor(identity?.colorHex ?? BRAND.temptress);
}

/** حبرُ الهوية على سطحٍ محايد — يَدكن في الفاتح ويَفتح في الداكن.
 *
 *  **العطب الذي يُصلحه:** `accentDark` لونُ القسم مُدكَّناً، يُقرأ جيّداً
 *  على سطحٍ فاتح ويكاد يختفي على داكن. ورأيتُ ذلك مرسوماً: أرقامُ
 *  البطاقات في اللوحة صارت شبحاً في السمة الداكنة.
 *
 *  و`light-dark()` تختار بحسب `color-scheme` المعلَن على `:root`، فلا
 *  تحتاج صنفاً ولا متغيّرين. ومن لم يدعمها متصفّحُه تسقط القيمة فيرث
 *  النصُّ لونَ السمة — يفقد لمسةَ القسم ويبقى مقروءاً، وهذا أهون.
 */
export function brandInk(theme: ReturnType<typeof themeFromColor>): string {
  // في الداكن: لونُ القسم مرفوعاً حتى ٤٫٥:١ مع السطح — كان سطحَ البطاقة نفسَه
  // مصبوغاً، فيُكتب زرُّ «لم تصلني — أرسلها» بلون خلفيته ولا يُرى
  return `light-dark(${theme.accentDark}, ${liftForDark(theme.accentDark, 4.5)})`;
}

/** حدُّ الهوية — المِثل، للإطارات لا للنصّ */
export function brandInkBorder(theme: ReturnType<typeof themeFromColor>): string {
  return `light-dark(${theme.accentDark}, ${liftForDark(theme.accentDark, 3)})`;
}
