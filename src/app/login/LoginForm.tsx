"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { BRAND } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, pending] = useActionState(loginAction, { error: null });
  const t = useTranslations();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.login.email}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@tlaqiteam.site"
          className="min-h-11 rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.login.password}</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="min-h-11 rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
        />
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: BRAND.temptress }}
      >
        {pending ? t.login.submitting : t.login.submit}
      </button>
    </form>
  );
}
