import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./index";

export { getDictionary, LOCALE_COOKIE } from "./index";
export type { Locale, Dictionary } from "./index";

/** يُقرأ على الخادم فقط — next/headers غير متاح في مكوّنات العميل، ولهذا
 *  فُصِل عن src/i18n/index.ts الذي يستورده LocaleProvider في المتصفح. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return value === "en" ? "en" : "ar";
}
