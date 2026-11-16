"use client";

import { useState, useTransition } from "react";
import { cancelAssessmentAction as cancelAssessmentAction__server } from "@/app/assessment/actions";
import { guardAction } from "@/lib/actionGuard";
// فشلُ نقل الإجراء (نسخةٌ سابقة أو انقطاع) يُعاد خطأً في مكانه لا صفحةَ خطأ (`lib/actionGuard`)
const cancelAssessmentAction = guardAction(cancelAssessmentAction__server);

/** إلغاءُ تكليفٍ لم يُسلَّم — بسببٍ مكتوب، ويبقى سجلُّه */
export function CancelAssessment({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-red-700">
        إلغاء
      </button>
    );
  }
  return (
    <span className="flex flex-col gap-1.5">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإلغاء" className="min-h-9 rounded-lg border border-black/10 px-2 text-xs" />
      {error && <span className="text-[11px] text-red-700">{error}</span>}
      <span className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelAssessmentAction(id, reason).catch(() => ({ error: "تعذّر الاتصال — أعد تحميل الصفحة ثم حاول ثانيةً (لم يُحفظ شيء)" }));
              if (res.error) setError(res.error);
            })
          }
          className="text-xs font-bold text-red-700"
        >
          تأكيد الإلغاء
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-black/50">تراجع</button>
      </span>
    </span>
  );
}
