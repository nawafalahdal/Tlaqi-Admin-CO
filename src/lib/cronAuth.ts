import { createHash, timingSafeEqual } from "node:crypto";

/** نتيجةُ فحص طلب الكنس المجدول — ثلاثٌ لا اثنتان.
 *
 *  `unconfigured` ليست «مسموحاً»: هي إعدادٌ ناقص يُرفض ويُسجَّل، حتى لا
 *  يُفهَم غيابُ المفتاح إذناً للجميع. */
export type CronAuthResult = "ok" | "unconfigured" | "unauthorized";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** **يُغلق عند الشكّ.** كان المسار يفحص المفتاح إن وُجد، فإن غاب من بيئة
 *  النشر صار الكنسُ — بتذكيراته وإنهاءاته ومحوِ ما انقضت مدّتُه — مفتوحاً
 *  لكل من يعرف العنوان. والآن: لا مفتاح ⇐ لا تشغيل.
 *
 *  والمقارنةُ بزمنٍ ثابت على بصمتَين متساويتَي الطول، فلا يُستدَلّ على
 *  المفتاح حرفاً حرفاً من زمن الرفض. وهو ما يرسله Vercel Cron بنفسه:
 *  `Authorization: Bearer <CRON_SECRET>`. */
export function cronAuthorization(
  header: string | null,
  secret: string | undefined = process.env.CRON_SECRET
): CronAuthResult {
  if (!secret?.trim()) return "unconfigured";
  if (!header) return "unauthorized";
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`)) ? "ok" : "unauthorized";
}
