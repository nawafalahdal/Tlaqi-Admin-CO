"use client";

import { useState, useTransition } from "react";
import { movePlanDocAction, removePlanDocAction, renamePlanDocAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
/** أدواتُ مادةٍ واحدة: ترتيبٌ وتسميةٌ وحذف — لمن يملك المركز.
 *
 *  **والحذفُ يُؤكَّد ولا يقع بضغطة:** الوثيقةُ مرفوعةٌ لا مُشارٌ إليها،
 *  فحذفُها يُذهب الملفَّ نفسَه لا سطراً يُعاد كتابته. فالزرُّ يتحوّل
 *  سؤالاً، والسؤالُ يُسمّي ما سيزول.
 *
 *  والسهمانِ يُعطَّلان عند الطرفَين بدل أن يُضغطا فيُرَدّ «هي الأولى
 *  بالفعل»: الواجهةُ تعرف موضعها، فلا تُخفي ما تعرفه. */
export function PlanDocManager({
  docId,
  title,
  note,
  isFirst,
  isLast,
  theme,
}: {
  docId: string;
  title: string;
  note: string | null;
  isFirst: boolean;
  isLast: boolean;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const L = useTranslations().rPlansManager;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftNote, setDraftNote] = useState(note ?? "");

  function run(fn: () => Promise<{ error: string | null }>) {
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setConfirming(false);
        setEditing(false);
      }
    });
  }

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      {editing ? (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{L.title}</span>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={120}
              className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{L.description}</span>
            <input
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              maxLength={160}
              className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || draftTitle.trim().length === 0}
              onClick={() => run(() => renamePlanDocAction(docId, draftTitle, draftNote))}
            >
              {pending ? L.saving : L.save}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setEditing(false)}>{L.cancel}</Button>
          </div>
        </div>
      ) : confirming ? (
        <div className="flex flex-col gap-2.5">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            {fmt(L.willBePermanentlyRemoved, title)}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending}
              onClick={() => run(() => removePlanDocAction(docId))}
            >
              {pending ? L.deleting : L.deleteItPermanently}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setConfirming(false)}>{L.back}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || isFirst}
            onClick={() => run(() => movePlanDocAction(docId, "up"))}
            aria-label={L.moveItUpIn}
            title={L.moveUp}
            className="min-h-9 rounded-lg border border-black/10 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={pending || isLast}
            onClick={() => run(() => movePlanDocAction(docId, "down"))}
            aria-label={L.moveItDownIn}
            title={L.moveDown}
            className="min-h-9 rounded-lg border border-black/10 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↓
          </button>
          <Button theme={theme} variant="outline" onClick={() => setEditing(true)}>{L.editTheTitle}</Button>
          <Button theme={theme} variant="ghost" onClick={() => setConfirming(true)}>{L.deleteIt}</Button>
        </div>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
