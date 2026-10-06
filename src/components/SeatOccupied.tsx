import { Card } from "./ui";

/** يُعرض بدل نموذج الإنشاء حين يكون المنصب مشغولاً — أفضل من ترك المستخدم
 *  يملأ الحقول ثم يُصدم برفض، ويدلّه على طريق التفريغ. */
export function SeatOccupied({
  title,
  holderLine,
  hint,
}: {
  title: string;
  holderLine: string;
  hint: string;
}) {
  return (
    <Card className="border-amber-200 bg-amber-50 p-4 sm:p-5">
      <p className="text-sm font-bold text-amber-900">{title}</p>
      <p className="mt-1 text-sm text-amber-900/80">{holderLine}</p>
      <p className="mt-2 text-xs leading-relaxed text-amber-900/60">{hint}</p>
    </Card>
  );
}
