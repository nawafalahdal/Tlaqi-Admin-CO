"use client";

import { useActionState } from "react";
import { saveAdminProfileAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

export function AdminProfileForm({
  defaults,
  theme,
}: {
  defaults: { phone: string; jobTitle: string; specialization: string; section: string };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const dict = useTranslations();
  const t = dict.welcome;
  const tp = dict.adminProfile;
  const [state, formAction, pending] = useActionState(saveAdminProfileAction, {
    error: null,
    saved: false,
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label={t.phone} name="phone" defaultValue={defaults.phone} required dir="ltr" />
      <Field
        label={t.jobTitle}
        name="jobTitle"
        defaultValue={defaults.jobTitle}
        required
        hint={tp.jobTitleHint}
      />
      <Field
        label={t.specialization}
        name="specialization"
        defaultValue={defaults.specialization}
        required
        hint={t.specializationHint}
      />
      <Field label={t.section} name="section" defaultValue={defaults.section} hint={t.sectionHint} />

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.saved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{tp.saved}</p>
      )}

      <Button theme={theme} type="submit" disabled={pending}>
        {pending ? t.saving : tp.submit}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  hint,
  dir,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  dir?: "ltr" | "rtl";
}) {
  const dict = useTranslations();
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-black/70">
        {label}
        {!required && <span className="text-black/35"> — {dict.adminProfile.optional}</span>}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        dir={dir}
        maxLength={120}
        className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
      />
      {hint && <span className="text-xs text-black/40">{hint}</span>}
    </label>
  );
}
