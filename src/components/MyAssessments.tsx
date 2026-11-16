import type { Session } from "next-auth";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { myOpenAssessments, PURPOSE_LABEL } from "@/lib/assessments";

/** **اختبارٌ مطلوبٌ منك** — اختباراتُ العضو القائم التي لم يُسلّمها صاحبُها (`lib/assessments`)، في صفحته هو.
 *  لا تظهر لأحدٍ غيره، ولا تمسّ عضويتَه. */
export async function MyAssessments({ session }: { session: Session }) {
  const open = await myOpenAssessments(session);
  if (open.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      {open.map((a) => (
        <Card key={a.id} className="flex flex-col gap-2 border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-950">
              اختبارٌ مطلوبٌ منك — {a.purpose === "senior_position" ? `${PURPOSE_LABEL.senior_position}: ${a.seniorPosition?.titleAr ?? ""}` : PURPOSE_LABEL.evaluation}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/80">{a.reason}</p>
            <p className="mt-1 text-[11px] text-amber-900/60">
              كلّفك به {a.createdByName} — {formatDate(a.createdAt)}
            </p>
          </div>
          <a href={`/assessment/${a.id}`} className="btn-brand inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-5 text-sm font-semibold">
            ابدأ الاختبار
          </a>
        </Card>
      ))}
    </section>
  );
}
