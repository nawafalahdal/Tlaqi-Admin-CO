"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { reopenOnboardingSurvey, resolveOnboardingFollowUp } from "@/lib/onboardingSurvey";
import { safeErrorMessage } from "@/lib/safeError";

export type OnboardingActionState = { error: string | null; ok: boolean };

async function actor() {
  const session = await auth();
  if (!session) return null;
  return { id: session.user.id, name: session.user.name ?? "—", role: session.user.role, email: session.user.email ?? null };
}

/** إغلاقُ متابعة إجابة — الصلاحيةُ والشرطُ في `resolveOnboardingFollowUp` (الخادم لا الزرّ) */
export async function resolveOnboardingFollowUpAction(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const a = await actor();
  if (!a) return { error: "سجّل الدخول أولاً", ok: false };
  try {
    const res = await resolveOnboardingFollowUp(a, String(formData.get("responseId") ?? ""), formData.get("note"));
    if (!res.ok) return { error: res.reason, ok: false };
    revalidatePath("/admin/onboarding", "layout");
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err), ok: false };
  }
}

/** إعادةُ فتح الاستبيان لعضو — بسببٍ مكتوب، والإجابةُ السابقة تبقى في السجل */
export async function reopenOnboardingSurveyAction(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const a = await actor();
  if (!a) return { error: "سجّل الدخول أولاً", ok: false };
  try {
    const res = await reopenOnboardingSurvey(a, String(formData.get("memberId") ?? ""), formData.get("reason"));
    if (!res.ok) return { error: res.reason, ok: false };
    revalidatePath("/admin/onboarding", "layout");
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err), ok: false };
  }
}

/** **إطلاقُ الاستبيان لمن فاتهم بسبب الخلل** (ق٥) — إجراءٌ صريحٌ بعد عرض القائمة وعددها، لمن يدير الاستبيان؛ يُسجَّل في
 *  سجلّ التدقيق بالعدد والأسماء. لا يمسّ من أكمل رحلته، ولا يكرّر استبياناً لمن أجاب. */
export async function enableMissedSurveysAction(_prev: OnboardingActionState): Promise<OnboardingActionState> {
  const a = await actor();
  if (!a) return { error: "سجّل الدخول أولاً", ok: false };
  try {
    const { stampMissedSurveys } = await import("@/lib/onboardingSurvey");
    const res = await stampMissedSurveys(a);
    if (!res.ok) return { error: res.reason, ok: false };
    revalidatePath("/admin/onboarding", "layout");
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err), ok: false };
  }
}
