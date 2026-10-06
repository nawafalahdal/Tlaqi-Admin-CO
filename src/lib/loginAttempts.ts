import { prisma } from "@/lib/prisma";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/** عدّاد محاولات الدخول وعدّاد طلبات الاستعادة عدّادان منفصلان تماماً.
 *  خلطُهما يعني أن مَن نسي كلمته وطلب رابط استعادة يُقفل عليه الدخول،
 *  فيصبح الطريق الوحيد للخروج من القفل هو نفسه سبب القفل. */
export function resetRequestKey(email: string) {
  return `reset:${email}`;
}

/** يتحقق إن كان الحساب مقفلاً مؤقتاً بسبب تجاوز محاولات دخول فاشلة متتالية */
export async function isLockedOut(identifier: string): Promise<boolean> {
  const attempt = await prisma.loginAttempt.findUnique({ where: { identifier } });
  return Boolean(attempt?.lockedUntil && attempt.lockedUntil > new Date());
}

/** الدقائق المتبقية على فكّ القفل — صفر إن لم يكن مقفلاً.
 *  تُعرض للمستخدم ليعرف أنه ينتظر، لا أن كلمته خاطئة. */
export async function lockoutMinutesLeft(identifier: string): Promise<number> {
  const attempt = await prisma.loginAttempt.findUnique({ where: { identifier } });
  if (!attempt?.lockedUntil) return 0;
  const ms = attempt.lockedUntil.getTime() - Date.now();
  return ms > 0 ? Math.max(1, Math.ceil(ms / 60_000)) : 0;
}

/** يسجّل محاولة دخول فاشلة ويقفل الحساب مؤقتاً بعد 5 محاولات متتالية */
export async function recordFailedAttempt(identifier: string): Promise<void> {
  const existing = await prisma.loginAttempt.findUnique({ where: { identifier } });
  const failCount = (existing?.failCount ?? 0) + 1;
  const lockedUntil = failCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;

  await prisma.loginAttempt.upsert({
    where: { identifier },
    update: { failCount, lockedUntil },
    create: { identifier, failCount, lockedUntil },
  });
}

/** يصفّر العدّاد — عند دخول ناجح، وعند كل تعيين جديد لكلمة المرور.
 *  كلمة مرور جديدة تعني أن المحاولات الفاشلة السابقة فقدت معناها: إبقاء
 *  القفل بعدها يحبس صاحب الحساب خلف كلمة مرور صحيحة. */
export async function clearFailedAttempts(identifier: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({
    where: { identifier: { in: [identifier, resetRequestKey(identifier)] } },
  });
}
