import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ThemedLockup } from "@/components/Logo";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup, ControlDivider } from "@/components/ControlGroup";
import { getLocale, getDictionary } from "@/i18n/server";
import { surveyPending, recentSurveySubmission } from "@/lib/onboardingSurvey";
import { SurveyForm } from "./SurveyForm";

export const dynamic = "force-dynamic";

/** **استبيانُ الانضمام** — صفحةٌ منفردة بلا قائمة: من وجب عليه لا يصل غيرَها (`AppSidebar` يُعيده
 *  إليها)، ومن لا يجب عليه لا يراها. والفحصُ هنا من القاعدة لا من الجلسة. */
export default async function OnboardingSurveyPage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/onboarding-survey");
  if (session.user.role !== "member") redirect("/admin");
  // أُجيب للتوّ: تبقى الصفحةُ (والمكوّنُ نفسُه) فيظهر الشكر — وإلا فلا شأنَ له هنا
  const pending = await surveyPending(session.user.id);
  const recent = pending ? null : await recentSurveySubmission(session.user.id);
  if (!pending && !recent) redirect("/member");
  const t = getDictionary(await getLocale());

  return (
    <main className="auth-page flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">
        <div className="mb-4 flex justify-end">
          <ControlGroup color="var(--ink)" label={t.ui.displayTools}>
            <ThemeToggle />
            <ControlDivider />
            <LocaleToggle />
          </ControlGroup>
        </div>
        <div className="mb-6 flex justify-center">
          <ThemedLockup height={34} />
        </div>
        <div className="auth-card rounded-3xl bg-white p-6 shadow-xl sm:p-8">
          <SurveyForm recent={recent} />
        </div>
      </div>
    </main>
  );
}
