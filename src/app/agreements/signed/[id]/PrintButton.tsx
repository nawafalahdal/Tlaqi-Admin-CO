"use client";

/** طباعةٌ أو حفظٌ PDF من المتصفّح — النسخةُ مصمَّمةٌ للطباعة (`@media print`) */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center rounded-xl border border-black/30 px-4 font-semibold">
      طباعة / حفظ PDF
    </button>
  );
}
