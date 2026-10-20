"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitTaskWorkAction } from "@/app/admin/execution/actions";
import { Button } from "@/components/ui";
import { MAX_PLAN_FILE_BYTES, ALLOWED_PLAN_TYPES } from "@/lib/planFormats";
import type { themeFromColor } from "@/lib/brand";

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
          setLocalError(`حجم الدليل ${(f.size / 1048576).toFixed(1)}MB — والحدّ ${MAX_MB}MB. ضَعه رابطاً.`);
          return;
        }
        setLocalError(null);
      }}
    >
      <input type="hidden" name="taskId" value={taskId} />
      <p className="text-xs leading-relaxed text-black/60">
        اكتب ما أُنجز وأرفِق دليلَه. <strong>والرفعُ ليس إنجازاً</strong>: تنتقل المهمّة إلى
        «بانتظار التحقّق» حتى يَطّلع المُراجِع على الدليل ويقرّر.
      </p>
      <textarea
        name="note"
        required
        rows={2}
        placeholder="ما الذي أُنجز؟ وكيف يُطابق معيار الإنجاز؟"
        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
      />

      <div className="flex flex-wrap gap-2">
        {(["link", "file"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              mode === m ? "text-on-brand" : "text-black/60"
            }`}
            style={
              mode === m
                ? { background: theme.fill }
                : { border: "1px solid color-mix(in oklab, var(--ink) 14%, transparent)" }
            }
          >
            {m === "link" ? "رابط الدليل" : "ملف مرفوع"}
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
            من <b>جوجل درايف</b> أو <b>مستندات جوجل</b> أو <b>كانفا</b>. وتأكّد أن
            المُراجِع يَملك صلاحيةَ فتحه — المنصةُ تَحفظ الرابطَ ولا تَملك الملف.
          </span>
        </div>
      ) : (
        <input
          type="file"
          name="evidence"
          accept={ACCEPT}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-black/[0.06] file:px-3 file:py-1.5 file:text-xs file:font-bold"
        />
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
          {pending ? "جارٍ الرفع..." : "ارفع التسليم للمراجعة"}
        </Button>
      </div>
    </form>
  );
}
