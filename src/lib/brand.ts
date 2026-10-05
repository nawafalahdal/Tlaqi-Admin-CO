import { shade, readableTextOn } from "./colors";

export const BRAND = {
  beige: "#EEF6DF",
  mahogany: "#C34900",
  temptress: "#341D2B",
  greenSheen: "#67C090",
  ink: "#1A1023",
} as const;

export type DepartmentSlug = "marketing" | "hr" | "tech";

export const DEPARTMENT_THEME: Record<
  DepartmentSlug,
  { name: string; colorHex: string }
> = {
  marketing: { name: "التسويق", colorHex: BRAND.mahogany },
  hr: { name: "الموارد البشرية", colorHex: BRAND.beige },
  tech: { name: "التقنية", colorHex: BRAND.greenSheen },
};

export const SUPER_ADMIN_THEME = { name: "الإدارة العليا", colorHex: BRAND.temptress };

/** يبني لوحة ألوان كاملة (خلفية/نص/حدّ/زر) من لون القسم الأساسي */
export function themeFromColor(colorHex: string) {
  const isLight = readableTextOn(colorHex) === BRAND.ink;
  return {
    base: colorHex,
    text: readableTextOn(colorHex),
    surface: shade(colorHex, isLight ? 0.55 : 0.85),
    surfaceStrong: shade(colorHex, isLight ? 0.2 : 0.65),
    border: shade(colorHex, isLight ? -0.1 : 0.4),
    accentDark: shade(colorHex, isLight ? -0.35 : -0.1),
  };
}

export function themeForDepartment(slug: DepartmentSlug | string) {
  const entry = DEPARTMENT_THEME[slug as DepartmentSlug];
  return themeFromColor(entry ? entry.colorHex : BRAND.temptress);
}
