"use server";

import { requestPasswordReset } from "@/lib/passwordReset";
import { isLockedOut, recordFailedAttempt, resetRequestKey } from "@/lib/loginAttempts";

/** الرد واحد دائماً سواء وُجد البريد أم لا — كشفُه يحوّل الصفحة إلى أداة
 *  لحصر عناوين أعضاء المنصة.
 *
 *  والحدّ هنا على مفتاح مستقل (reset:) لا على عدّاد الدخول: الإغراق
 *  برسائل الاستعادة ممنوع، لكن طلب الاستعادة نفسه — وهو فعل مَن نسي
 *  كلمته — يجب ألا يُقرَّب صاحبه خطوة من قفل الدخول. */
export async function requestResetAction(
  _prev: { sent: boolean },
  formData: FormData
): Promise<{ sent: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { sent: true };

  const key = resetRequestKey(email);
  if (await isLockedOut(key)) return { sent: true };
  await recordFailedAttempt(key);

  try {
    await requestPasswordReset(email);
  } catch (err) {
    console.error("[forgot-password]", err);
  }
  return { sent: true };
}
