import type { ProgressBreakdown } from "@/lib/progress";
import { getLocale, getDictionary } from "@/i18n/server";

/** عرضُ المقاييس — مفصولةً لا رقماً واحداً.
 *
 *  **والشريطانِ فوق بعضٍ عمداً:** المعتمَدُ بلونٍ صريح، والمُعلَنُ خلفه
 *  باهتاً. فيُرى الفرقُ بينهما بالعين: ما أُعلن وما تُحقِّق منه. ولو
 *  رُسم شريطٌ واحد لَقرأه القارئ إنجازاً وهو إعلان. */
export async function ProgressBars({ b, label }: { b: ProgressBreakdown; label?: string }) {
  const L = getDictionary(await getLocale()).ui.progress;
  const verified = b.verifiedPercent;
  const reported = b.reportedPercent;

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-xs font-bold text-black/60">{label}</p>}

      {verified === null ? (
        <p className="text-xs text-black/45">{L.none}</p>
      ) : (
        <>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-black/[0.07]">
            {/* المُعلَنُ خلفاً باهتاً */}
            <div
              className="absolute inset-y-0 start-0 bg-amber-300/70"
              style={{ width: `${reported ?? 0}%` }}
              aria-hidden
            />
            {/* والمعتمَدُ أمامه صريحاً */}
            <div
              className="absolute inset-y-0 start-0 bg-emerald-500"
              style={{ width: `${verified}%` }}
              aria-hidden
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="font-bold text-emerald-800">{L.verified.replace("{n}", String(verified))}</span>
            {reported !== null && reported !== verified && (
              <span className="text-amber-900">{L.reported.replace("{n}", String(reported))}</span>
            )}
            <span className="text-black/45">
              {L.weights.replace("{v}", String(b.verifiedWeight)).replace("{e}", String(b.eligibleWeight)).replace("{n}", String(b.eligibleTasks))}
            </span>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {b.pendingReview > 0 && <Chip tone="amber">{L.pendingReview.replace("{n}", String(b.pendingReview))}</Chip>}
        {b.overdue > 0 && <Chip tone="red">{L.overdue.replace("{n}", String(b.overdue))}</Chip>}
        {b.blocked > 0 && <Chip tone="red">{L.blocked.replace("{n}", String(b.blocked))}</Chip>}
        {b.returned > 0 && <Chip tone="red">{L.returned.replace("{n}", String(b.returned))}</Chip>}
        {b.incomplete > 0 && <Chip tone="red">{L.incomplete.replace("{n}", String(b.incomplete))}</Chip>}
        {b.carried > 0 && <Chip tone="amber">{L.carried.replace("{n}", String(b.carried))}</Chip>}
        {b.inProgress > 0 && <Chip tone="plain">{L.inProgress.replace("{n}", String(b.inProgress))}</Chip>}
        {b.notStarted > 0 && <Chip tone="plain">{L.notStarted.replace("{n}", String(b.notStarted))}</Chip>}
        {b.waived + b.cancelled + b.deferred + b.superseded > 0 && (
          <Chip tone="plain">
            {L.dropped.replace("{n}", String(b.waived + b.cancelled + b.deferred + b.superseded))}
          </Chip>
        )}
      </div>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "red" | "amber" | "plain" }) {
  const cls =
    tone === "red"
      ? "bg-red-50 text-red-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-900"
        : "bg-black/[0.05] text-black/60";
  return <span className={`rounded-full px-2 py-0.5 font-semibold ${cls}`}>{children}</span>;
}
