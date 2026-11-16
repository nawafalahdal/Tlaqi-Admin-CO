import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { themeFromColor, BRAND } from "@/lib/brand";
import { ThemedLockup } from "@/components/Logo";
import { toCandidateQuestion } from "@/lib/testTracks";
import { assessmentForOwner, PURPOSE_LABEL } from "@/lib/assessments";
import { CandidateTest } from "@/app/member/test/CandidateTest";
import { submitAssessmentAction } from "../actions";

export const dynamic = "force-dynamic";

/** **اختبارُ العضو القائم** — لصاحبه وحده (عضواً كان أو حساباً إدارياً)، بواجهة اختبار القبول نفسها وبنوكها.
 *  ولا يمسّ تسليمُه عضويتَه ولا صلاحياته (`lib/assessments`). */
export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const { id } = await params;
  const a = await assessmentForOwner(session, id);
  if (!a) notFound();
  const home = session.user.role === "member" ? "/member" : "/admin/profile";
  if (a.status !== "assigned") redirect(home);

  const theme = themeFromColor(a.track.department?.colorHex ?? BRAND.temptress);
  const label = a.purpose === "senior_position" ? `${PURPOSE_LABEL.senior_position} — ${a.seniorPosition?.titleAr ?? ""}` : PURPOSE_LABEL.evaluation;
  return (
    <main className="auth-page flex min-h-screen flex-col items-center px-4 py-8">
      <div className="mb-6 flex w-full max-w-xl items-center justify-between gap-3">
        <ThemedLockup height={30} />
        <a href={home} className="text-sm font-semibold text-black/60">العودة</a>
      </div>
      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h1 className="text-lg font-bold sm:text-xl">{session.user.name} — اختبار {label}</h1>
          <p className="mt-1 text-sm leading-relaxed text-black/60">{a.reason}</p>
        </div>
        <CandidateTest
          roleLabel={label}
          questions={a.track.questions.map(toCandidateQuestion)}
          theme={theme}
          submit={submitAssessmentAction.bind(null, a.id)}
          resultBody={
            a.purpose === "senior_position"
              ? {
                  passed: "سُجّلت نتيجتك وأُحيلت إلى جهة الاعتماد المستقلة — يُفعَّل منصبُك بعد اعتمادها. وعضويتُك القائمة كما هي.",
                  failed: "سُجّلت نتيجتك وأُحيلت إلى جهة الاعتماد المستقلة. وعضويتُك القائمة وصلاحياتُك كما هي.",
                }
              : {
                  passed: "سُجّلت نتيجتك. هذا اختبارُ تقييمٍ واطّلاع — لا يغيّر عضويتك ولا صلاحياتك.",
                  failed: "سُجّلت نتيجتك. هذا اختبارُ تقييمٍ واطّلاع — لا يغيّر عضويتك ولا صلاحياتك.",
                }
          }
        />
      </div>
    </main>
  );
}
