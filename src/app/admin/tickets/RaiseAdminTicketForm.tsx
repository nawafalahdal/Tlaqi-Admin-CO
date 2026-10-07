"use client";

import { useActionState, useState } from "react";
import { raiseAdminTicketAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

export type TicketTargetOption = { value: string; label: string; group: string };

/** نموذج رفع تذكرة لأي حساب إداري.
 *
 *  الوجهة قائمة واحدة مجمّعة (أقسام / أشخاص) لا حقلين منفصلين: اختيار
 *  وجهتين معاً خطأ منطقي، وأسهل طريقة لمنعه ألا يُتاح أصلاً. */
export function RaiseAdminTicketForm({
  targets,
  theme,
}: {
  targets: TicketTargetOption[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const dict = useTranslations();
  const t = dict.ticketsPage;
  const [state, formAction, pending] = useActionState(raiseAdminTicketAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [handledSuccess, setHandledSuccess] = useState(false);

  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) setOpen(false);
  }

  if (!open) {
    return (
      <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
        {t.raiseTitle}
      </Button>
    );
  }

  const groups = Array.from(new Set(targets.map((o) => o.group)));

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.targetLabel}</span>
        <select
          name="target"
          required
          defaultValue=""
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
        >
          <option value="" disabled>
            {t.targetPlaceholder}
          </option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {targets
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.subjectLabel}</span>
        <input
          name="subject"
          required
          maxLength={120}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.detailsLabel}</span>
        <textarea
          name="description"
          required
          rows={4}
          className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <p className="text-xs leading-relaxed text-black/40">{t.slaHint}</p>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? t.raising : t.raiseSubmit}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </form>
  );
}
