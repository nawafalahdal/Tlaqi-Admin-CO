"use client";

import { useState, useTransition } from "react";
import { resetMemberCredentialsAction } from "../departments/[slug]/actions";
import { Card, Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function MemberAccountRow({
  member,
  theme,
  lapsed = false,
  canReset = true,
}: {
  member: { id: string; fullName: string; email: string; departmentName: string };
  theme: ReturnType<typeof themeFromColor>;
  /** حساب أسقطته مهلة الـ24 ساعة — نفس الإجراء يُحييه، فيختلف النص فقط */
  lapsed?: boolean;
  /** التعيين اليدوي صار شبكة أمان للفاوندر وحده بعد إتاحة الاستعادة الذاتية */
  canReset?: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(member.email);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);

  function handleReset() {
    setError(null);
    startTransition(async () => {
      const res = await resetMemberCredentialsAction(member.id, email);
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
          <p className="text-sm font-semibold">{member.fullName}</p>
          <p className="text-xs text-black/50" dir="ltr">
            {member.email}
          </p>
          <p className="text-xs text-black/40">
            {t.misc.memberIn} — {member.departmentName}
          </p>
          {lapsed && (
            <p className="mt-1 text-xs font-semibold text-red-700">{t.candidateWindow.lapsed}</p>
          )}
        </div>
        {canReset && (
          <Button theme={theme} variant="outline" onClick={() => setOpen((o) => !o)}>
            {lapsed ? t.candidateWindow.reissue : t.misc.loginTrouble}
          </Button>
        )}
      </div>

      {open && !revealed && (
        <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.opsExtras.emailEditable}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              type="email"
              className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            />
          </label>
          <p className="text-xs text-black/40">
            {t.misc.resetNotice}
          </p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button theme={theme} disabled={pending} onClick={handleReset}>
              {pending
                ? t.actions.working
                : lapsed
                  ? t.candidateWindow.reissue
                  : t.actions.resetPassword}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
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
