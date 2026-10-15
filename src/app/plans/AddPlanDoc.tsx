"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { addPlanDocAction } from "./actions";
import { Button } from "@/components/ui";
import { MAX_PLAN_FILE_BYTES, ALLOWED_PLAN_TYPES } from "@/lib/planFormats";
import type { themeFromColor } from "@/lib/brand";

const ACCEPT = Object.keys(ALLOWED_PLAN_TYPES).join(",");
const MAX_MB = (MAX_PLAN_FILE_BYTES / 1048576).toFixed(0);

/** إضافةُ وثيقةٍ إلى المركز: ملفٌّ يُرفَع أو رابطٌ يُشار إليه.
 *
 *  **والواجهةُ تُطعَم الحرسَ نفسَه الذي يفرضه الخادم:** الحجمُ يُقاس
 *  قبل الإرسال ويُقال بالميغابايت، والنوعُ يُقيَّد في `accept`. فلا
 *  يرفع أحدٌ ملفاً ثمانية ميغابايت ثم ينتظر دقيقةً ليُقال له إنه كبير —
 *  وهذا بالضبط ما وقع في صور الملفّات الشخصية من قبل. */
export function AddPlanDoc({ theme }: { theme: ReturnType<typeof themeFromColor> }) {
  const [state, formAction, pending] = useActionState(addPlanDocAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"file" | "link">("file");
  const [localError, setLocalError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // تفريغُ النموذج بعد النجاح: الإعادةُ في الأثر، أمّا حالةُ المكوّن
  // فتُصفَّر في أثناء الرسم بمقارنةِ آخِرِ نجاحٍ عولج. (وضعُ `setState`
  // في الأثر يُشعل رسماً متتابعاً، وفحصُ القواعد يرفضه — وقد وقع هذا
  // في زرّ السمة من قبل.)
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);
  const [handledSuccess, setHandledSuccess] = useState(false);
  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) setPicked(null);
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        const input = formRef.current?.querySelector<HTMLInputElement>('input[name="file"]');
        const f = input?.files?.[0];
        if (mode === "file" && f && f.size > MAX_PLAN_FILE_BYTES) {
          e.preventDefault();
          setLocalError(
            `حجم الملف ${(f.size / 1048576).toFixed(1)}MB — والحدّ ${MAX_MB}MB. ضعه في رابطٍ خارجيٍّ بدل رفعه.`
          );
          return;
        }
        setLocalError(null);
      }}
    >
      <div>
        <h3 className="text-sm font-bold">أضف وثيقة</h3>
        <p className="mt-1 text-xs leading-relaxed text-black/50">
          تُذيَّل آخرَ الترتيب، ثم رتّبها بالسهمين إلى موضعها. والملفُّ يُحفَظ في المنصة نفسها
          ويُفتَح لكل عضوٍ مسجَّل الدخول؛ وما كان أكبر من {MAX_MB} ميغابايت فضَعه رابطاً.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">عنوان الوثيقة</span>
          <input
            name="title"
            required
            maxLength={120}
            placeholder="مثال: خطة تَـــلاقِ ٢٠٢٦"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">وصفٌ قصير (اختياري)</span>
          <input
            name="note"
            maxLength={160}
            placeholder="سطرٌ يقول ما فيها"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
        </label>
      </div>

      {/* مصدرٌ واحدٌ لا اثنان: الخادم يرفض الملفّ والرابط معاً، فالواجهة
          تختار بينهما بزرَّين بدل أن تترك الخطأ يقع */}
      <div className="flex flex-wrap gap-2">
        {(["file", "link"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold transition-opacity ${
              mode === m ? "text-on-brand" : "text-black/60"
            }`}
            style={
              mode === m
                ? { background: theme.accentDark }
                : { border: "1px solid color-mix(in oklab, var(--ink) 14%, transparent)" }
            }
          >
            {m === "file" ? "ارفع ملفاً" : "ضع رابطاً"}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الملف</span>
          <input
            type="file"
            name="file"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPicked(f ? `${f.name} — ${(f.size / 1048576).toFixed(2)}MB` : null);
              setLocalError(null);
            }}
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-black/[0.06] file:px-3 file:py-1.5 file:text-xs file:font-bold"
          />
          <span className="text-xs text-black/45">
            المقبول: {Object.values(ALLOWED_PLAN_TYPES).join("، ")} — وبحدٍّ أقصى {MAX_MB} ميغابايت.
          </span>
          {picked && <span className="text-xs font-semibold text-black/60">{picked}</span>}
        </label>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الرابط</span>
          <input
            name="linkUrl"
            type="url"
            dir="ltr"
            placeholder="https://..."
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs text-black/45">يبدأ بـhttps:// — ولا يُقبل غيره.</span>
        </label>
      )}

      {(localError || state.error) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {localError ?? state.error}
        </p>
      )}
      {state.success && state.message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.message}
        </p>
      )}

      <div>
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? "جارٍ الإضافة..." : "أضفها إلى المركز"}
        </Button>
      </div>
    </form>
  );
}
