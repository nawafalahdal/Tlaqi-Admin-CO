import { Card } from "@/components/ui";
import { seatConflicts } from "@/lib/workflow";
import { SeatHolderRow } from "@/components/SeatHolderRow";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { getLocale, getDictionary } from "@/i18n/server";
import { accountRoleLabel } from "@/lib/testTracks";

/** تعارض المقاعد المفردة — يُعرض للمؤسس وحده، ولا يُعرض إن لم يكن.
 *
 *  القاعدة تقول: لكل منصبٍ قياديٍّ مقعدٌ واحد. والحرس يمنع إنشاء ثانٍ
 *  من اليوم، لكنه لا يرى ما سبقه. فإن وُجد تعارضٌ في البيانات لم يكن
 *  يظهر في أي شاشة — تبقى القاعدة مكتوبةً والواقع يخالفها بلا أن يدري
 *  أحد.
 *
 *  **وكان يُعرض ولا يُعالَج.** أسماءٌ وبُرُدٌ نصّاً، وسطرٌ يقول «نحِّ من
 *  لم يبقَ في منصبه من إدارة الحسابات». فيرى المؤسس أن المقعد مشغولٌ
 *  باثنين، ولا يعرف أيُّهما الزائد، ولا يجد هنا ما يُزيله به. والعلم
 *  بالعطب بلا أداةٍ لإصلاحه ليس حلاًّ.
 *
 *  فصار لكل شاغلٍ سطرُه، يحمل ما يُفرّقه عن قرينه — متى أُنشئ، وهل
 *  استُعمل قطّ، وهل له سجلُّ ترشّحٍ معتمَد — وزرَّ محوٍ نهائي للمؤسس.
 *  والقرار قرارُه: الكود لا يُخمّن أيَّ حسابٍ هو الحقيقي، لأن حذف الخطأ
 *  منهما يُخرج قائداً عاملاً من المنصة. */
export async function SeatConflicts({ canPurge = false }: { canPurge?: boolean }) {
  const conflicts = await seatConflicts();
  const locale = await getLocale();
  const L = getDictionary(locale).ui.seats;
  if (conflicts.length === 0) return null;

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <Card className="border-[#9A2E1C]/30 bg-[#9A2E1C]/[0.04] p-4 sm:p-5">
      <h2 className="text-sm font-bold text-[#9A2E1C]">{L.title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/60">
        {L.body}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {conflicts.map((c) => (
          <div key={`${c.role}-${c.departmentName ?? ""}`}>
            <p className="text-xs font-bold text-black/75">
              {accountRoleLabel(c.role, locale)}
              {c.departmentName ? ` — ${c.departmentName}` : ""}
              <span className="font-normal text-black/40"> · {L.holders.replace("{n}", String(c.holders.length))}</span>
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {c.holders.map((h) => (
                <SeatHolderRow key={h.id} holder={{ ...h, createdAt: h.createdAt.toISOString() }} canPurge={canPurge} theme={theme} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 border-t border-black/10 pt-3 text-xs leading-relaxed text-black/50">
        {L.advice}
      </p>
    </Card>
  );
}
