"use client";

import { useActionState, useRef, useEffect } from "react";
import { raiseTicketAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

export function RaiseTicketForm({
  departments,
  theme,
}: {
  departments: { id: string; name: string }[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [state, formAction, pending] = useActionState(raiseTicketAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">الموضوع</span>
        <input
          name="subject"
          required
          placeholder="مثال: لم يصلني البانر الترحيبي"
          className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">القسم المعني</span>
        <select
          name="targetDepartmentId"
          required
          defaultValue=""
          className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30 bg-white"
        >
          <option value="" disabled>
            اختر القسم
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">التفاصيل</span>
        <textarea
          name="description"
          required
          rows={3}
          placeholder="اشرح المشكلة بوضوح"
          className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          تم رفع التذكرة — سيُرد عليك خلال يومين، وإلا تتصعّد تلقائياً
        </p>
      )}

      <div>
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? "جارِ الرفع..." : "رفع التذكرة"}
        </Button>
      </div>
    </form>
  );
}
