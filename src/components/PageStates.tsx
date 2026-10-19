import type { ReactNode } from "react";

/** حالاتُ الصفحة المشتركة — فارغة، وتحميل. (والخطأ في `src/app/error.tsx`.)
 *
 *  الفارغُ نتيجةٌ مصمَّمة لا فجوة: جملةٌ تقول ما كان سيظهر هنا، وإجراءٌ
 *  واحدٌ إن كان لصاحب الصفحة أن يُنشئه — ولا رسمَ ولا مثالَ يملأ المكان. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-empty" role="status">
      <p className="state-empty__title">{title}</p>
      {body && <p className="state-empty__body">{body}</p>}
      {action && <div className="state-empty__action">{action}</div>}
    </div>
  );
}

/** هيكلُ تحميلٍ يشبه الصفحة التي ستأتي: رأسٌ ثم بطاقات — فلا تقفز الصفحة حين تصل */
export function PageSkeleton({ label, cards = 3 }: { label: string; cards?: number }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <span className="skel h-4 w-32" />
        <span className="skel h-8 w-72 max-w-full" />
        <span className="skel h-4 w-96 max-w-full" />
      </div>
      <div className="skel h-44 w-full rounded-[28px]" aria-hidden="true" />
      <div className="grid gap-6 lg:grid-cols-2" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <span key={i} className="skel h-40 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
