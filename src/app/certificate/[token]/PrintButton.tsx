"use client";

/** زرّ الطباعة — يختفي عند الطباعة نفسها فلا يظهر في الـ PDF */
export function PrintButton() {
  return (
    <div className="mx-auto mb-4 flex max-w-[1123px] justify-end print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="min-h-11 rounded-xl bg-[#C34900] px-5 text-sm font-semibold text-white hover:opacity-90"
      >
        احفظها PDF أو اطبعها
      </button>
    </div>
  );
}
