"use client";

import { useActionState, useEffect, useRef } from "react";
import { assignAssessmentAction as assignAssessmentAction__server, type AssignState } from "@/app/assessment/actions";
import { Button } from "@/components/ui";
import { themeFromColor, BRAND } from "@/lib/brand";

import { guardAction } from "@/lib/actionGuard";
// فشلُ نقل الإجراء (نسخةٌ سابقة أو انقطاع) يُعاد خطأً في مكانه لا صفحةَ خطأ (`lib/actionGuard`)
const assignAssessmentAction = guardAction(assignAssessmentAction__server);

/** تكليفُ عضوٍ قائمٍ باختبار — صاحبُه وبنكُه وسببُه (والخادمُ يفحص كلَّ ذلك ثانيةً) */
export function AssignForm({
  people,
  tracks,
}: {
  people: { value: string; label: string }[];
  tracks: { id: string; label: string; senior: boolean }[];
}) {
  const [state, action, pending] = useActionState<AssignState, FormData>(assignAssessmentAction, { error: null, success: false });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);
  const theme = themeFromColor(BRAND.temptress);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">صاحبُ الاختبار</span>
        <select name="owner" required defaultValue="" className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm">
          <option value="" disabled>اختر عضواً أو حساباً</option>
          {people.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">بنكُ الأسئلة</span>
        <select name="trackId" required defaultValue={tracks.find((t) => t.senior)?.id ?? ""} className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm">
          <option value="" disabled>اختر بنكاً</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">السببُ والغرض</span>
        <textarea name="reason" required minLength={5} rows={3} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm" placeholder="لماذا هذا الاختبار، وما الغرض منه؟" />
      </label>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">كُلِّف صاحبُه بالاختبار — يظهر له في صفحته.</p>}
      <div>
        <Button theme={theme} type="submit" disabled={pending}>{pending ? "جارٍ..." : "كلِّفه بالاختبار"}</Button>
      </div>
    </form>
  );
}
