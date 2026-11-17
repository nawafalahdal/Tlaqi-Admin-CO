/** **صورةُ الشخص — مصدرٌ واحد** للهيكل التنظيمي وصفحة الأشخاص والملف (وبطاقةُ العضوية تقرأ الملفَّين نفسيهما على الخادم
 *  عبر `defaultPortraits`). ترتيبُ الاختيار ثابت:
 *  1. صورتُه المرفوعة (`/api/avatar/...`) — متى رفعها حلّت محلَّ الافتراضية تلقائياً (الرابطُ يتغيّر بختمها).
 *  2. **الهيئةُ الافتراضية الرسمية بجنسه المسجَّل** — الملفّان أنفسُهما في البطاقة الرسمية (الرجلُ بالشماغ والثوب، والمرأةُ
 *     بالحجاب والعباية)، لا نسخٌ ولا صورٌ مولَّدة.
 *  3. **ولا جنسَ مسجَّلاً:** الحرفُ الأول من اسمه — بديلُ البطاقة نفسُه المحايد. ولا يُستنتج الجنسُ من الاسم أبداً.
 *
 *  **لا استيرادَ لخادمٍ هنا بقصد:** يدخل حزمةَ المتصفّح (كـ`avatarUrl`). */

export type PortraitGender = "male" | "female";

/** الملفّان الرسميان في البطاقة — `public/brand/2026/portraits/default-{male,female}.png` */
export const DEFAULT_PORTRAIT_FILE: Record<PortraitGender, string> = {
  male: "default-male.png",
  female: "default-female.png",
};
export const DEFAULT_PORTRAIT_DIR = "brand/2026/portraits";
export const DEFAULT_PORTRAIT_URL: Record<PortraitGender, string> = {
  male: `/${DEFAULT_PORTRAIT_DIR}/${DEFAULT_PORTRAIT_FILE.male}`,
  female: `/${DEFAULT_PORTRAIT_DIR}/${DEFAULT_PORTRAIT_FILE.female}`,
};

export type Portrait =
  | { kind: "photo"; src: string }
  | { kind: "default"; src: string; gender: PortraitGender }
  | { kind: "initials"; text: string };

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.replace(/[ـ]/g, "")[0] ?? "")
    .join("");
}

/** الصورةُ المعتمدة لشخص: المرفوعةُ، ثم الافتراضيةُ بجنسه المسجَّل، ثم الحروفُ الأولى */
export function resolvePortrait(avatarSrc: string | null | undefined, gender: string | null | undefined, name: string): Portrait {
  if (avatarSrc) return { kind: "photo", src: avatarSrc };
  if (gender === "male" || gender === "female") return { kind: "default", src: DEFAULT_PORTRAIT_URL[gender], gender };
  return { kind: "initials", text: initialsOf(name) };
}
