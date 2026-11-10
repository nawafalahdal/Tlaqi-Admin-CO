import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { surveyPending } from "@/lib/onboardingSurvey";

/** **حارسُ استبيان الانضمام على مستوى الصفحة.**
 *
 *  الحارسُ الأول في `AppSidebar` (التخطيط) — ويكفي عند الدخول وعند كلّ تحميلٍ كامل. لكنّ التخطيطَ
 *  لا يُعاد رسمُه في التنقّل الداخليّ بين صفحاته (من البوابة إلى «رفع تذكرة» مثلاً)، فمن أعادت الإدارةُ
 *  فتحَ استبيانه وهو يتصفّح كان يواصل حتى أوّل تحميلٍ كامل. والصفحةُ تُرسَم في كلّ تنقّل، فيُسأل هنا
 *  أيضاً — والحسابُ واحد (`surveyPending`)، فلا يختلف الحارسان. */
export async function requireOnboardingSurveyDone(session: Session | null): Promise<void> {
  if (session?.user.role === "member" && (await surveyPending(session.user.id))) redirect("/onboarding-survey");
}
