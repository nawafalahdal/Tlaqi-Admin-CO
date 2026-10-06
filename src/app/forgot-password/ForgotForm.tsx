"use client";

import { useActionState } from "react";
import { requestResetAction } from "./actions";
import { useTranslations } from "@/i18n/LocaleProvider";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestResetAction, { sent: false });
  const t = useTranslations().forgot;

  if (state.sent) {
    return (
      <div className="rounded-2xl bg-green-50 p-5 text-center">
        <p className="text-sm font-bold text-green-900">{t.sentTitle}</p>
        <p className="mt-2 text-sm leading-relaxed text-green-900/80">{t.sentBody}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.emailLabel}</span>
        <input
          name="email"
          type="email"
          required
          dir="ltr"
          autoComplete="email"
          placeholder="name@tlaqiteam.site"
          className="min-h-11 rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-xl bg-[var(--brand-temptress)] px-4 text-sm font-semibold text-[var(--brand-beige)] disabled:opacity-50"
      >
        {pending ? t.sending : t.submit}
      </button>
    </form>
  );
}
