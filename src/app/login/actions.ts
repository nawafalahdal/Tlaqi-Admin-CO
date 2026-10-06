"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { lockoutMinutesLeft } from "@/lib/loginAttempts";

/** يسمح فقط بمسار داخلي نسبي (يبدأ بـ "/" وليس "//" أو "/\") لمنع Open Redirect
 *  عبر callbackUrl القادم من query string (قابل للتحكم الكامل من المهاجم) */
function safeRedirectPath(input: string): string {
  if (/^\/(?!\/|\\)/.test(input)) return input;
  return "/admin";
}

/** لا يتحقق من كلمة المرور إطلاقاً — فقط يقرأ إن كان البريد يخص حساباً إدارياً
 *  فعّل التحقق بخطوتين، لإظهار حقل الرمز في نموذج الدخول قبل المحاولة */
export async function checkTotpRequiredAction(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return false;
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { totpEnabled: true },
  });
  return user?.totpEnabled ?? false;
}

export async function loginAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const totp = String(formData.get("totp") ?? "");
  const callbackUrl = safeRedirectPath(String(formData.get("callbackUrl") ?? "/admin"));

  try {
    await signIn("credentials", { email, password, totp, redirectTo: callbackUrl });
    return { error: null };
  } catch (err) {
    if (err instanceof AuthError) {
      // القفل المؤقت يردّ كلمة المرور الصحيحة أيضاً. إخفاء ذلك خلف رسالة
      // "بيانات غير صحيحة" يجعل صاحب الحساب يظن أن كلمته خاطئة فيعيد
      // تعيينها بلا فائدة. العدّاد يُسجَّل للبريد غير المسجّل أيضاً، فإعلان
      // القفل لا يكشف من هو عضو في المنصة.
      const minutes = await lockoutMinutesLeft(email.toLowerCase().trim());
      if (minutes > 0) {
        return {
          error: `الحساب مقفل مؤقتاً بعد محاولات دخول متتالية. أعد المحاولة بعد ${minutes} دقيقة — كلمة المرور لم تتغيّر.`,
        };
      }
      return { error: "البريد الإلكتروني أو كلمة المرور أو رمز التحقق غير صحيح" };
    }
    throw err;
  }
}
