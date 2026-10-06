import { ar } from "./dictionaries/ar";
import { en } from "./dictionaries/en";
import type { Dictionary } from "./dictionaries/ar";

export type Locale = "ar" | "en";

export const LOCALE_COOKIE = "locale";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary };
