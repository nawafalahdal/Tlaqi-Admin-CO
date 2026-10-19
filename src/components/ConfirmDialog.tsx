"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";

/** نافذةُ التأكيد قبل إجراءٍ لا يُتراجَع عنه بنقرة.
 *
 *  مبنيّةٌ على `<dialog>` الأصيل لا على طبقةٍ مرسومة: المتصفّحُ نفسُه يحبس
 *  التركيز داخلها، ويُغلقها بـEscape، ويُعطّل الصفحةَ خلفها، ويُعيد التركيز
 *  إلى الزرّ الذي فتحها — وكلُّ ذلك كان سيُكتب يدوياً ويُخطئ.
 *
 *  النافذةُ لا تنفّذ شيئاً بنفسها: تُعيد القرارَ إلى صاحبها (`onConfirm`)،
 *  والخادمُ يبقى الحَكَمَ في الصلاحية. وتبقى مفتوحةً أثناء التنفيذ
 *  (`pending`) ليظهر الخطأُ فيها إن رُفض الإجراء، لا أن يختفي بصمت. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "danger",
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "brand";
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // صفوفُ الاعتماد كثيرةٌ في الصفحة الواحدة، ولكلٍّ نافذتُه — فالمعرّفُ فريد
  const titleId = useId();
  const s = useTranslations().shell;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      // Escape أو زرّ الرجوع في الجوال: إلغاءٌ — إلا أثناء التنفيذ
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id={titleId} className="text-base font-bold">
        {title}
      </h2>
      {body && <div className="mt-2 text-sm leading-relaxed text-black/60">{body}</div>}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {/* الإلغاءُ أولاً ويأخذ التركيز: الضغطةُ العجلى لا تنفّذ شيئاً */}
        <button
          type="button"
          autoFocus
          disabled={pending}
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-xl border border-black/10 px-4 text-sm font-semibold text-black/70 hover:bg-black/[0.03] disabled:opacity-50"
        >
          {s.cancel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold disabled:opacity-60 ${
            tone === "danger" ? "bg-red-600 text-on-brand" : "btn-brand"
          }`}
        >
          {pending ? s.working : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
