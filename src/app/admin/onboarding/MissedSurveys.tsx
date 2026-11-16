"use client";

import { useActionState } from "react";
import { enableMissedSurveysAction, type OnboardingActionState } from "./actions";
import { Card } from "@/components/ui";

/** **من فاته الاستبيانُ بسبب الخلل** (ق٥) — القائمةُ وعددُها قبل أي تغيير، ثم إجراءٌ صريحٌ واحد يُطلقه لهم */
export function MissedSurveys({ rows }: { rows: { id: string; name: string; scope: string; decidedAt: string }[] }) {
  const [state, action, pending] = useActionState<OnboardingActionState>(enableMissedSurveysAction, { error: null, ok: false });
  if (state.ok) {
    return <Card className="p-4 text-sm font-semibold text-emerald-800">أُطلق الاستبيانُ لهم ({rows.length}) — يظهر لكلٍّ منهم عند دخوله القادم.</Card>;
  }
  return (
    <Card className="flex flex-col gap-3 border-amber-200 bg-amber-50 p-4">
      <div>
        <p className="text-sm font-bold text-amber-950">فاتهم الاستبيانُ بسبب خللٍ تقني ({rows.length})</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
          أعضاءُ الإدارة العليا والقادةُ المعتمَدون بعد إطلاق الاستبيان، ولم يُطلَق لهم ولم يُجيبوا. لا يشمل الأعضاءَ القدامى
          الذين اكتملت رحلتُهم، ولا يُكرَّر لمن أجاب — ولا يتغيّر شيءٌ حتى تضغط الزرّ.
        </p>
      </div>
      <ul className="flex flex-col gap-1 text-sm text-amber-950">
        {rows.map((r) => (
          <li key={r.id}>
            {r.name} — <span className="text-xs text-amber-900/70">{r.scope} · اعتُمد {r.decidedAt}</span>
          </li>
        ))}
      </ul>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <form action={action}>
        <button type="submit" disabled={pending} className="btn-brand min-h-11 rounded-xl px-5 text-sm font-semibold">
          {pending ? "جارٍ..." : `فعّل الاستبيان لهم (${rows.length})`}
        </button>
      </form>
    </Card>
  );
}
