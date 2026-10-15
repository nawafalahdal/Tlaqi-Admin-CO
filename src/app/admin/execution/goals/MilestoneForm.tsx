"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { createMilestoneAction } from "../actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** محطّةٌ شهرية — بنتيجةٍ متوقَّعةٍ ومعيارِ قبول، لا بقسمةٍ على الأشهر */
export function MilestoneForm({
  goalId,
  leaders,
  theme,
}: {
  goalId: string;
  leaders: { id: string; fullName: string }[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [state, formAction, pending] = useActionState(createMilestoneAction, {
    error: null,
    success: false,
  });
  const ref = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  // الإعادةُ في الأثر، وإغلاقُ اللوحة في أثناء الرسم بمقارنةِ آخِر نجاح:
  // `setState` داخل الأثر يُشعل رسماً متتابعاً وفحصُ القواعد يَرفضه.
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);
  const [handled, setHandled] = useState(false);
  if (state.success !== handled) {
    setHandled(state.success);
    if (state.success) setOpen(false);
  }

  if (!open) {
    return (
      <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
        أضف محطّة
      </Button>
    );
  }

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3 rounded-xl bg-black/[0.03] p-3">
      <input type="hidden" name="goalId" value={goalId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">عنوان المحطّة</span>
          <input
            name="title"
            required
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">صاحبُها</span>
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
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">النتيجةُ المتوقَّعة — ماذا يُسلَّم؟</span>
        <textarea
          name="expectedResult"
          required
          rows={2}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">معيارُ القبول</span>
        <textarea
          name="acceptanceCriteria"
          required
          rows={2}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? "جارٍ..." : "أضف المحطّة"}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
