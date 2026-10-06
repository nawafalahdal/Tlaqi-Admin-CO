"use server";

import { requestPasswordReset } from "@/lib/passwordReset";
import { isLockedOut, recordFailedAttempt } from "@/lib/loginAttempts";

/** الرد واحد دائماً سواء وُجد البريد أم لا — كشفُه يحوّل الصفحة إلى أداة
 *  لحصر عناوين أعضاء المنصة. والقفل نفسه قفل محاولات الدخول، فلا تُستخدم
 *  الصفحة لإغراق أحد برسائل استعادة. */
export async function requestResetAction(
  _prev: { sent: boolean },
  formData: FormData
): Promise<{ sent: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { sent: true };

  if (await isLockedOut(email)) return { sent: true };
  await recordFailedAttempt(email);

  try {
    await requestPasswordReset(email);
  } catch (err) {
    console.error("[forgot-password]", err);
  }
  return { sent: true };
}
