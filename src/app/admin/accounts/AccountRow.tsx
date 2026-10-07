"use client";

import { useState, useTransition } from "react";
import { removeLeadershipUserAction, resetUserCredentialsAction } from "./actions";
import { Card, Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function AccountRow({
  account,
  theme,
  canRemove = false,
}: {
  account: { id: string; fullName: string; email: string; role: string; departmentName: string | null };
  theme: ReturnType<typeof themeFromColor>;
  /** المؤسس وحده يرى التنحية — وهي الطريق الوحيد لتفريغ منصب فردي */
  canRemove?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [email, setEmail] = useState(account.email);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);
  const t = useTranslations();

  const roleLabel =
    account.role === "executive"
      ? t.accounts.roleExecutive
      : account.role === "department_admin"
      ? t.accounts.roleDeptAdmin
      : account.role;

  function handleReset() {
    setError(null);
    startTransition(async () => {
      const res = await resetUserCredentialsAction(account.id, email);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRevealed({ email: res.email!, tempPassword: res.tempPassword! });
    });
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{account.fullName}</p>
          <p className="text-xs text-black/50" dir="ltr">
            {account.email}
          </p>
          <p className="text-xs text-black/40">
            {roleLabel}
            {account.departmentName ? ` — ${account.departmentName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button theme={theme} variant="outline" onClick={() => setOpen((o) => !o)}>
            {t.accounts.resetCredentials}
          </Button>
          {canRemove && (
            <button
              type="button"
              onClick={() => setRemoveOpen((o) => !o)}
              className="inline-flex min-h-11 items-center rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700"
            >
              {t.seats.remove}
            </button>
          )}
        </div>
      </div>

      {open && !revealed && (
        <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.accounts.emailEditable}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              type="email"
              className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            />
          </label>
          <p className="text-xs text-black/40">{t.accounts.resetHint}</p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button theme={theme} disabled={pending} onClick={handleReset}>
              {pending ? t.accounts.resetSubmitting : t.accounts.resetSubmit}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {removeOpen && (
        <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4">
          <p className="text-xs leading-relaxed text-black/50">{t.seats.removeHint}</p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.seats.removeReason}</span>
            <textarea
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              rows={2}
              className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !removeReason.trim()}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await removeLeadershipUserAction(account.id, removeReason);
                  if (res.error) setError(res.error);
                  else setRemoveOpen(false);
                });
              }}
              className="inline-flex min-h-11 items-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? t.actions.working : t.seats.removeConfirm}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setRemoveOpen(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {revealed && (
        <div className="mt-4 border-t border-black/5 pt-4">
          <CredentialsReveal
            email={revealed.email}
            tempPassword={revealed.tempPassword}
            theme={theme}
            onClose={() => {
              setRevealed(null);
              setOpen(false);
            }}
          />
        </div>
      )}
    </Card>
  );
}
