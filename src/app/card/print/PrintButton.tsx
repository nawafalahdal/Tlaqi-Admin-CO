"use client";

/** زرُّ الطباعة — يفتح نافذةَ طباعة المتصفح بالمقاسات المضبوطة في الصفحة */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-brand min-h-11 rounded-xl px-6 text-sm font-semibold">
      {label}
    </button>
  );
}
