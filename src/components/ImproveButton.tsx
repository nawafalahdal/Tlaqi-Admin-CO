"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { submitImprovementAction, type ImproveState } from "@/app/improve/actions";
import { SparkIcon } from "./icons";
import { useTranslations } from "@/i18n/LocaleProvider";

/** زرُّ «تحسين» — عائمٌ دائريٌّ في زاوية كل شاشة، واحدٌ لا يتكرّر.
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
export function ImproveButton() {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState("");
  const [kind, setKind] = useState<"bug" | "confusing" | "idea">("bug");
  const [state, action, pending] = useActionState<ImproveState, FormData>(
    submitImprovementAction,
    { error: null }
  );
  const [doneFor, setDoneFor] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const pathname = usePathname();
  const L = useTranslations().improve;
  const kinds = [
    ["bug", L.kindBug, L.notePlaceholderBug],
    ["confusing", L.kindConfusing, L.notePlaceholderConfusing],
    ["idea", L.kindIdea, L.notePlaceholderIdea],
  ] as const;

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

  // الحوارُ يأخذ التركيزَ حين يُفتَح، وEscape يُغلقه من أيّ موضع.
  //
  // كان Escape يُلتقَط على الدرج نفسه — فلا يعمل إلا والتركيزُ داخله، والتركيزُ
  // يبقى على الزرّ بعد فتحه. فكان يعمل مصادفةً ثم انقطع حين عام الزرّ. وحوارٌ
  // لا يأخذ التركيز يُضيّع قارئَ الشاشة ولوحةَ المفاتيح معاً.
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>("textarea, input:not([type=hidden]), select, button")
      ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      openerRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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
        // زرٌّ عائمٌ واحدٌ في كل الشاشات — لا في الترويسة. والاسمُ الظاهر
        // «تحسين» يُقرأ للقارئ الآلي كاملاً بما يفعله.
        aria-label={L.fabAria}
        title={L.fab}
        // `improve-btn` مِقبضٌ ثابتٌ يُنتقى به في الفحص — لا بنصِّه الذي يُترجَم
        className="improve-btn improve-fab"
      >
        <SparkIcon className="improve-btn__spark" />
        <span className="improve-fab__label">{L.fab}</span>
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
        >
          <div ref={panelRef} className="improve-sheet__panel">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="improve-sheet__badge" aria-hidden="true">
                  <SparkIcon />
                </span>
                <div>
                  <h2 id={titleId} className="text-base font-bold">
                    {L.title}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-black/55">{L.intro}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={L.close}
                className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-black/40 hover:bg-black/[0.06] hover:text-black/70"
              >
                ✕
              </button>
            </div>

            {doneFor ? (
              <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm">
                <p className="font-bold text-emerald-800">{L.doneTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-emerald-800/80">
                  {L.doneBody.replace("{n}", String(doneFor))}
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="btn-brand mt-3 min-h-10 rounded-lg px-4 text-xs font-bold"
                >
                  {L.doneOk}
                </button>
              </div>
            ) : (
              <form action={action} className="mt-5 flex flex-col gap-4">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="context" value={context} />

                {/* نوعُ الملاحظة: اختيارٌ واحدٌ من ثلاثة — مقطعٌ متّصلٌ لا أزرارٌ متفرّقة */}
                <div role="radiogroup" aria-label={L.kindLegend} className="improve-kinds">
                  {kinds.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className="improve-kinds__item"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-black/70">{L.titleLabel}</span>
                  <input
                    name="title"
                    required
                    maxLength={160}
                    placeholder={L.titlePlaceholder}
                    className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-black/70">{L.noteLabel}</span>
                  <textarea
                    name="note"
                    required
                    rows={4}
                    maxLength={2000}
                    // السؤالُ يتبع النوع: العطلُ يُوصَف بخطواته، والفكرةُ بفائدتها
                    placeholder={kinds.find(([k]) => k === kind)?.[2]}
                    className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm leading-relaxed outline-none focus:border-black/30"
                  />
                </label>

                {state.error && (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {state.error}
                  </p>
                )}

                <p className="text-[11px] leading-relaxed text-black/45">{L.privacy}</p>

                <button
                  type="submit"
                  disabled={pending}
                  className="btn-brand min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
                >
                  {pending ? L.sending : L.submit}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
