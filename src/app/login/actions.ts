"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";

/** يسمح فقط بمسار داخلي نسبي (يبدأ بـ "/" وليس "//" أو "/\") لمنع Open Redirect
 *  عبر callbackUrl القادم من query string (قابل للتحكم الكامل من المهاجم) */
function safeRedirectPath(input: string): string {
  if (/^\/(?!\/|\\)/.test(input)) return input;
  return "/admin";
}

export async function loginAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeRedirectPath(String(formData.get("callbackUrl") ?? "/admin"));

  try {
    await signIn("credentials", { email, password, redirectTo: callbackUrl });
    return { error: null };
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
    }
    throw err;
  }
}
