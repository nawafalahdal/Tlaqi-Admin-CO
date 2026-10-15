import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** تقنينُ الكنس المُستدعى من عَرْض الصفحات.
 *
 *  **لماذا لا يُحذَف الكنسُ من الصفحات رأساً:** الخطةُ المجانية على
 *  Vercel تُتيح جدولاً واحداً في اليوم، ومهلُ التذاكر تُقاس بالأيام
 *  وانتهاءُ حسابات المرشّحين بالساعات. فلو صار الكنسُ مجدولاً وحدَه
 *  لتأخّر التصعيدُ يوماً كاملاً — وهذا إضعافٌ للصحّة طلباً للسرعة،
 *  وهو ما لا يُفعَل.
 *
 *  **وما يُحذَف هو التكرار:** الكنسُ يَصلح أن يجري مرّةً كلَّ ربع ساعة،
 *  لا مع كل فتحةِ صفحةٍ من كل أحد. وكان ثمنُه المعتاد خمسَ رحلاتٍ
 *  إلى القاعدة قبل أن تُرسَم الصفحة — وإن وُجد مستحَقٌّ صار العرضُ
 *  يكتب **ويُرسل بريداً**، وهو عملٌ غيرُ محدودٍ في مسار عَرْض.
 *
 *  **والادّعاءُ جملةٌ واحدة لكل المفاتيح — وهذا إصلاحُ قياسٍ لا تجميل.**
 *  أوّلُ تطبيقٍ ادّعى كلَّ مفتاحٍ بـ`updateMany` على حِدة، فقِستُ المسار
 *  فوجدتُه **تسعةَ استعلامات** بدل خمسة: Prisma يَلفّ كلَّ `updateMany`
 *  في معاملة، فصار لكل مفتاحٍ `BEGIN` و`UPDATE` و`COMMIT`. فالتقنينُ
 *  الذي وُضع ليُقلّل الرحلاتِ كان يَزيدها. وصار جملةً واحدة:
 *
 *      UPDATE "SweepRun" SET "lastRunAt" = … WHERE key = ANY(…) AND
 *      "lastRunAt" < … RETURNING "key"
 *
 *  رحلةٌ واحدة، والمهلةُ داخل `WHERE` فالقاعدةُ هي التي تَفصل بين
 *  المتسابقين، و`RETURNING` يقول لمن فاز بماذا بالضبط.
 */

/** مفاتيحُ الكنوس — مزروعةٌ في الترحيل، فالادّعاءُ تحديثٌ لا إنشاء */
export type SweepKey = "overdue_requests" | "ticket_escalation" | "candidate_expiry";

/** المهلةُ بين كنسين من الصفحات — ربعُ ساعة.
 *
 *  أقصرُ من أن يتأخّر تصعيدٌ مهلتُه يومان، وأطولُ من أن يُكرَّر العملُ
 *  مع كل فتحة. */
export const SWEEP_WINDOW_MS = 15 * 60_000;

/** يَدّعي ما حان وقتُه من المفاتيح — جملةً واحدة.
 *
 *  ويُعيد ما فاز به هذا النداءُ وحده. و`windowMs = 0` يَدّعي كلَّ شيءٍ
 *  دائماً (`lastRunAt < now` يَصدق على كل ختمٍ ماضٍ)، وهو ما يُستعمَل
 *  حين لا تقنينَ مطلوب.
 */
export async function claimDueSweeps(
  keys: readonly SweepKey[],
  windowMs: number = SWEEP_WINDOW_MS
): Promise<Set<SweepKey>> {
  if (keys.length === 0) return new Set();
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  try {
    const won = await prisma.$queryRaw<{ key: SweepKey }[]>(Prisma.sql`
      UPDATE "SweepRun"
         SET "lastRunAt" = ${now}
       WHERE "key" IN (${Prisma.join(keys as SweepKey[])})
         AND "lastRunAt" < ${cutoff}
      RETURNING "key"
    `);
    return new Set(won.map((r) => r.key));
  } catch {
    // الكنسُ خدمةٌ جانبية: صفحةٌ تنكسر لأن صفَّ تقنينٍ تعذّرت قراءتُه
    // عطبٌ أسوأ من كنسٍ فائت
    return new Set();
  }
}

/** يُجري من الكنوس ما حان وقتُه — برحلةٍ واحدةٍ إلى القاعدة.
 *
 *  ويُعيد ما جرى فعلاً، ليُقاس في الاختبار لا ليُغيَّر به سلوك.
 */
export async function runDueSweeps(
  jobs: Partial<Record<SweepKey, () => Promise<unknown>>>,
  windowMs: number = SWEEP_WINDOW_MS
): Promise<SweepKey[]> {
  const keys = Object.keys(jobs) as SweepKey[];
  const due = await claimDueSweeps(keys, windowMs);
  const ran = keys.filter((k) => due.has(k));
  await Promise.all(ran.map((k) => jobs[k]!()));
  return ran;
}
