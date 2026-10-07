"use client";

import { useActionState, useRef, useEffect } from "react";
import { raiseTicketAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export type MemberTicketTarget = { value: string; label: string; group: string };

export function RaiseTicketForm({
  targets,
  theme,
}: {
  targets: MemberTicketTarget[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [state, formAction, pending] = useActionState(raiseTicketAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.member.subjectLabel}</span>
        <input
          name="subject"
          required
          placeholder={t.member.subjectPlaceholder}
          className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.member.departmentLabel}</span>
        <select
          name="target"
          required
          defaultValue=""
          className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30 bg-white"
        >
          <option value="" disabled>
            {t.member.departmentPlaceholder}
          </option>
          {Array.from(new Set(targets.map((o) => o.group))).map((g) => (
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
        <span className="font-medium text-black/70">{t.member.detailsLabel}</span>
        <textarea
          name="description"
          required
          rows={3}
          placeholder={t.member.detailsPlaceholder}
          className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{t.member.raiseSuccess}</p>
      )}

      <div>
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? t.member.raiseSubmitting : t.member.raiseSubmit}
        </Button>
      </div>
    </form>
  );
}
