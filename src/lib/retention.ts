import { prisma } from "@/lib/prisma";

/** ما يبقى في المنصة وما يُحال إلى الإكسل.
 *
 *  **المنصة شاشةُ عملٍ لا أرشيف.** التذاكر المغلقة تتراكم فتُبطئ كل
 *  قراءة وتُغرق القوائم بما انتهى، والسجلّات الكثيرة (البريد الصادر،
 *  رموز الدخول) تكبر بلا سقف. والإكسل مرجعٌ لا حدَّ له ولا يُبطئ أحداً
 *  — وكلُّ صفٍّ يُكتب فيه قبل أن يُمحى من هنا، فلا شيء يُفقَد.
 *
 *  ## لماذا السبت العاشرة مساءً؟
 *
 *  لأن الاجتماع الأسبوعي قبله: التذكرة المغلقة تبقى معروضةً أسبوعاً
 *  ليُراجَعها الفريق في اجتماعه، فإذا انتهى الاجتماع زالت من الشاشة
 *  وبقيت في الإكسل. والساعة بتوقيت الرياض لا بتوقيت الخادم — الخادم
 *  يعمل بـUTC، ولو حُسبت بساعته لاختفت الثالثة عصراً.
 *
 *  ## والاختفاء يقع بالقراءة لا بالكنس
 *
 *  خطة الاستضافة تسمح بكنسٍ واحدٍ يومياً، فلو انتظرنا الكنس لاختفت
 *  التذاكر صباح الأحد لا ليلة السبت. فالقاعدة تُطبَّق في **شرط
 *  القراءة**: ما تجاوز حدَّه لا يُعرَض من اللحظة نفسها بالدقيقة.
 *  والحذف الفعلي يقع لاحقاً حين يمرّ الكنس — فالشاشة صادقةٌ فوراً،
 *  والقاعدة تُنظَّف على مهل.
 */

/** فرق توقيت الرياض عن UTC — ثابتٌ لا صيفيَّ فيه */
const RIYADH_OFFSET_HOURS = 3;

/** يوم السبت في تقويم جافاسكربت (الأحد = ٠) */
const SATURDAY = 6;

/** ساعة الاختفاء بتوقيت الرياض — بعد الاجتماع الأسبوعي */
const CUTOFF_HOUR_RIYADH = 22;

/** كم تبقى التذكرة المغلقة معروضةً قبل أن تُحال إلى الإكسل */
export const TICKET_RETENTION_DAYS = 7;

/** كم يبقى سجلّ البريد في القاعدة — ونسخته في الإكسل دائمة */
export const EMAIL_LOG_RETENTION_DAYS = 30;

/** آخرُ «سبت ١٠ مساءً بتوقيت الرياض» وقع قبل اللحظة المعطاة.
 *
 *  تُحسَب بالنقل إلى توقيت الرياض ثم الرجوع — فلا تُقارَن ساعةٌ بساعةٍ
 *  من منطقتين. */
export function lastWeeklyCutoff(now: Date = new Date()): Date {
  const riyadh = new Date(now.getTime() + RIYADH_OFFSET_HOURS * 3600_000);
  const day = riyadh.getUTCDay();

  // كم يوماً مضى منذ آخر سبت؟ واليومُ نفسه يُحسَب سبتاً إن تجاوزت الساعة
  let daysSinceSaturday = (day - SATURDAY + 7) % 7;
  if (daysSinceSaturday === 0 && riyadh.getUTCHours() < CUTOFF_HOUR_RIYADH) {
    daysSinceSaturday = 7;
  }

  const cutoffRiyadh = new Date(
    Date.UTC(
      riyadh.getUTCFullYear(),
      riyadh.getUTCMonth(),
      riyadh.getUTCDate() - daysSinceSaturday,
      CUTOFF_HOUR_RIYADH,
      0,
      0,
      0
    )
  );
  return new Date(cutoffRiyadh.getTime() - RIYADH_OFFSET_HOURS * 3600_000);
}

/** التذكرةُ المغلقة قبل هذا الحدّ أُحيلت إلى الإكسل ولم تعد تُعرَض */
export function archivedTicketCutoff(now: Date = new Date()): Date {
  return new Date(lastWeeklyCutoff(now).getTime() - TICKET_RETENTION_DAYS * 86_400_000);
}

/** شرطُ «ما زالت تُعرَض» — يُضَمّ إلى كل استعلام تذاكر.
 *
 *  **والحوكمة لا تُؤرشَف.** التذكرة التي حُمِّلت طلبَ اعتماد سجلٌّ
 *  إداريٌّ يُرجَع إليه، لا رسالةَ عملٍ انتهت — فتبقى ما بقي الطلب.
 */
export function visibleTicketWhere(now: Date = new Date()) {
  return {
    OR: [
      // المفتوحة كلها
      { status: { not: "resolved" as const } },
      // والحوكمة تبقى
      { approvalState: { not: null } },
      // والمغلقة حديثاً — أو بلا تاريخ إغلاق مسجَّل
      { resolvedAt: null },
      { resolvedAt: { gt: archivedTicketCutoff(now) } },
    ],
  };
}

/** هل أُرشفت هذه التذكرة؟ — للصفحة المفردة التي تُفتح برقمها */
export function ticketIsArchived(
  ticket: { status: string; resolvedAt: Date | null; approvalState: string | null },
  now: Date = new Date()
): boolean {
  if (ticket.status !== "resolved") return false;
  if (ticket.approvalState) return false;
  if (!ticket.resolvedAt) return false;
  return ticket.resolvedAt <= archivedTicketCutoff(now);
}

/** يمحو من القاعدة ما أُحيل إلى الإكسل.
 *
 *  **ولا يُمحى صفٌّ لم يُكتب في الإكسل.** `sheetRow` فارغٌ يعني أن
 *  الكتابة لم تقع (الشيت معطَّل أو تعذّر الوصول) — فمحوُه حينئذٍ فقدٌ
 *  لا أرشفة. فيبقى معروضاً حتى يُكتب، ويُعاد في الكنس التالي.
 */
export async function purgeArchivedTickets(now: Date = new Date()): Promise<number> {
  const cutoff = archivedTicketCutoff(now);
  const { count } = await prisma.ticket.deleteMany({
    where: {
      status: "resolved",
      approvalState: null,
      resolvedAt: { lte: cutoff },
      sheetRow: { not: null },
    },
  });
  return count;
}

/** سجلّ البريد: نسخةٌ في الإكسل دائمة، وفي القاعدة شهرٌ يكفي للمراجعة */
export async function purgeOldEmailLogs(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EMAIL_LOG_RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.emailLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}

/** ما سيختفي في موعد السبت القادم — ليُقال للفريق قبل أن يقع.
 *
 *  الاختفاء بلا إنذارٍ يُقرأ عطباً: «أين تذاكري؟». فتُعَدّ المغلقة التي
 *  يحلّ أجلُها في الموعد القادم ويُكتَب عددُها في اللوحة. */
export async function ticketsLeavingNextCutoff(now: Date = new Date()): Promise<number> {
  const nextCutoff = new Date(lastWeeklyCutoff(now).getTime() + 7 * 86_400_000);
  return prisma.ticket.count({
    where: {
      status: "resolved",
      approvalState: null,
      resolvedAt: {
        gt: archivedTicketCutoff(now),
        lte: new Date(nextCutoff.getTime() - TICKET_RETENTION_DAYS * 86_400_000),
      },
    },
  });
}
