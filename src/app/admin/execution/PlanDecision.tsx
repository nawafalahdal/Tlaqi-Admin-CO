"use client";

import { useState, useTransition } from "react";
import { decidePlanAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** قرارُ التنفيذي في خطةِ قسم: اعتمادٌ أو ردٌّ بسبب.
 *
 *  **والتحميلُ الزائد يُقَرّ صراحةً لا يُمرَّر صامتاً:** حين تتجاوز
 *  الخطةُ طاقةَ القسم يَظهر مربَّعُ إقرارٍ منفصل، ولا يُعتمَد بدونه.
 *  فالاعتمادُ على عِلمٍ بأن الأسبوع مُحمَّل — وهذا نصفُ معالجة التراكم. */
export function PlanDecision({
  planId,
  overloaded,
  theme,
}: {
  planId: string;
  overloaded: boolean;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [returning, setReturning] = useState(false);

  function run(decision: "approved" | "returned") {
    start(async () => {
      setError(null);
      const res = await decidePlanAction(planId, decision, note, ack);
      if (res.error) setError(res.error);
      else {
        setNote("");
        setReturning(false);
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-black/5 pt-3">
      {overloaded && (
        <label className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            أُقِرّ أن الأسبوع مُحمَّلٌ فوق طاقة القسم، وأعتمده على هذا العلم — ويُكتَب سببي في
            الملاحظة أدناه.
          </span>
        </label>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={returning ? "سببُ الردّ — إلزامي" : "ملاحظةُ القرار (إلزاميةٌ في الردّ)"}
        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
      />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          theme={theme}
          disabled={pending || (overloaded && !ack)}
          onClick={() => run("approved")}
        >
          اعتمِد الخطة
        </Button>
        <Button
          theme={theme}
          variant="outline"
          disabled={pending || !note.trim()}
          onClick={() => {
            setReturning(true);
            run("returned");
          }}
        >
          ردٌّ للتعديل
        </Button>
      </div>
    </div>
  );
}
