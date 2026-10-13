"use client";

import { useState, useTransition } from "react";
import { permanentlyDeleteUserAction } from "./actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

/** حسابٌ مُنحّى — سجلٌّ يُقرأ، وللمؤسس أن يمحوه نهائياً.
 *
 *  كان القسم يُعرض سجلاً بلا طريق: الحساب مُنحّى، لا يَقبل دخولاً، لكن
 *  بريدَه ما يزال محجوزاً في القاعدة — فلا يُدعى صاحبه من جديد بنفس
 *  بريده، ولا يملك المؤسس من الواجهة ما يُحرّره به.
 *
 *  وهو مُنحّى أصلاً، فلا حاجة لإقرار «الحساب نشط»: الخطوة التي كان
 *  الإقرار يختصرها قد وقعت. ويبقى تأكيد البريد والسبب — فالمحو لا يقع
 *  بنقرةٍ في المكان الخطأ. */
export function RemovedAccountRow({
  account,
  theme,
  canPurge,
}: {
  account: {
    id: string;
    fullName: string;
    email: string;
    departmentName: string | null;
    removalReason: string | null;
  };
  theme: ReturnType<typeof themeFromColor>;
  /** المؤسس وحده — والتصريح يُفرض في الخادم أيضاً */
  canPurge: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{account.fullName}</p>
          <p className="break-all text-xs text-black/50" dir="ltr">
            {account.email}
          </p>
          <p className="mt-1 text-xs text-black/40">
            {account.departmentName ? `${account.departmentName} — ` : ""}
            {account.removalReason}
          </p>
        </div>
        {canPurge && !done && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setOpen((o) => !o);
            }}
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-red-50 px-4 text-sm font-semibold text-red-800 ring-1 ring-red-300"
          >
            {t.accounts.purge}
          </button>
        )}
      </div>

      {done && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs leading-relaxed text-green-800">
          {done}
        </p>
      )}

      {open && !done && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-red-50/70 p-4 ring-1 ring-red-200">
          <p className="text-xs font-bold text-red-900">{t.accounts.purgeTitle}</p>
          <p className="text-xs leading-relaxed text-red-900/80">{t.accounts.purgeHint}</p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.accounts.purgeConfirmEmail}</span>
            <input
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              dir="ltr"
              type="email"
              placeholder={account.email}
              className="min-h-11 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.accounts.purgeReason}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </label>
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length < 5 || !confirmEmail.trim()}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  // `force` لا يلزم: الحساب مُنحّى، والشرط الذي يختصره محقَّق
                  const res = await permanentlyDeleteUserAction(
                    account.id,
                    confirmEmail,
                    reason,
                    false
                  );
                  if (res.error) {
                    setError(res.error);
                    return;
                  }
                  // ولا يُقال «تحرّر البريد» إلا إن تحرّر فعلاً
                  setDone(
                    res.emailFreed
                      ? t.accounts.purgeDoneFreed
                      : `${t.accounts.purgeDoneHeld} ${res.heldBy ?? ""}`.trim()
                  );
                  setOpen(false);
                });
              }}
              className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? t.actions.working : t.accounts.purgeConfirm}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
