"use client";

import { useState, useTransition } from "react";
import {
  removeLeadershipUserAction,
  resetUserCredentialsAction,
  permanentlyDeleteUserAction,
  sendWelcomeToUserAction,
} from "./actions";
import { Card, Button } from "@/components/ui";
import { AwardButton } from "@/components/AwardButton";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function AccountRow({
  account,
  theme,
  loginNotes,
  canAward,
  canRemove = false,
}: {
  account: { id: string; fullName: string; email: string; role: string; departmentName: string | null };
  theme: ReturnType<typeof themeFromColor>;
  /** المؤسس وحده يرى التنحية — وهي الطريق الوحيد لتفريغ منصب فردي */
  canRemove?: boolean;
  /** مشكلاتُ دخوله — للمؤسس وحده */
  loginNotes?: string[];
  /** يملك المُشاهد تكريمه؟ */
  canAward?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [email, setEmail] = useState(account.email);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);
  // الحذف النهائي: حالته منفصلة عن حالة التنحية، فلا تُفتح إحداهما بزرّ
  // الأخرى ولا يُستعمل سببُ هذه سبباً لتلك
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeEmail, setPurgeEmail] = useState("");
  const [purgeReason, setPurgeReason] = useState("");
  const [purgeForce, setPurgeForce] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  /** إيصالُ الحذف وما انتقل بالخلافة — يبقى معروضاً بعد اختفاء النموذج */
  const [purgeDone, setPurgeDone] = useState<string | null>(null);
  const [mailMsg, setMailMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
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
          {/* مشكلةُ الدخول تُقال نصّاً لا تُخمَّن من غياب الشخص */}
          {loginNotes && loginNotes.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {loginNotes.map((n) => (
                <li key={n} className="text-xs font-semibold text-amber-800">
                  ⚠ {n}
                </li>
              ))}
            </ul>
          )}
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
          {canRemove && (
            <>
              <Button
                theme={theme}
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setMailMsg(null);
                  startTransition(async () => {
                    const res = await sendWelcomeToUserAction(account.id);
                    setMailMsg(
                      res.error
                        ? { kind: "err", text: res.error }
                        : { kind: "ok", text: `وصلت البطاقة إلى ${res.to}` }
                    );
                  });
                }}
              >
                {t.accounts.sendWelcome}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setPurgeError(null);
                  setPurgeOpen((o) => !o);
                }}
                className="inline-flex min-h-11 items-center rounded-xl bg-red-50 px-4 text-sm font-semibold text-red-800 ring-1 ring-red-300"
              >
                {t.accounts.purge}
              </button>
            </>
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
              className="inline-flex min-h-11 items-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
            >
              {pending ? t.actions.working : t.seats.removeConfirm}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setRemoveOpen(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {mailMsg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            mailMsg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {mailMsg.text}
        </p>
      )}

      {/* الحذف النهائي — يُزيل الصفّ من القاعدة ويُحرّر البريد لدعوةٍ
          جديدة بنفس البيانات، ويبقى السجل في الإكسل بلا بريد. وهو غير
          التنحية: تلك تُوقف العمل وتُبقي الحساب. */}
      {canAward && !purgeDone && (
        <div className="mt-3">
          <AwardButton
            target={{ kind: "user", id: account.id }}
            personName={account.fullName}
            theme={theme}
          />
        </div>
      )}

      {purgeDone && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs leading-relaxed text-green-800">
          {purgeDone}
        </p>
      )}

      {purgeOpen && !purgeDone && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-red-50/70 p-4 ring-1 ring-red-200">
          <p className="text-xs font-bold text-red-900">{t.accounts.purgeTitle}</p>
          <p className="text-xs leading-relaxed text-red-900/80">{t.accounts.purgeHint}</p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.accounts.purgeConfirmEmail}</span>
            <input
              value={purgeEmail}
              onChange={(e) => setPurgeEmail(e.target.value)}
              dir="ltr"
              type="email"
              placeholder={account.email}
              className="min-h-11 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.accounts.purgeReason}</span>
            <textarea
              value={purgeReason}
              onChange={(e) => setPurgeReason(e.target.value)}
              rows={2}
              className="rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-red-900">
            <input
              type="checkbox"
              checked={purgeForce}
              onChange={(e) => setPurgeForce(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>{t.accounts.purgeForce}</span>
          </label>
          {purgeError && <p className="text-sm font-semibold text-red-700">{purgeError}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || purgeReason.trim().length < 5 || !purgeEmail.trim()}
              onClick={() => {
                setPurgeError(null);
                startTransition(async () => {
                  const res = await permanentlyDeleteUserAction(
                    account.id,
                    purgeEmail,
                    purgeReason,
                    purgeForce
                  );
                  if (res.error) {
                    setPurgeError(res.error);
                    return;
                  }
                  // ما انتقل إلى خَلَفِه يُقال صريحاً: الحذف لا يُسقط
                  // دعوةً أرسلها ولا طلباً ينتظره — يُورَّث
                  setPurgeDone(
                    res.handover && res.handover !== "لا عمل معلَّق باسمه"
                      ? `حُذف الحساب نهائياً. ${res.handover}.`
                      : "حُذف الحساب نهائياً — ولا عمل معلَّق كان باسمه."
                  );
                  setPurgeOpen(false);
                });
              }}
              className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
            >
              {pending ? t.actions.working : t.accounts.purgeConfirm}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setPurgeOpen(false)}>
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
