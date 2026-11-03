import { prisma } from "@/lib/prisma";

/** **إبطالُ الوصول فوراً — بلا استعلامٍ لكل مستخدمٍ في كل طلب.**
 *
 *  الجلسةُ توكنٌ موقَّع يُراجَع حسابُه كل خمس دقائق (`auth.ts`). وإنهاءُ العضوية أو الإيقافُ
 *  أو تغييرُ القائد لا يحتمل خمس دقائق. فكلُّ إبطالٍ يُكتب صفّاً هنا، و«حقبةُ الإبطال» = آخرُ
 *  صفّ. وكلُّ جلسةٍ رُوجعت قبل الحقبة تُراجَع في طلبها التالي — فيسقط المُبطَلُ وحده، ويمضي غيرُه.
 *
 *  والحقبةُ تُقرأ مرّةً لكل نسخةٍ من الخادم كل `EPOCH_TTL_MS` على الأكثر — استعلامٌ صغيرٌ واحد
 *  مهما كثر المستخدمون. فالإبطالُ يسري خلال ثوانٍ في كل نسخة. */
const EPOCH_TTL_MS = Number(process.env.REVOCATION_EPOCH_TTL_MS ?? 5000);
let cached: { at: number; epoch: number } | null = null;

export async function revocationEpoch(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < EPOCH_TTL_MS) return cached.epoch;
  try {
    const last = await prisma.accessRevocation.findFirst({ orderBy: { revokedAt: "desc" }, select: { revokedAt: true } });
    cached = { at: now, epoch: last?.revokedAt.getTime() ?? 0 };
  } catch {
    // تعذّرت القراءة: لا تُبطَل جلسةٌ بانقطاعٍ لحظيّ — والفحصُ الدوريُّ قائمٌ بعده
    cached = { at: now, epoch: cached?.epoch ?? 0 };
  }
  return cached.epoch;
}

type Db = Pick<typeof prisma, "accessRevocation">;

/** يُسجَّل الإبطال — داخل معاملة الإجراء نفسِه حيث أمكن */
export async function revokeAccess(
  db: Db,
  r: { accountKind: "member" | "user"; accountId: string; reason: string; byName: string }
): Promise<void> {
  // وقتُ الإبطال بساعة التطبيق (لا ساعة القاعدة): هي الساعةُ نفسُها التي تُختم بها مراجعةُ الجلسة
  await db.accessRevocation.create({ data: { ...r, revokedAt: new Date() } });
}
