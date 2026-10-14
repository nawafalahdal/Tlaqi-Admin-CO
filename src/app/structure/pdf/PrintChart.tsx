"use client";

/** شريطُ الطباعة — يختفي في الورقة نفسها.
 *
 *  و`@page` هنا لا في الأنماط العامة: المقاس العرضيّ يخصّ هذه الورقة
 *  وحدها، وفرضُه عاماً يقلب كل صفحةٍ تُطبع في المنصة.
 *
 *  و`print-color-adjust: exact` ضروريٌّ لا تزيين: المتصفّحات تُسقط
 *  الخلفيات والحدود عند الطباعة افتراضاً — فتخرج ورقةٌ بلا ألوان
 *  الأقسام وبلا خطوط الشجرة، وهي حينها قائمةُ أسماءٍ لا هيكل.
 */
export function PrintChart() {
  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          html, body { background: #fff !important; }
          #tlaqi-org-sheet, #tlaqi-org-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      <div className="mx-auto mb-4 flex max-w-[1123px] flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-xs leading-relaxed text-black/50">
          اضغط الزرّ ثم اختر <strong>حفظ كـ PDF</strong> في نافذة الطباعة. والمقاس مضبوط على
          A4 عرضيّ.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-11 shrink-0 rounded-xl bg-[#C34900] px-5 text-sm font-semibold text-on-brand hover:opacity-90"
        >
          احفظ الهيكل PDF
        </button>
      </div>
    </>
  );
}
