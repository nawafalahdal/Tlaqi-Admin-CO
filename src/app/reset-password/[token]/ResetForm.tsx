"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction } from "./actions";
import { useTranslations } from "@/i18n/LocaleProvider";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, {
    error: null,
    done: false,
  });
  const t = useTranslations().reset;

  if (state.done) {
    return (
      <div className="text-center">
        <div className="rounded-2xl bg-green-50 p-5">
          <p className="text-sm font-bold text-green-900">{t.doneTitle}</p>
          <p className="mt-2 text-sm leading-relaxed text-green-900/80">{t.doneBody}</p>
        </div>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--brand-temptress)] px-4 text-sm font-semibold text-[var(--brand-beige)]"
        >
          {t.goToLogin}
        </Link>
      </div>
    );
  }

  const field =
    "min-h-11 rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.newPassword}</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.confirmPassword}</span>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={field} />
      </label>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-xl bg-[var(--brand-temptress)] px-4 text-sm font-semibold text-[var(--brand-beige)] disabled:opacity-50"
      >
        {pending ? t.saving : t.submit}
      </button>
    </form>
  );
}
