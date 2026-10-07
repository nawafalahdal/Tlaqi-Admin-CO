import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/** مهلة الرمز. قصيرة عمداً: رمز من ست خانات يبقى صالحاً ساعةً رمزٌ ضعيف،
 *  لأن مجاله مليون احتمال فقط وطول العمر يمنح المهاجم وقتاً للتخمين. */
export const LOGIN_CODE_MINUTES = 10;

/** محاولات إدخال الرمز قبل إبطاله. ستّ خانات = مليون احتمال، وخمس محاولات
 *  تجعل احتمال التخمين 5 من مليون — ثم يُبطَل الرمز فيبدأ العدّ من جديد. */
const MAX_CODE_ATTEMPTS = 5;

function hashCode(email: string, code: string) {
  // البريد جزء من المُجزّأ: رمزٌ أُصدر لشخص لا يصلح لحساب آخر حتى لو تطابق
  return crypto.createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");
}

/** رمز عشوائي من ست خانات بمولّد آمن تشفيرياً.
 *  Math.random غير صالح هنا: ناتجه متوقَّع لمن يعرف حالة المولّد. */
function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** يُصدر رمز دخول جديداً ويُبطل ما سبقه.
 *
 *  الإبطال مقصود: لو بقيت الرموز القديمة صالحة، لصار كل طلب جديد يوسّع
 *  مجال ما يُقبل بدل أن يستبدله — ومن طلب الرمز مرتين لا ينتظر إلا الأخير. */
export async function issueLoginCode(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const code = generateCode();

  await prisma.loginCode.updateMany({
    where: { email, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.loginCode.create({
    data: {
      email,
      codeHash: hashCode(email, code),
      expiresAt: new Date(Date.now() + LOGIN_CODE_MINUTES * 60_000),
    },
  });

  return code;
}

export type CodeCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "used" | "wrong" | "too_many" };

/** يستهلك الرمز إن صحّ.
 *
 *  الاستهلاك ذرّي بشرط usedAt = null، فمحاولتان متزامنتان بالرمز نفسه لا
 *  تنجحان معاً. والمحاولة الخاطئة تُحسب، فلا يُترك الرمز هدفاً لتخمين
 *  غير محدود. */
export async function consumeLoginCode(rawEmail: string, code: string): Promise<CodeCheck> {
  const email = rawEmail.trim().toLowerCase();
  const digits = code.replace(/\D/g, "");

  const record = await prisma.loginCode.findFirst({
    where: { email, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return { ok: false, reason: "missing" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    await prisma.loginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return { ok: false, reason: "too_many" };
  }

  if (digits.length !== 6 || record.codeHash !== hashCode(email, digits)) {
    const bumped = await prisma.loginCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    // بلوغ الحدّ يُبطل الرمز فوراً لا عند المحاولة التالية
    if (bumped.attempts >= MAX_CODE_ATTEMPTS) {
      await prisma.loginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      return { ok: false, reason: "too_many" };
    }
    return { ok: false, reason: "wrong" };
  }

  const claimed = await prisma.loginCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, reason: "used" };

  return { ok: true };
}

/** ينظّف الرموز المنتهية. يُستدعى مع الكنس اليومي — الجدول لا ينمو بلا حدّ. */
export async function purgeExpiredLoginCodes() {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const { count } = await prisma.loginCode.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
  });
  return count;
}
