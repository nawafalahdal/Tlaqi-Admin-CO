import { prisma } from "@/lib/prisma";

/** حالةُ الدخول — ما يمنع شخصاً من الوصول، غيرَ بريده.
 *
 *  **السبب طلبٌ صريح:** «يظهر لي الشخص هذا مثلاً مشكلة بدخول، غير
 *  البريد». فكان الجواب الوحيد المعروض هو البريد — ومن لا يدخل قد لا
 *  تكون مشكلته في بريده أصلاً: قُفل حسابه بعد محاولات، أو كلمتُه
 *  المؤقتة ما زالت مؤقتة ولم يُكملها، أو لم يدخل يوماً.
 *
 *  **وهذا للمؤسس وحده.** أمورُ الدخول حسّاسة: عددُ المحاولات الفاشلة
 *  وقفلُ الحساب تُقرأ منها محاولاتُ انتحالٍ على شخصٍ بعينه. فلا تُعرَض
 *  للتنفيذي ولا لقادة الأقسام، والحرس في الخادم لا في إخفاء القسم.
 */

export type LoginHealth = {
  /** مقفلٌ مؤقتاً حتى هذا الوقت — بعد محاولاتٍ فاشلة متتالية */
  lockedUntil: Date | null;
  failCount: number;
  /** كلمتُه ما تزال المؤقتة — لم يُكمل خطوته الأولى */
  mustChangePassword: boolean;
  /** فعّل تطبيق المصادقة؟ — رمز البريد يكفي، وهذا زيادة */
  totpEnabled: boolean;
  /** لم يدخل قطّ */
  neverSignedIn: boolean;
};

/** جُمَلٌ تُقرأ كما هي — لا رموزٌ يُترجمها من ينظر */
export function loginHealthNotes(h: LoginHealth, now: Date = new Date(), locale: "ar" | "en" = "ar"): string[] {
  const notes: string[] = [];
  if (locale === "en") {
    if (h.lockedUntil && h.lockedUntil > now) {
      const minutes = Math.max(1, Math.ceil((h.lockedUntil.getTime() - now.getTime()) / 60_000));
      notes.push(`Temporarily locked — ${minutes} min left`);
    } else if (h.failCount >= 3) {
      notes.push(`${h.failCount} failed sign-in attempts in a row`);
    }
    if (h.neverSignedIn) notes.push("Has not signed in yet");
    if (h.mustChangePassword) notes.push("Still on the temporary password — not changed");
    if (!h.totpEnabled) notes.push("Authenticator app not enabled (the email code is enough)");
    return notes;
  }
  if (h.lockedUntil && h.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((h.lockedUntil.getTime() - now.getTime()) / 60_000));
    notes.push(`مقفل مؤقتاً — ${minutes} دقيقة متبقّية`);
  } else if (h.failCount >= 3) {
    notes.push(`${h.failCount} محاولات دخول فاشلة متتالية`);
  }
  if (h.neverSignedIn) notes.push("لم يدخل المنصة بعد");
  if (h.mustChangePassword) notes.push("كلمة المرور ما تزال المؤقتة — لم يُغيّرها");
  if (!h.totpEnabled) notes.push("لم يُفعّل تطبيق المصادقة (رمز البريد يكفيه)");
  return notes;
}

/** هل في حالته ما يستحقّ تنبيه المؤسس؟
 *
 *  وعدمُ تفعيل تطبيق المصادقة ليس مشكلةَ دخول: رمزُ البريد عاملٌ ثانٍ
 *  كامل. فلا يُحسَب عُطلاً وإلّا صار كلُّ حسابٍ «مشكلة». */
export function loginHealthBlocked(h: LoginHealth, now: Date = new Date()): boolean {
  return (
    (h.lockedUntil !== null && h.lockedUntil > now) ||
    h.failCount >= 3 ||
    h.neverSignedIn ||
    h.mustChangePassword
  );
}

/** حالةُ الدخول لعدّة بُرُد دفعةً واحدة.
 *
 *  دفعةً لا صفّاً صفّاً: قائمة الحسابات عشرات، واستعلامٌ لكل صفٍّ يُبطئ
 *  الصفحة بلا سبب — وهذه الصفحة بعينها يُشتكى من بطئها. */
export async function loginHealthFor(
  people: { email: string; mustChangePassword?: boolean; totpEnabled?: boolean; neverSignedIn?: boolean }[]
): Promise<Map<string, LoginHealth>> {
  const emails = people.map((p) => p.email.toLowerCase());
  const attempts = emails.length
    ? await prisma.loginAttempt.findMany({
        where: { identifier: { in: emails } },
        select: { identifier: true, failCount: true, lockedUntil: true },
      })
    : [];
  const byEmail = new Map(attempts.map((a) => [a.identifier.toLowerCase(), a]));

  const out = new Map<string, LoginHealth>();
  for (const p of people) {
    const key = p.email.toLowerCase();
    const a = byEmail.get(key);
    out.set(key, {
      lockedUntil: a?.lockedUntil ?? null,
      failCount: a?.failCount ?? 0,
      mustChangePassword: p.mustChangePassword ?? false,
      totpEnabled: p.totpEnabled ?? false,
      neverSignedIn: p.neverSignedIn ?? false,
    });
  }
  return out;
}
