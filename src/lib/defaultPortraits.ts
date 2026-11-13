import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** **الصورةُ الافتراضية في البطاقة الرسمية** — لمن لم يرفع صورته (قرار المؤسس، نوفمبر 2026).
 *
 *  هيئتان بلا ملامح يزوّدنا بهما المؤسس: **رجلٌ بثوبٍ وشماغ** و**امرأةٌ بحجاب** — بجنس صاحب الحساب كما اختاره عند
 *  تسجيله. تُحفظان كما هما في `public/brand/2026/portraits/` (`default-male` و`default-female`، PNG أو JPG) — لا
 *  تُرسمان هنا. وإن غابت إحداهما، أو لم يُحدَّد جنسُ صاحب الحساب، بقيت البطاقةُ على الحرف الأول من اسمه. */
export type PortraitGender = "male" | "female";

const DIR = join(process.cwd(), "public", "brand", "2026", "portraits");
const cache = new Map<PortraitGender, Buffer | null>();

/** الهيئةُ الافتراضية بجنس صاحبها — `null` إن لم يُحدَّد جنسُه أو لم تُضَف صورتُها بعد */
export function defaultPortrait(gender: string | null | undefined): Buffer | null {
  if (gender !== "male" && gender !== "female") return null;
  if (cache.has(gender)) return cache.get(gender) ?? null;
  const file = ["png", "jpg", "jpeg"].map((ext) => join(DIR, `default-${gender}.${ext}`)).find((f) => existsSync(f));
  const buf = file ? readFileSync(file) : null;
  cache.set(gender, buf);
  return buf;
}
