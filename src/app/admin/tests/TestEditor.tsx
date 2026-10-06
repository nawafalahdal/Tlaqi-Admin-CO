"use client";

import { useActionState, useState, useTransition, useRef, useEffect } from "react";
import { addQuestionAction, updateQuestionAction, deleteQuestionAction } from "./actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

type Question = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
};

export function TestEditor({
  trackId,
  questions,
  theme,
  readOnly = false,
}: {
  trackId: string;
  questions: Question[];
  theme: ReturnType<typeof themeFromColor>;
  readOnly?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-4">
      {questions.length === 0 && !adding && (
        <Card className="p-8 text-center text-sm text-black/40">{t.testEditor.empty}</Card>
      )}

      {questions.map((q, i) => (
        <QuestionCard key={q.id} index={i} question={q} theme={theme} readOnly={readOnly} />
      ))}

      {!readOnly &&
        (adding ? (
          <Card className="p-5">
            <QuestionForm
              trackId={trackId}
              theme={theme}
              onDone={() => setAdding(false)}
            />
          </Card>
        ) : (
          <Button theme={theme} variant="outline" onClick={() => setAdding(true)}>
            {t.testEditor.addQuestion}
          </Button>
        ))}
    </div>
  );
}

function QuestionCard({
  index,
  question,
  theme,
  readOnly,
}: {
  index: number;
  question: Question;
  theme: ReturnType<typeof themeFromColor>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  if (editing) {
    return (
      <Card className="p-5">
        <QuestionForm trackId="" question={question} theme={theme} onDone={() => setEditing(false)} />
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm font-bold leading-relaxed">
          {index + 1}. {question.prompt}
        </p>
        {!readOnly && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-semibold"
              style={{ color: theme.accentDark }}
            >
              {t.testEditor.edit}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => deleteQuestionAction(question.id))}
              className="text-xs font-semibold text-red-600 disabled:opacity-50"
            >
              {t.testEditor.delete}
            </button>
          </div>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {question.options.map((opt, i) => (
          <div
            key={i}
            className="rounded-lg border px-3 py-2 text-xs"
            style={
              i === question.correctIndex
                ? { background: "#E3F3E8", borderColor: "#1F6B3A66", color: "#1F6B3A" }
                : { borderColor: "#00000014", color: "#1A1023" }
            }
          >
            {opt}
          </div>
        ))}
      </div>
    </Card>
  );
}

function QuestionForm({
  trackId,
  question,
  theme,
  onDone,
}: {
  trackId: string;
  question?: Question;
  theme: ReturnType<typeof themeFromColor>;
  onDone: () => void;
}) {
  const action = question ? updateQuestionAction : addQuestionAction;
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [correctIndex, setCorrectIndex] = useState(question?.correctIndex ?? 0);
  const submittedRef = useRef(false);
  const t = useTranslations();

  useEffect(() => {
    if (submittedRef.current && !pending && !state.error) onDone();
  }, [pending, state.error, onDone]);

  return (
    <form
      action={(fd) => {
        submittedRef.current = true;
        formAction(fd);
      }}
      className="flex flex-col gap-3"
    >
      {question ? (
        <input type="hidden" name="questionId" value={question.id} />
      ) : (
        <input type="hidden" name="trackId" value={trackId} />
      )}
      <input type="hidden" name="correctIndex" value={correctIndex} />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.testEditor.promptLabel}</span>
        <textarea
          name="prompt"
          required
          rows={2}
          defaultValue={question?.prompt}
          className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <label key={i} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={correctIndex === i}
              onChange={() => setCorrectIndex(i)}
              className="accent-current"
              style={{ color: theme.accentDark }}
            />
            <input
              name={`option${i}`}
              required
              defaultValue={question?.options[i]}
              placeholder={`${t.testEditor.optionPlaceholder} ${i + 1}`}
              className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-black/40">{t.testEditor.correctHint}</p>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}

      <div className="flex gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? t.testEditor.saving : t.testEditor.save}
        </Button>
        <Button theme={theme} variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
