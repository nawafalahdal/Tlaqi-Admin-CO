import { Card } from "@/components/ui";
import { seatConflicts } from "@/lib/workflow";

/** تعارض المقاعد المفردة — يُعرض للمؤسس وحده، ولا يُعرض إن لم يكن.
 *
 *  القاعدة تقول: لكل منصبٍ قياديٍّ مقعدٌ واحد. والحرس يمنع إنشاء ثانٍ
 *  من اليوم، لكنه لا يرى ما سبقه. فإن وُجد تعارضٌ في البيانات لم يكن
 *  يظهر في أي شاشة — تبقى القاعدة مكتوبةً والواقع يخالفها بلا أن يدري
 *  أحد.
 *
 *  ولا يُصلح نفسه: تعطيلُ حسابين من ثلاثة اختيارٌ لا يملكه الكود. فيُسمّى
 *  الشاغلون ويُقال ما أثرُ بقائهم، ويحسمه المؤسس من إدارة الحسابات. */
export async function SeatConflicts() {
  const conflicts = await seatConflicts();
  if (conflicts.length === 0) return null;

  return (
    <Card className="border-[#9A2E1C]/30 bg-[#9A2E1C]/[0.04] p-4 sm:p-5">
      <h2 className="text-sm font-bold text-[#9A2E1C]">مقاعد قيادية مشغولة بأكثر من واحد</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/60">
        لكل منصبٍ قياديٍّ مقعدٌ واحد. والمنصة تمنع إنشاء مقعدٍ ثانٍ من الآن، لكنها لا تُعطّل
        حسابات أُنشئت قبل هذه القاعدة. وما دام المنصب مشغولاً بأكثر من واحد، تصل رسائل
        التصعيد إليهم جميعاً.
      </p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {conflicts.map((c) => (
          <li key={`${c.role}-${c.departmentName ?? ""}`} className="text-xs">
            <span className="font-bold text-black/75">
              {c.roleLabel}
              {c.departmentName ? ` — ${c.departmentName}` : ""}
            </span>
            <span className="text-black/45"> ({c.holders.length})</span>
            <ul className="mt-1 flex flex-col gap-0.5 ps-4">
              {c.holders.map((h) => (
                <li key={h.email} className="text-black/60">
                  {h.fullName} <span className="text-black/35" dir="ltr">{h.email}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-black/5 pt-3 text-xs text-black/45">
        نحِّ من لم يبقَ في منصبه من «إدارة الحسابات» — ولا يحسمها الكود: تعطيل الحساب الخطأ
        يُفرِغ المنصب من صاحبه الحقيقي.
      </p>
    </Card>
  );
}
