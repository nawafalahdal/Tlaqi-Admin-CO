import type { ProgressBreakdown } from "@/lib/progress";

/** عرضُ المقاييس — مفصولةً لا رقماً واحداً.
 *
 *  **والشريطانِ فوق بعضٍ عمداً:** المعتمَدُ بلونٍ صريح، والمُعلَنُ خلفه
 *  باهتاً. فيُرى الفرقُ بينهما بالعين: ما أُعلن وما تُحقِّق منه. ولو
 *  رُسم شريطٌ واحد لَقرأه القارئ إنجازاً وهو إعلان. */
export function ProgressBars({ b, label }: { b: ProgressBreakdown; label?: string }) {
  const verified = b.verifiedPercent;
  const reported = b.reportedPercent;

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-xs font-bold text-black/60">{label}</p>}

      {verified === null ? (
        <p className="text-xs text-black/45">لا التزاماتٍ مؤهَّلةً للقياس بعد</p>
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
            <span className="font-bold text-emerald-800">متحقَّقٌ منه {verified}٪</span>
            {reported !== null && reported !== verified && (
              <span className="text-amber-900">مُعلَنٌ {reported}٪ (منه ما ينتظر التحقّق)</span>
            )}
            <span className="text-black/45">
              {b.verifiedWeight} من {b.eligibleWeight} وحدةِ وزن · {b.eligibleTasks} التزاماً مؤهَّلاً
            </span>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {b.pendingReview > 0 && <Chip tone="amber">{b.pendingReview} بانتظار التحقّق</Chip>}
        {b.overdue > 0 && <Chip tone="red">{b.overdue} متأخّرة</Chip>}
        {b.blocked > 0 && <Chip tone="red">{b.blocked} معوَّقة</Chip>}
        {b.returned > 0 && <Chip tone="red">{b.returned} مردودة</Chip>}
        {b.incomplete > 0 && <Chip tone="red">{b.incomplete} غير مكتملة</Chip>}
        {b.carried > 0 && <Chip tone="amber">{b.carried} مُرحَّلة</Chip>}
        {b.inProgress > 0 && <Chip tone="plain">{b.inProgress} قيد التنفيذ</Chip>}
        {b.notStarted > 0 && <Chip tone="plain">{b.notStarted} لم تبدأ</Chip>}
        {b.waived + b.cancelled + b.deferred + b.superseded > 0 && (
          <Chip tone="plain">
            {b.waived + b.cancelled + b.deferred + b.superseded} مُسقَطةٌ بقرار — خارج الحساب
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
