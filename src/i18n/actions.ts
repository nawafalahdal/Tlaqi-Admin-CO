"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./index";

export async function setLocaleAction(locale: Locale) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
}
