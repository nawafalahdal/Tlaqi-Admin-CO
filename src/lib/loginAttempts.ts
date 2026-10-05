import { prisma } from "@/lib/prisma";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/** يتحقق إن كان الحساب مقفلاً مؤقتاً بسبب تجاوز محاولات دخول فاشلة متتالية */
export async function isLockedOut(identifier: string): Promise<boolean> {
  const attempt = await prisma.loginAttempt.findUnique({ where: { identifier } });
  return Boolean(attempt?.lockedUntil && attempt.lockedUntil > new Date());
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

/** يصفّر العدّاد عند دخول ناجح */
export async function clearFailedAttempts(identifier: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { identifier } });
}
