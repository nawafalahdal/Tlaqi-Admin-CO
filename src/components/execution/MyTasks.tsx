"use client";

import { TaskCard, type TaskView, STATE_LABEL } from "./TaskCard";
import type { themeFromColor } from "@/lib/brand";

/** «ما عليّ» — التزاماتُ شخصٍ بمعاييرها ومواعيدها وأدلّتها.
 *
 *  **ويُقال له صريحاً ماذا يحدث إن لم تكتمل:** تُرحَّل إلى الأسبوع
 *  التالي بموعدها الأصلي ويُطلَب سببُها وخطةُ تصحيحها — لا تَختفي ولا
 *  تُعَدّ منجَزة. فالمحاسبةُ تُعلَن قبل وقوعها لا بعده. */
export function MyTasks({
  tasks,
  theme,
}: {
  tasks: TaskView[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  if (tasks.length === 0) return null;

  const open = tasks.filter(
    (t) => !["verified", "waived", "cancelled", "superseded", "deferred"].includes(t.execState)
  );
  const closed = tasks.filter((t) =>
    ["verified", "waived", "cancelled", "superseded", "deferred"].includes(t.execState)
  );

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-bold">التزاماتي ({open.length})</h2>
        <p className="mt-1 text-xs leading-relaxed text-black/50">
          لكلٍّ معيارُ إنجازٍ وموعدٌ ومُراجِع. وما لم يكتمل منها لا يَختفي بانتهاء الأسبوع ولا
          يُعَدّ منجَزاً: يُرحَّل بموعده الأصلي، ويُطلَب سببُه وخطةُ تصحيحه.
        </p>
      </div>

      {open.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          theme={theme}
          can={{ work: true, review: false, carryPlan: false }}
        />
      ))}

      {closed.length > 0 && (
        <details className="rounded-2xl border border-black/5 p-3.5">
          <summary className="cursor-pointer text-xs font-bold text-black/60">
            ما أُغلق ({closed.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {closed.map((t) => (
              <li key={t.id} className="text-xs text-black/55">
                {t.title} — {STATE_LABEL[t.execState] ?? t.execState}
                {t.verifiedByName ? ` (تحقّق منها ${t.verifiedByName})` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
