"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";
import { themeForDepartment } from "@/lib/brand";
import { runMarketingOp, type OpState } from "../actions";

/** نموذجُ كلِّ عمليةٍ في وكيل التسويق — حقولُه يرسمها الخادم، وهذا يرسله ويقول النتيجة.
 *
 *  - **مفتاحُ تكرارٍ لكل نموذج** (`requestId`): يُولَّد عند أول إرسال ويُعاد
 *    استعمالُه في كل إعادةٍ حتى ينجح الطلب، ثم يُجدَّد. فإعادةُ الإرسال بعد
 *    انقطاعٍ وقع فيه النجاحُ دون أن يصل ردُّه تُعيد ما أُنشئ ولا تنشئ نسخةً
 *    ثانية (الخدمةُ تفحص المفتاح). ويُوضع في البيانات لحظةَ الإرسال، فلا
 *    قيمةَ عشوائيةَ في رسم الخادم تُفسد المطابقة.
 *  - **الزرُّ يقول ما يفعله** ويتعطّل أثناء الإرسال؛ والنتيجةُ جملةٌ بلغة الصفحة.
 *  - **التأكيدُ خانةٌ مطلوبة** لا نافذةُ المتصفّح: بلغة الصفحة، وتُقرأ، ولا تُتجاوز
 *    بلوحة المفاتيح سهواً.
 *  - **ما كُتب لا يُمحى إن رُدّ الطلب.** React 19 يُفرغ النموذجَ بعد كل إرسالٍ عبر
 *    `<form action>` — ولو ردّه الخادم برمز — فكانت خانةُ «رأيتُه حيّاً» وبنودُ الجودة
 *    وملاحظاتُها تُمحى مع رسالة الخطأ. فالإرسالُ هنا من `onSubmit` داخل انتقال، ولا
 *    يُفرَغ النموذجُ إلا بعد نجاحٍ وحين يُطلب (`resetOnSuccess`). */

const theme = themeForDepartment("marketing");

export type ActionButton = { label: string; op?: string; name?: string; value?: string; variant?: Variant };
type Variant = "solid" | "outline" | "danger" | "ghost";

const BTN = "inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

function buttonStyle(v: Variant): { className: string; style?: React.CSSProperties } {
  if (v === "solid") return { className: `${BTN} hover:brightness-95`, style: { background: theme.fill, color: theme.onFill } };
  if (v === "danger") return { className: `${BTN} border border-red-300 text-red-700 hover:bg-red-50` };
  if (v === "ghost") return { className: `${BTN} text-black/60 hover:bg-black/[0.04]` };
  return { className: `${BTN} border border-black/15 text-black/75 hover:bg-black/[0.04]` };
}

export function ActionForm({
  op,
  submit,
  buttons,
  children,
  confirm,
  resetOnSuccess = false,
  variant = "solid",
  className = "",
  inline = false,
}: {
  op?: string;
  submit?: string;
  buttons?: ActionButton[];
  children?: ReactNode;
  /** نصُّ خانة التأكيد — للعمليات التي لا تُتراجَع */
  confirm?: string;
  resetOnSuccess?: boolean;
  variant?: Variant;
  className?: string;
  /** صفٌّ واحد: الحقولُ والزرُّ متجاوران */
  inline?: boolean;
}) {
  const mk = useTranslations().mk;
  const [state, action, pending] = useActionState<OpState, FormData>(runMarketingOp, { ok: null, message: null, at: 0 });
  const key = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.ok) return;
    key.current = null;
    if (resetOnSuccess) form.current?.reset();
  }, [state.at, state.ok, resetOnSuccess]);

  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // زرُّ الإرسال جزءٌ من البيانات (`op` و`decision` على الأزرار)
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    key.current ??= crypto.randomUUID();
    fd.set("requestId", key.current);
    startTransition(() => action(fd));
  };

  const list: ActionButton[] = buttons ?? [{ label: submit ?? mk.common.save, variant }];
  const opInButtons = list.some((b) => b.op);

  return (
    <form ref={form} onSubmit={send} className={`${inline ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-3"} ${className}`}>
      {op && !opInButtons && <input type="hidden" name="op" value={op} />}
      {children}
      {confirm && (
        <label className="flex items-start gap-2 text-xs leading-relaxed text-black/65">
          <input type="checkbox" required className="mt-0.5" />
          <span>{confirm}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {list.map((b, i) => {
          const st = buttonStyle(b.variant ?? variant);
          return (
            <button
              key={i}
              type="submit"
              disabled={pending}
              name={b.op ? "op" : b.name}
              value={b.op ?? b.value}
              className={st.className}
              style={st.style}
            >
              {pending ? mk.common.working : b.label}
            </button>
          );
        })}
        {state.message && (
          <p role="status" aria-live="polite" className={`text-xs font-semibold ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
