"use server";

import { consumeResetToken } from "@/lib/passwordReset";
import { safeErrorMessage } from "@/lib/safeError";

export async function resetPasswordAction(
  _prev: { error: string | null; done: boolean },
  formData: FormData
): Promise<{ error: string | null; done: boolean }> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل", done: false };
  }
  if (password !== confirm) {
    return { error: "كلمتا المرور غير متطابقتين", done: false };
  }

  try {
    const result = await consumeResetToken(token, password);
    if (!result.ok) {
      const reasons = {
        invalid: "هذا الرابط غير صالح",
        expired: "انتهت صلاحية الرابط — اطلب رابطاً جديداً",
        used: "هذا الرابط استُخدم مسبقاً — اطلب رابطاً جديداً",
      } as const;
      return { error: reasons[result.reason], done: false };
    }
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err), done: false };
  }
}
