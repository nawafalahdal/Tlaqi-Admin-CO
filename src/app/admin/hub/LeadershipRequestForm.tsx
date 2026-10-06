"use client";

import { useActionState, useState } from "react";
import { createLeadershipRequestAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

type Dept = { id: string; name: string };

export function LeadershipRequestForm({
  departments,
  theme,
}: {
  departments: Dept[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const dict = useTranslations();
  const t = dict.hub;
  const [state, formAction, pending] = useActionState(createLeadershipRequestAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [handledSuccess, setHandledSuccess] = useState(false);

  // إغلاق النموذج بعد رفع ناجح — يُحسب أثناء الرسم بدل useEffect
  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) setOpen(false);
  }

  if (!open) {
    return (
      <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
        {t.raiseRequest}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.reqTypeLabel}</span>
          <select
            name="type"
            required
            defaultValue="dept_contact"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          >
            <option value="dept_contact">{dict.requestType.dept_contact}</option>
            <option value="custom_design">{dict.requestType.custom_design}</option>
            <option value="meeting">{dict.requestType.meeting}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.reqTargetLabel}</span>
          <select
            name="targetDepartmentId"
            required
            defaultValue=""
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          >
            <option value="" disabled>
              {t.deptPlaceholder}
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.reqDueLabel}</span>
          <input
            name="dueDays"
            type="number"
            min={1}
            max={30}
            defaultValue={3}
            required
            className="min-h-11 rounded-xl border border-black/10 px-3.5 text-sm outline-none focus:border-black/30"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.reqNoteLabel}</span>
        <textarea
          name="note"
          required
          rows={3}
          maxLength={1000}
          placeholder={t.reqNotePlaceholder}
          className="rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-black/30"
        />
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? t.submittingRequest : t.submitRequest}
        </Button>
        <Button type="button" theme={theme} variant="ghost" onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </form>
  );
}
