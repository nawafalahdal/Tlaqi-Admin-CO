"use server";

import { consumeResetToken } from "@/lib/passwordReset";
import { safeErrorMessage } from "@/lib/safeError";
import { passwordProblem } from "@/lib/passwordPolicy";

import { getLocale, getDictionary } from "@/i18n/server";
export async function resetPasswordAction(
  _prev: { error: string | null; done: boolean },
  formData: FormData
): Promise<{ error: string | null; done: boolean }> {
  const L = getDictionary(await getLocale()).rResetActions;
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const weak = passwordProblem(password);
  if (weak) return { error: weak, done: false };
  if (password !== confirm) {
    return { error: L.thePasswordsDoNot, done: false };
  }

  try {
    const result = await consumeResetToken(token, password);
    if (!result.ok) {
      const reasons = {
        invalid: L.thisLinkIsInvalid,
        expired: L.theLinkHasExpired,
        used: L.thisLinkWasAlready,
      } as const;
      return { error: reasons[result.reason], done: false };
    }
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err), done: false };
  }
}
