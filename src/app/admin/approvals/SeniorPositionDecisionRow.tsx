"use client";

import { useState, useTransition } from "react";
import { decideSeniorPositionAction as decideSeniorPositionAction__server } from "@/app/assessment/actions";
import { Card } from "@/components/ui";

import { guardAction } from "@/lib/actionGuard";
// فشلُ نقل الإجراء (نسخةٌ سابقة أو انقطاع) يُعاد خطأً في مكانه لا صفحةَ خطأ (`lib/actionGuard`)
const decideSeniorPositionAction = guardAction(decideSeniorPositionAction__server);

/** تفعيلُ منصب الإدارة العليا لصاحب حسابٍ قائم بعد اختباره — قرارُ جهة الاعتماد المستقلة (ق١ وق٢) */
export function SeniorPositionDecisionRow({
  item,
}: {
  item: { id: string; name: string; email: string; title: string; score: number | null; passed: boolean };
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      setError(null);
      const res = await decideSeniorPositionAction(item.id, decision, note).catch(() => ({
        error: "تعذّر الاتصال — أعد تحميل الصفحة ثم حاول ثانيةً (لم يُحفظ شيء)",
      }));
      if (res.error) setError(res.error);
      else setDone(decision === "approved" ? "فُعِّل المنصب" : "لم يُعتمد — انتهى التكليف");
    });
  if (done) return <Card className="p-4 text-sm font-semibold text-emerald-700">{done} — {item.name}</Card>;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{item.name}</p>
          <p className="text-xs text-black/50" dir="ltr">{item.email}</p>
          <p className="mt-1 text-xs text-black/60">منصبُ «{item.title}» في الإدارة العليا</p>
        </div>
        <p className={`text-sm font-bold ${item.passed ? "text-emerald-700" : "text-red-700"}`}>
          {item.passed ? "مجتاز" : "غير مجتاز"} — {item.score ?? "—"}%
        </p>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظةُ القرار (لازمةٌ عند عدم الاعتماد)" className="min-h-10 rounded-xl border border-black/10 px-3 text-sm" />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {item.passed && (
          <button type="button" disabled={pending} onClick={() => decide("approved")} className="btn-brand min-h-10 rounded-xl px-4 text-sm font-semibold">
            اعتماد وتفعيل المنصب
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => decide("rejected")} className="min-h-10 rounded-xl border border-black/15 px-4 text-sm font-semibold text-red-700">
          عدم الاعتماد
        </button>
      </div>
    </Card>
  );
}
