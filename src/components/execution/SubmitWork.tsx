"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitTaskWorkAction } from "@/app/admin/execution/actions";
import { Button } from "@/components/ui";
import { MAX_PLAN_FILE_BYTES, ALLOWED_PLAN_TYPES } from "@/lib/planFormats";
import type { themeFromColor } from "@/lib/brand";
import { FileField } from "../FileField";
import { useTranslations } from "@/i18n/LocaleProvider";

const ACCEPT = Object.keys(ALLOWED_PLAN_TYPES).join(",");
const MAX_MB = (MAX_PLAN_FILE_BYTES / 1048576).toFixed(0);

/** رفعُ تسليمٍ بدليله.
 *
 *  **والدليلُ إلزاميٌّ لأن التحقّق لا يقع على كلامٍ وحده:** رابطٌ أو
 *  ملف. والواجهةُ تقول صراحةً إن الرفعَ **لا يَعني الإنجاز** — فلا
 *  يَحسب صاحبُها أنه أنهى الأمر ثم يُفاجأ بأنها ما زالت عليه. */
export function SubmitWork({
  taskId,
  theme,
  onDone,
}: {
  taskId: string;
  theme: ReturnType<typeof themeFromColor>;
  onDone?: () => void;
}) {
  const L = useTranslations().submitWork;
  const [state, formAction, pending] = useActionState(submitTaskWorkAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [mode, setMode] = useState<"link" | "file">("link");

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      onDone?.();
    }
  }, [state.success, onDone]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3"
      onSubmit={(e) => {
        const f = formRef.current?.querySelector<HTMLInputElement>('input[name="evidence"]')?.files?.[0];
        if (f && f.size > MAX_PLAN_FILE_BYTES) {
          e.preventDefault();
          setLocalError(L.tooLarge.replace("{size}", (f.size / 1048576).toFixed(1)).replace("{max}", MAX_MB));
          return;
        }
        setLocalError(null);
      }}
    >
      <input type="hidden" name="taskId" value={taskId} />
      <p className="text-xs leading-relaxed text-black/60">
        {L.introA}
        <strong>{L.introStrong}</strong>
        {L.introB}
      </p>
      <textarea
        name="note"
        required
        rows={2}
        placeholder={L.notePlaceholder}
        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
      />

      <div className="flex flex-wrap gap-2">
        {(["link", "file"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              mode === m ? "" : "text-black/60"
            }`}
            style={
              mode === m
                ? { background: theme.fill, color: theme.onFill }
                : { border: "1px solid color-mix(in oklab, var(--ink) 14%, transparent)" }
            }
          >
            {m === "link" ? L.modeLink : L.modeFile}
          </button>
        ))}
      </div>

      {mode === "link" ? (
        <div className="flex flex-col gap-1.5">
          <input
            name="evidenceUrl"
            type="url"
            dir="ltr"
            placeholder="https://drive.google.com/…"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-black/30"
          />
          {/* المصادرُ تُقال قبل الرفض: من يَعرف المقبولَ لا يُجرّب المرفوض */}
          <span className="text-xs text-black/45">
            {L.sourcesFrom}
            <b>{L.drive}</b>
            {L.sep1}
            <b>{L.docs}</b>
            {L.sep2}
            <b>{L.canva}</b>
            {L.sourcesRest}
          </span>
        </div>
      ) : (
        <FileField name="evidence" accept={ACCEPT} />
      )}

      {(localError || state.error) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {localError ?? state.error}
        </p>
      )}
      {state.success && state.message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message}</p>
      )}

      <div>
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? L.sending : L.submit}
        </Button>
      </div>
    </form>
  );
}
