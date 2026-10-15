"use client";

import { useActionState, useRef, useEffect } from "react";
import { createGoalAction } from "../actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** نموذجُ الهدف — وحقولُه الإلزاميةُ ليست بيروقراطية.
 *
 *  «المسوّغ» و«معيار النجاح» إلزاميان لأن هدفاً بلا «لماذا» لا يُحاسَب
 *  على أثره، وهدفاً بلا معيارٍ يُقاس لا يُعرَف أتحقّق أم لا — فيبقى
 *  مفتوحاً إلى الأبد ويُناقَش في كل اجتماع. */
export function GoalForm({
  canApprove,
  leaders,
  theme,
}: {
  canApprove: boolean;
  leaders: { id: string; fullName: string; role: string }[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [state, formAction, pending] = useActionState(createGoalAction, {
    error: null,
    success: false,
  });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-black/50">
        {canApprove
          ? "يُنشأ معتمَداً — فأنت تملك اعتماده."
          : "يُرسَل مقترَحاً، ولا يصير التزاماً تنظيمياً إلا باعتماد الإدارة."}
      </p>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">عنوان الهدف</span>
        <input
          name="title"
          required
          maxLength={140}
          placeholder="مثال: مضاعفة أثر لقاءات تَـــلاقِ في الرياض"
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">الوصف</span>
        <textarea
          name="description"
          required
          rows={2}
          className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">المسوّغ — لماذا هذا الهدف؟</span>
          <textarea
            name="rationale"
            required
            rows={2}
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الأثر المتوقَّع (اختياري)</span>
          <textarea
            name="impact"
            rows={2}
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">معيارُ النجاح — كيف يُعرَف أنه تحقّق؟</span>
        <textarea
          name="successCriteria"
          required
          rows={2}
          placeholder="مثال: ٦ لقاءات بحضور ١٢٠ شخصاً، ورضا ٨٥٪ في الاستبانة"
          className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">البداية</span>
          <input
            name="startDate"
            type="date"
            required
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الموعد</span>
          <input
            name="dueDate"
            type="date"
            required
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">القيمة الحالية</span>
          <input
            name="baselineValue"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">القيمة المستهدَفة</span>
          <input
            name="targetValue"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الأولوية</span>
          <select
            name="priority"
            defaultValue="normal"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="critical">حرجة</option>
            <option value="high">عالية</option>
            <option value="normal">عادية</option>
            <option value="low">منخفضة</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">المسؤول التنفيذي</span>
          <select
            name="accountableUserId"
            defaultValue=""
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="">—</option>
            {leaders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">المالك</span>
          <select
            name="ownerUserId"
            defaultValue=""
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="">—</option>
            {leaders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.fullName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.success && state.message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>
      )}

      <div>
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ..." : canApprove ? "أنشئ الهدف" : "أرسِل الاقتراح"}
        </Button>
      </div>
    </form>
  );
}
