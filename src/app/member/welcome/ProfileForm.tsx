"use client";

import { useActionState } from "react";
import { saveCandidateProfileAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

export function ProfileForm({
  defaults,
  theme,
}: {
  defaults: { fullName: string; email: string; phone: string; jobTitle: string };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const dict = useTranslations();
  const t = dict.welcome;
  const [state, formAction, pending] = useActionState(saveCandidateProfileAction, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label={t.fullName} name="fullName" defaultValue={defaults.fullName} required />
      {/* البريد هو هوية الدخول نفسها، فتغييره هنا يفصل الحساب عن صاحبه */}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.email}</span>
        <input
          value={defaults.email}
          readOnly
          dir="ltr"
          className="min-h-11 cursor-not-allowed rounded-xl border border-black/10 bg-black/[0.04] px-3.5 text-sm text-black/50 outline-none"
        />
        <span className="text-xs text-black/40">{t.emailLocked}</span>
      </label>
      <Field label={t.phone} name="phone" defaultValue={defaults.phone} required dir="ltr" />
      <Field label={t.specialization} name="specialization" required hint={t.specializationHint} />
      <Field label={t.jobTitle} name="jobTitle" defaultValue={defaults.jobTitle} required hint={t.jobTitleHint} />
      <Field label={t.section} name="section" hint={t.sectionHint} />

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Button theme={theme} type="submit" disabled={pending}>
        {pending ? t.saving : t.submit}
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
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-black/70">
        {label}
        {!required && <span className="text-black/35"> — اختياري</span>}
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
