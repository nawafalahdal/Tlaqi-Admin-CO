"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import {
  issueWarningAction,
  resetMemberCredentialsAction,
  markMemberExitedAction,
  issueCertificateAction,
} from "./actions";
import { Card, Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

type RosterMember = {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  warningsCount: number;
  certificateIssuedAt: string | null;
  certificateEligible: boolean;
};

export function MemberRoster({
  members,
  theme,
}: {
  members: RosterMember[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const t = useTranslations();

  if (members.length === 0) {
    return <Card className="p-8 text-center text-sm text-black/40">{t.memberRoster.empty}</Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {members.map((m) => (
        <Card key={m.id} className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {m.fullName} {m.jobTitle && <span className="text-black/40">— {m.jobTitle}</span>}
              </p>
              <p className="break-all text-xs text-black/50" dir="ltr">
                {m.email}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <WarningBadge count={m.warningsCount} />
              <Button
                theme={theme}
                variant="ghost"
                onClick={() => setOpenFor(openFor === `reset-${m.id}` ? null : `reset-${m.id}`)}
              >
                {t.memberRoster.resetCredentials}
              </Button>
              <Button
                theme={theme}
                variant="outline"
                onClick={() => setOpenFor(openFor === `warn-${m.id}` ? null : `warn-${m.id}`)}
              >
                {t.memberRoster.issueWarning}
              </Button>
              {m.certificateIssuedAt ? (
                <span className="rounded-full bg-[#E3F3E8] px-2.5 py-1 text-xs font-semibold text-[#1F6B3A]">
                  {t.memberRoster.certificateIssued}
                </span>
              ) : (
                <CertificateButton memberId={m.id} eligible={m.certificateEligible} theme={theme} />
              )}
              <Button
                theme={theme}
                variant="ghost"
                onClick={() => setOpenFor(openFor === `exit-${m.id}` ? null : `exit-${m.id}`)}
              >
                {t.memberRoster.endMembership}
              </Button>
            </div>
          </div>
          {openFor === `warn-${m.id}` && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <WarningForm memberId={m.id} theme={theme} onDone={() => setOpenFor(null)} />
            </div>
          )}
          {openFor === `reset-${m.id}` && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <ResetCredentialsForm
                memberId={m.id}
                currentEmail={m.email}
                theme={theme}
                onDone={() => setOpenFor(null)}
              />
            </div>
          )}
          {openFor === `exit-${m.id}` && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <ExitForm memberId={m.id} theme={theme} onDone={() => setOpenFor(null)} />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function CertificateButton({
  memberId,
  eligible,
  theme,
}: {
  memberId: string;
  eligible: boolean;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      <Button
        theme={theme}
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await issueCertificateAction(memberId);
            if (res.error) setError(res.error);
          })
        }
      >
        {pending
          ? t.actions.issuing
          : eligible
            ? t.actions.issueCertificate
            : t.actions.issueCertificateEarly}
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function ExitForm({
  memberId,
  theme,
  onDone,
}: {
  memberId: string;
  theme: ReturnType<typeof themeFromColor>;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(markMemberExitedAction, {
    error: null,
    success: false,
  });
  const t = useTranslations();

  if (state.success) {
    return <p className="text-sm text-green-700">{t.opsExtras.deactivated}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="memberId" value={memberId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.opsExtras.deactivateReason}</span>
        <textarea
          name="reason"
          required
          rows={2}
          placeholder={t.opsExtras.deactivateReasonPlaceholder}
          className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? t.actions.working : t.actions.confirmExit}
        </Button>
        <Button theme={theme} variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function WarningBadge({ count }: { count: number }) {
  const t = useTranslations();
  if (count === 0) return null;
  const color = count >= 3 ? "#9A2E1C" : count === 2 ? "#8A5A00" : "#30406B";
  const bg = count >= 3 ? "#FBE5E1" : count === 2 ? "#FFF1DE" : "#E8ECF7";
  return (
    <span
      className="rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: bg, color }}
    >
      {t.memberRoster.warningsLabel}: {count}/3
    </span>
  );
}

function WarningForm({
  memberId,
  theme,
  onDone,
}: {
  memberId: string;
  theme: ReturnType<typeof themeFromColor>;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(issueWarningAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations();

  if (state.success) {
    return <p className="text-sm text-green-700">{t.memberRoster.warningSent}</p>;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="memberId" value={memberId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.memberRoster.warningReasonLabel}</span>
        <textarea
          name="reason"
          required
          rows={2}
          placeholder={t.memberRoster.warningReasonPlaceholder}
          className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? t.memberRoster.sendingWarning : t.memberRoster.sendWarning}
        </Button>
        <Button theme={theme} variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function ResetCredentialsForm({
  memberId,
  currentEmail,
  theme,
  onDone,
}: {
  memberId: string;
  currentEmail: string;
  theme: ReturnType<typeof themeFromColor>;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(currentEmail);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);
  const t = useTranslations();

  if (revealed) {
    return (
      <div className="flex flex-col gap-3">
        <CredentialsReveal
          email={revealed.email}
          tempPassword={revealed.tempPassword}
          theme={theme}
          onClose={onDone}
        />
      </div>
    );
  }

  function handleReset() {
    setError(null);
    startTransition(async () => {
      const res = await resetMemberCredentialsAction(memberId, email);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRevealed({ email: res.email!, tempPassword: res.tempPassword! });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.memberRoster.emailEditable}</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
          type="email"
          className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      <p className="text-xs text-black/40">{t.memberRoster.resetHint}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button theme={theme} disabled={pending} onClick={handleReset}>
          {pending ? t.memberRoster.resetSubmitting : t.memberRoster.resetSubmit}
        </Button>
        <Button theme={theme} variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}
