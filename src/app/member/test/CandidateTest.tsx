"use client";

import { useState } from "react";
import { submitCandidateTestAction } from "./actions";
import type { themeFromColor } from "@/lib/brand";
import { readableTextOn } from "@/lib/colors";
import { useTranslations } from "@/i18n/LocaleProvider";

type Theme = ReturnType<typeof themeFromColor>;
type Question = { id: string; prompt: string; options: string[] };

/** اختبار القبول داخل حساب المرشّح. لا رمز دعوة: هويته جلسته، فلا حاجة
 *  لتأكيد البريد كما كان في الرابط العام القديم. */
export function CandidateTest({
  roleLabel,
  questions,
  theme,
}: {
  roleLabel: string;
  questions: Question[];
  theme: Theme;
}) {
  const t = useTranslations();
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const question = questions[qIndex];
  const isLast = qIndex === questions.length - 1;
  const canNext = question ? answers[question.id] !== undefined : false;
  const buttonTextColor = readableTextOn(theme.accentDark);

  async function handleSubmit() {
    setPending(true);
    setError(null);
    const res = await submitCandidateTestAction(answers);
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? t.invite.genericError);
      return;
    }
    setResult({ score: res.score, passed: res.passed });
  }

  if (result) {
    return (
      <div className="rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <div
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full text-2xl"
          style={{
            background: result.passed ? "#E3F3E8" : theme.surface,
            color: result.passed ? "#1F6B3A" : theme.accentDark,
          }}
        >
          {result.passed ? "✓" : "!"}
        </div>
        <h1 className="mb-2 text-xl font-bold">
          {result.passed ? t.invite.passedTitle : t.invite.failedTitle}
        </h1>
        <p className="mb-1 text-sm text-black/60">
          {t.invite.scoreLabel}: {result.score}%
        </p>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-black/60">
          {result.passed ? t.invite.passedBody : t.invite.failedBody}
        </p>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="rounded-3xl bg-white p-6 text-center text-sm text-black/50 shadow-xl sm:p-8">
        {t.memberTest.noQuestions}
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-xs text-black/40">
        <span>
          {t.invite.questionLabel} {qIndex + 1} {t.invite.ofLabel} {questions.length}
        </span>
        <span>
          {t.invite.admissionTestPrefix} — {roleLabel}
        </span>
      </div>

      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${((qIndex + 1) / questions.length) * 100}%`,
            background: theme.accentDark,
          }}
        />
      </div>

      <h2 className="mb-5 text-base font-bold leading-relaxed sm:text-lg">{question.prompt}</h2>

      <div className="flex flex-col gap-2.5">
        {question.options.map((opt, i) => {
          const selected = answers[question.id] === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setAnswers((a) => ({ ...a, [question.id]: i }))}
              className="min-h-11 rounded-xl border px-4 py-3 text-start text-sm font-medium transition-colors"
              style={
                selected
                  ? { background: theme.surface, borderColor: theme.accentDark, color: theme.accentDark }
                  : { borderColor: "#00000014", color: "#1A1023" }
              }
            >
              {opt}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-7 flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={qIndex === 0}
          onClick={() => setQIndex((i) => Math.max(0, i - 1))}
          className="min-h-11 text-sm font-semibold text-black/40 disabled:opacity-0"
        >
          {t.invite.previous}
        </button>

        <button
          type="button"
          disabled={!canNext || pending}
          onClick={isLast ? handleSubmit : () => setQIndex((i) => Math.min(questions.length - 1, i + 1))}
          className="min-h-11 rounded-xl px-6 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: theme.accentDark, color: buttonTextColor }}
        >
          {isLast ? (pending ? t.invite.submitting : t.invite.submitAnswers) : t.invite.next}
        </button>
      </div>
    </div>
  );
}
