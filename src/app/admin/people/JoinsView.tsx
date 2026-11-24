import type { Session } from "next-auth";
import { CandidateApprovals } from "@/app/admin/approvals/CandidateApprovals";
import { CandidateResults } from "@/app/admin/approvals/CandidateResults";

/** **الانضمامُ والاعتماد** — كان قسماً في «الاعتمادات»، وصار تبويباً في «الأعضاء» (24 نوفمبر 2026).
 *  المؤسسُ والرئيسُ التنفيذيُّ يطّلعان على النتائج (ق١)، والرئيسُ يحسم أعضاءَ الإدارة العليا قائداً لها؛ وغيرُهما يرى ما
 *  يحسمه وحده (`CandidateApprovals` لا تعرض شيئاً لمن لا يحسم). والقرارُ نفسُه يُفحص في الخادم (`mayDecideCandidate`). */
export async function JoinsView({ session, empty }: { session: Session; empty: string }) {
  const r = session.user.role;
  const body =
    r === "super_admin" || r === "executive" ? (
      <>
        {r === "executive" && <CandidateApprovals session={session} />}
        <CandidateResults session={session} />
      </>
    ) : (
      <CandidateApprovals session={session} />
    );
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
      {body}
      {/* لمن لا يحسم شيئاً الآن — لا تبويبٌ فارغٌ صامت */}
      <p className="text-center text-xs text-black/40 [main:has(section)_&]:hidden">{empty}</p>
    </main>
  );
}
