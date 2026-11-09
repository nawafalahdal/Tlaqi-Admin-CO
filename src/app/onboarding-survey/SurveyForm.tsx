"use client";

import { useActionState, useState } from "react";
import { submitOnboardingSurveyAction, type SurveyFormState } from "./actions";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";

const INITIAL: SurveyFormState = { error: null, done: false };

/** أربعةُ أسئلة — والأزرارُ أزرارُ اختيارٍ حقيقية (`radio`) تعمل باللمس ولوحة المفاتيح وقارئ الشاشة.
 *  والزرُّ لا يُفعَّل حتى تُجاب الأربعة؛ والخادمُ يتحقّق ثانيةً على كل حال. */
export function SurveyForm({ recent }: { recent: { gender: "male" | "female"; bannerReceived: boolean } | null }) {
  const t = useTranslations().onboarding;
  const [state, action, pending] = useActionState(submitOnboardingSurveyAction, INITIAL);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const complete = ["journeyRating", "roleClarityRating", "bannerReceived", "gender"].every((k) => answers[k]);
  const pick = (name: string) => (e: React.ChangeEvent<HTMLInputElement>) => setAnswers((a) => ({ ...a, [name]: e.target.value }));

  // الشكرُ من نتيجة الإرسال، أو — بعد تحديث الصفحة — من الإجابة المحفوظة للتوّ
  const done = state.done || !!recent;
  const gender = state.gender ?? recent?.gender;
  const banner = state.banner ?? (recent && !recent.bannerReceived ? "noted" : undefined);
  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 text-center" role="status">
        <h1 className="text-lg font-bold text-black/90">{gender === "female" ? t.thanksFemale : t.thanksMale}</h1>
        {banner && <p className="text-sm text-black/60">{banner === "ticket" ? t.bannerTicket : t.bannerNoted}</p>}
        {/* تنقّلٌ كامل لا داخلي: تخطيطُ مساحة العمل يُرسَم من جديد فيقرأ أن الاستبيان اكتمل */}
        <a href="/member" className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold">
          {t.continue}
        </a>
      </div>
    );
  }

  const scale = (name: "journeyRating" | "roleClarityRating", q: string, low: string, high: string) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold text-black/80">{q}</legend>
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input type="radio" name={name} value={n} required onChange={pick(name)} className="peer sr-only" />
            <span
              aria-label={fmt(t.ratingOf, n)}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-black/15 text-base font-semibold text-black/70 transition peer-checked:border-[var(--brand-temptress)] peer-checked:bg-[var(--brand-temptress)] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand-temptress)]/40"
            >
              {n}
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-between text-xs text-black/45">
        <span>1 — {low}</span>
        <span>5 — {high}</span>
      </div>
    </fieldset>
  );

  const choice = (name: "bannerReceived" | "gender", q: string, opts: { value: string; label: string }[], hint?: string) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold text-black/80">{q}</legend>
      {hint && <p className="-mt-1 text-xs text-black/45">{hint}</p>}
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => (
          <label key={o.value}>
            <input type="radio" name={name} value={o.value} required onChange={pick(name)} className="peer sr-only" />
            <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-black/15 text-sm font-semibold text-black/70 transition peer-checked:border-[var(--brand-temptress)] peer-checked:bg-[var(--brand-temptress)] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand-temptress)]/40">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form action={action} className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-lg font-bold text-black/90">{t.title}</h1>
        <p className="text-sm text-black/60">{t.intro}</p>
        <p className="mt-2 text-xs font-medium text-black/50">{t.required}</p>
      </div>
      {scale("journeyRating", t.q1, t.q1Low, t.q1High)}
      {scale("roleClarityRating", t.q2, t.q2Low, t.q2High)}
      {choice("bannerReceived", t.q3, [
        { value: "yes", label: t.yes },
        { value: "no", label: t.no },
      ])}
      {choice(
        "gender",
        t.q4,
        [
          { value: "male", label: t.male },
          { value: "female", label: t.female },
        ],
        t.q4Hint
      )}
      {state.error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !complete}
        className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? t.submitting : t.submit}
      </button>
      <p className="text-center text-xs text-black/45">{t.privacy}</p>
    </form>
  );
}
