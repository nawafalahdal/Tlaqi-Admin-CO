"use client";

import { useActionState } from "react";
import { resolveOnboardingFollowUpAction, reopenOnboardingSurveyAction, type OnboardingActionState } from "./actions";
import { useTranslations } from "@/i18n/LocaleProvider";

const INITIAL: OnboardingActionState = { error: null, ok: false };
const FIELD =
  "min-h-11 w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15";

/** إغلاقُ المتابعة — يظهر لما يحتاجها وحده (البنر لم يصل، تقييمٌ منخفض) */
export function ResolveFollowUp({ responseId }: { responseId: string }) {
  const t = useTranslations().onboarding;
  const [state, action, pending] = useActionState(resolveOnboardingFollowUpAction, INITIAL);
  if (state.ok) return <p className="text-sm text-black/60" role="status">{t.done}</p>;
  return (
    <form action={action} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-black/80">{t.resolveTitle}</h3>
      <p className="text-xs text-black/50">{t.resolveHint}</p>
      <input type="hidden" name="responseId" value={responseId} />
      <textarea name="note" required minLength={3} maxLength={500} rows={2} placeholder={t.resolveNote} aria-label={t.resolveNote} className={FIELD} />
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50">
        {pending ? t.saving : t.resolve}
      </button>
    </form>
  );
}

/** إعادةُ الفتح — بسببٍ مكتوب وتأكيد */
export function ReopenSurvey({ memberId }: { memberId: string }) {
  const t = useTranslations().onboarding;
  const [state, action, pending] = useActionState(reopenOnboardingSurveyAction, INITIAL);
  if (state.ok) return <p className="text-sm text-black/60" role="status">{t.done}</p>;
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(t.confirmReopen)) e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-semibold text-black/80">{t.reopenTitle}</h3>
      <p className="text-xs text-black/50">{t.reopenHint}</p>
      <input type="hidden" name="memberId" value={memberId} />
      <textarea name="reason" required minLength={5} maxLength={500} rows={2} placeholder={t.reopenReason} aria-label={t.reopenReason} className={FIELD} />
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/15 px-4 text-sm font-semibold text-black/70 disabled:opacity-50"
      >
        {pending ? t.saving : t.reopen}
      </button>
    </form>
  );
}
