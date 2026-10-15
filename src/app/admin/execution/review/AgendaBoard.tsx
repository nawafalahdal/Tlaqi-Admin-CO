"use client";

import { useState, useTransition } from "react";
import { markStageAction, markMeetingHeldAction, addDecisionAction } from "../actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import type { AgendaStageKey } from "@/lib/reviewMeeting";

/** أجندةُ المراجعة: مراحلُها تُعلَّم بالضغط، وتبقى غيرُ المُعلَّمة ظاهرة.
 *
 *  **ولا مرحلةَ تُعلَّم بمرور الوقت:** الاجتماعُ قد يُعقَد ولا تُراجَع
 *  التبعيّات، فيُقرأ في السجل أن المرحلة لم تُقضَ. وهذا هو الفرقُ بين
 *  «اجتماعٍ وقع» و«مراجعةٍ تمّت». */
export function AgendaBoard({
  periodId,
  stages,
  unresolved,
  meetingHeld,
  decisions,
  theme,
}: {
  periodId: string;
  stages: { key: string; label: string; done: boolean }[];
  unresolved: number;
  meetingHeld: boolean;
  decisions: { id: string; text: string; dueAt: string | null; createdByName: string }[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");

  const doneCount = stages.filter((s) => s.done).length;

  function run(fn: () => Promise<{ error: string | null }>) {
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else setDecision("");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">
          أجندةُ المراجعة — {doneCount} من {stages.length}
        </h2>
        {unresolved > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
            {unresolved} بنداً ينتظر قراراً
          </span>
        )}
      </div>

      <ol className="flex flex-col gap-1.5">
        {stages.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => markStageAction(periodId, s.key as AgendaStageKey, !s.done))}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-xs transition-opacity hover:opacity-80 ${
                s.done ? "bg-emerald-50" : "bg-black/[0.03]"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                  s.done ? "bg-emerald-500 text-white" : "border border-black/20 text-black/40"
                }`}
                aria-hidden
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span className={s.done ? "font-semibold text-emerald-900" : "text-black/70"}>
                {s.label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {!meetingHeld && (
        <div className="flex flex-col gap-2 border-t border-black/5 pt-3">
          <p className="text-xs leading-relaxed text-black/50">
            ومرورُ موعد الاجتماع لا يَعقده: يبقى مستحقّاً ظاهراً حتى تُعلِن انعقادَه.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="محضرٌ مختصر (اختياري)"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div>
            <Button
              theme={theme}
              disabled={pending}
              onClick={() => run(() => markMeetingHeldAction(periodId, notes))}
            >
              أعلِن انعقادَ الاجتماع
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-black/5 pt-3">
        <h3 className="text-xs font-bold text-black/70">قراراتُ الاجتماع ({decisions.length})</h3>
        <p className="text-xs leading-relaxed text-black/50">
          والقرارُ هنا يُسجَّل ويُتابَع — <strong>ولا يُغيّر بنفسه التزاماً معتمَداً</strong>:
          تمديدُ موعدٍ أو نقلُ مسؤوليةٍ يمرّ من بابه على المهمّة نفسها.
        </p>
        {decisions.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {decisions.map((d) => (
              <li key={d.id} className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs">
                <p className="text-black/75">{d.text}</p>
                <p className="mt-0.5 text-[11px] text-black/40">
                  {d.createdByName}
                  {d.dueAt ? ` · الموعد ${d.dueAt.slice(0, 10)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          rows={2}
          placeholder="نصُّ القرار"
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
        />
        <div>
          <Button
            theme={theme}
            variant="outline"
            disabled={pending || !decision.trim()}
            onClick={() => run(() => addDecisionAction(periodId, decision))}
          >
            سجِّل القرار
          </Button>
        </div>
      </div>
    </div>
  );
}
