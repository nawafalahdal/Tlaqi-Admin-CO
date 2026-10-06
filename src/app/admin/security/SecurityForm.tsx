"use client";

import { useState, useTransition, useActionState } from "react";
import { startTotpSetupAction, confirmTotpSetupAction, disableTotpAction } from "./actions";
import { BRAND } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function SecurityForm({ initialEnabled }: { initialEnabled: boolean }) {
  const dict = useTranslations();
  const t = dict.security;
  const a = dict.actions;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  const [confirmState, confirmAction, confirmPending] = useActionState(
    async (prev: { error: string | null; success: boolean }, formData: FormData) => {
      const result = await confirmTotpSetupAction(prev, formData);
      if (result.success) {
        setEnabled(true);
        setSetup(null);
      }
      return result;
    },
    { error: null, success: false }
  );

  const [disableState, disableAction, disablePending] = useActionState(
    async (prev: { error: string | null }, formData: FormData) => {
      const result = await disableTotpAction(prev, formData);
      if (!result.error) setEnabled(false);
      return result;
    },
    { error: null }
  );

  function beginSetup() {
    setStartError(null);
    startTransition(async () => {
      const result = await startTotpSetupAction();
      if (result.ok) setSetup({ qrDataUrl: result.qrDataUrl, secret: result.secret });
      else setStartError(result.error);
    });
  }

  if (enabled) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {dict.misc.twoFactorEnabled}
        </p>
        <form action={disableAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.currentPasswordToDisable}</span>
            <input
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="min-h-11 rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
            />
          </label>
          {disableState.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{disableState.error}</p>
          )}
          <button
            type="submit"
            disabled={disablePending}
            className="rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {disablePending ? a.disabling : a.disable2fa}
          </button>
        </form>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        {startError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{startError}</p>
        )}
        <button
          type="button"
          onClick={beginSetup}
          disabled={starting}
          className="rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: BRAND.temptress }}
        >
          {starting ? a.preparing : a.enable2fa}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-black/70">{t.scanHint}</p>
      <img src={setup.qrDataUrl} alt="QR" className="mx-auto h-48 w-48" />
      <p className="break-all rounded-lg bg-black/5 px-3 py-2 text-center text-xs" dir="ltr">
        {setup.secret}
      </p>
      <form action={confirmAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.codeLabel}</span>
          <input
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            className="rounded-xl border border-black/10 px-4 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
          />
        </label>
        {confirmState.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{confirmState.error}</p>
        )}
        <button
          type="submit"
          disabled={confirmPending}
          className="rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: BRAND.temptress }}
        >
          {confirmPending ? a.confirming : a.confirmEnable}
        </button>
      </form>
    </div>
  );
}
