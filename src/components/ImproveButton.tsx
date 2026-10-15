"use client";

import { useActionState, useId, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { submitImprovementAction, type ImproveState } from "@/app/improve/actions";

/** زرُّ «تحسين» — في ترويسة كل شاشة، إلى جانب اللغة والسمة.
 *
 *  ## لماذا هو هنا لا في صفحةٍ تُفتَح
 *
 *  **الملاحظةُ تُقال حيث رُئيت أو لا تُقال.** من رأى شيئاً في لوحةِ
 *  المراجعة ثم طُلب منه أن يَترك ما بيده ويَفتح صفحةَ تذاكرَ ويَختار
 *  وجهةً ويَكتب موضوعاً — لا يَفعل. فينصرف، فتُفقَد الملاحظة. فصار
 *  البابُ في الترويسة: يُفتَح درجٌ خفيفٌ فوق الصفحة، لا انتقالَ ولا
 *  فقدانَ لما كان يُقرأ خلفه.
 *
 *  ## وسياقُ الصفحة يُلتقَط ولا يُسأل عنه
 *
 *  «في أيّ صفحة؟ وبأيّ مقاس؟ وبأيّ سمة؟» أسئلةٌ يَعرف المتصفّحُ جوابَها
 *  ولا يَعرفه صاحبُ الملاحظة بدقّة — وكلُّ سؤالٍ وقفةٌ يَنصرف عندها من
 *  كان سيُبلغ. فيُلتقَط المسارُ والمقاسُ والسمةُ واللغة، وهي معدودةٌ
 *  مُعلَنةٌ لا «كلُّ ما في المتصفّح»: لا نصَّ صفحةٍ ولا بياناتِ أحد.
 *
 *  ## والدرجُ لا يَحبس من فتحه
 *
 *  `Escape` يُغلقه، والنقرُ خارجَه يُغلقه، والتركيزُ يعود إلى الزرّ بعده.
 *  ودرجٌ يُفتَح ولا يُغلَق إلا بزرٍّ واحدٍ في زاويته سجنٌ صغير.
 */
export function ImproveButton({ color }: { color: string }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState("");
  const [kind, setKind] = useState<"bug" | "confusing" | "idea">("bug");
  const [state, action, pending] = useActionState<ImproveState, FormData>(
    submitImprovementAction,
    { error: null }
  );
  const [doneFor, setDoneFor] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const pathname = usePathname();

  // الإقرارُ يُقرأ في الرسم لا في `useEffect`: تحديثُ الحالة داخل أثرٍ
  // يُطلق رسماً متتابعاً ويَرفضه الفحصُ — والقراءةُ هنا تَكفي.
  if (state.ticketNumber && doneFor !== state.ticketNumber) {
    setDoneFor(state.ticketNumber);
  }

  /** ما يَعرفه المتصفّحُ ولا يَعرفه صاحبُ الملاحظة — معدوداً.
   *
   *  ويُقرأ **لحظةَ فتح الدرج**: تلك هي اللحظةُ التي كان صاحبُ الملاحظة
   *  يَنظر فيها إلى ما استوقفه. (وأوّلُ كتابةٍ وضعته في حقلٍ مخفيٍّ
   *  يُملأ عند `focus` — والحقلُ المخفيُّ لا يَقبل تركيزاً أصلاً، فكان
   *  السياقُ يُرسَل فارغاً دائماً.) */
  const readContextNow = () =>
    JSON.stringify({
      path: pathname ?? "",
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      theme: document.documentElement.dataset.theme ?? "light",
      locale: document.documentElement.lang || "ar",
      agent: navigator.userAgent.slice(0, 180),
    });

  const close = () => {
    setOpen(false);
    openerRef.current?.focus();
  };

  const openDrawer = () => {
    setContext(readContextNow());
    setOpen(true);
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={openDrawer}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="improve-btn"
        style={{ "--tsw": color } as CSSProperties}
      >
        <span aria-hidden className="improve-btn__spark">
          ✦
        </span>
        <span>تحسين</span>
      </button>

      {open && (
        <div
          className="improve-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          // النقرُ على الظلّ يُغلق، والنقرُ داخل اللوح لا يُغلق
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div className="improve-sheet__panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-base font-bold">
                  شفتَ شيئاً يُحسَّن؟
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-black/50">
                  قُله من هنا — تصير ملاحظتُك تذكرةً في صندوق المؤسس، ونُعلمك حين
                  تُصلَح لتُجرّبها بنفسك.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="إغلاق"
                className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-black/40 hover:bg-black/[0.06] hover:text-black/70"
              >
                ✕
              </button>
            </div>

            {doneFor ? (
              <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm">
                <p className="font-bold text-emerald-800">وصلَت — شكراً لك.</p>
                <p className="mt-1 text-xs leading-relaxed text-emerald-800/80">
                  رقمُها <b>#{doneFor}</b>، وتَجدها في «ملاحظاتي» حتى تُغلَق. وحين
                  تُصلَح تَنتظر تجربتَك قبل أن تُقفَل.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="btn-brand mt-3 rounded-lg px-3 py-2 text-xs font-bold"
                >
                  تمام
                </button>
              </div>
            ) : (
              <form action={action} className="mt-4 flex flex-col gap-3">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="context" value={context} />

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["bug", "شيءٌ معطوب"],
                      ["confusing", "شيءٌ غامض"],
                      ["idea", "فكرةٌ أحسن"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      aria-pressed={kind === k}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                        kind === k
                          ? "bg-black/[0.08] text-black/80 ring-1 ring-black/15"
                          : "text-black/50 hover:bg-black/[0.04]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-black/70">في سطرٍ واحد</span>
                  <input
                    name="title"
                    required
                    maxLength={160}
                    placeholder="مثال: زرُّ الحفظ لا يُرى على الجوّال"
                    className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-black/70">واشرحها</span>
                  <textarea
                    name="note"
                    required
                    rows={4}
                    maxLength={2000}
                    placeholder="ماذا كنتَ تفعل؟ وماذا توقّعتَ أن يحدث؟ وماذا حدث؟"
                    className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm leading-relaxed outline-none focus:border-black/30"
                  />
                </label>

                {state.error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {state.error}
                  </p>
                )}

                <p className="text-[11px] leading-relaxed text-black/40">
                  يُرسَل مع ملاحظتك: الصفحةُ التي أنت فيها، ومقاسُ الشاشة، والسمة،
                  واللغة — ولا شيءَ غيرَها.
                </p>

                <button
                  type="submit"
                  disabled={pending}
                  className="btn-brand min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
                >
                  {pending ? "تُرسَل…" : "أرسِل الملاحظة"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
