"use server";
import { prisma } from "@/lib/prisma";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { surveyMemberIdFor, submitOnboardingSurvey } from "@/lib/onboardingSurvey";
import { reportMissingWelcomeAction } from "@/app/admin/welcome-cards/actions";
import { safeErrorMessage } from "@/lib/safeError";

export type SurveyFormState = {
  error: string | null;
  done: boolean;
  gender?: "male" | "female";
  /** قال «لم يصل»: رُفعت تذكرةٌ بالمسار القائم («لم تصلني») أو كانت مرفوعةً من قبل */
  banner?: "ticket" | "noted";
};

/** **إرسالُ استبيان الانضمام** — صاحبُ الجلسة وحده (لا معرّفَ من الواجهة)، والتحقّقُ والذرّيةُ في
 *  `submitOnboardingSurvey`. وإن قال إن البنر لم يصله رُفعت تذكرةُ «لم تصلني» لمسؤول التشغيل
 *  بالمسار القائم نفسه (لا تتكرّر، وتُغلَق آلياً حين تصله البطاقة). */
export async function submitOnboardingSurveyAction(_prev: SurveyFormState, formData: FormData): Promise<SurveyFormState> {
  const session = await auth();
  if (!session) return { error: "سجّل الدخول", done: false };
  // العضوُ نفسُه، أو سجلُّ عضوية القائد التوأم (البند ٦)
  const memberId = await surveyMemberIdFor(session);
  if (!memberId) return { error: "لا استبيانَ مطلوبٌ منك", done: false };
  try {
    const res = await submitOnboardingSurvey(memberId, {
      journeyRating: formData.get("journeyRating"),
      roleClarityRating: formData.get("roleClarityRating"),
      bannerReceived: formData.get("bannerReceived"),
      gender: formData.get("gender"),
    });
    if (!res.ok) {
      // أُجيب من قبل (تبويبٌ آخر أو نقرةٌ مزدوجة): لا خطأ — الرحلةُ مكتملة
      if (res.code === "already") return { error: null, done: true };
      return { error: res.reason, done: false };
    }
    let banner: SurveyFormState["banner"];
    // صيغةُ مخاطبة القائد في حسابه الإداري أيضاً — لا في سجلّ عضويته وحده
    if (session.user.role !== "member") {
      await prisma.user.update({ where: { id: session.user.id }, data: { gender: res.gender } });
    }
    if (!res.bannerReceived) {
      const t = session.user.role === "member" ? await reportMissingWelcomeAction().catch(() => ({ error: "x" })) : { error: "x" };
      banner = t.error === null ? "ticket" : "noted";
    }
    revalidatePath("/member");
    return { error: null, done: true, gender: res.gender, banner };
  } catch (err) {
    return { error: safeErrorMessage(err), done: false };
  }
}
