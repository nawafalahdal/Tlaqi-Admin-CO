/** حساب الأشهر المكتملة — بالتقويم لا بتسعين يوماً.
 *
 *  «ثلاثة أشهر» في العربية والعرف ثلاثةُ أشهر تقويمية: من ١٥ يناير إلى
 *  ١٥ أبريل. وتقريبُها بتسعين يوماً يُخطئ في كل سنة: من انضمّ ١٥ يناير
 *  يستحقّ في ١٥ أبريل (٩٠ يوماً في السنة العادية، ٩١ في الكبيسة)، ومن
 *  انضمّ ١٥ نوفمبر يستحقّ في ١٥ فبراير — وبينهما ٩٢ يوماً. فمن يحسب
 *  بالتسعين يُكرّم بعضهم قبل أوانه وبعضهم بعده.
 *
 *  وآخر الشهر حالةٌ لا تُترك للاحتمال: من انضمّ ٣١ نوفمبر لا وجود له،
 *  ومن انضمّ ٣١ ديسمبر لا يوجد له ٣١ مارس؟ بل يوجد. لكن من انضمّ ٣١
 *  يناير لا يوجد له ٣١ أبريل. فيُثبَّت على آخر يومٍ في الشهر الهدف:
 *  ٣٠ أبريل. وإلا انزلق إلى ١ مايو (كما يفعل `setMonth` وحده) فتأخّر
 *  استحقاقُه يوماً بلا سبب.
 *
 *  والتوقيت توقيت المنظمة لا توقيت الخادم: الخادم في `iad1` ومن يقرأ
 *  في الرياض. فلو حُسب اليوم بتوقيت الخادم لاستحقّ أحدهم «غداً» وهو
 *  اليوم عنده.
 */

/** المنطقة الزمنية الرسمية للمنظمة */
export const ORG_TIME_ZONE = process.env.ORG_TIME_ZONE || "Asia/Riyadh";

/** اليوم في تقويم المنظمة — سنةً وشهراً ويوماً، لا لحظةً */
export function orgCalendarDate(at: Date): { year: number; month: number; day: number } {
  // `en-CA` يعطي YYYY-MM-DD، وهي الصيغة الوحيدة التي تُقرأ بلا لبس
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ORG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const [year, month, day] = parts.split("-").map(Number);
  return { year, month, day };
}

/** عدد أيام شهرٍ بعينه — لتثبيت آخر الشهر بدل الانزلاق إلى الذي بعده */
function daysInMonth(year: number, month: number): number {
  // اليوم «صفر» من الشهر التالي هو آخر يومٍ من هذا الشهر
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** الأشهر التقويمية المكتملة بين تاريخين، بتوقيت المنظمة.
 *
 *  «مكتمل» تعني أن يوم الاستحقاق قد حلّ أو مضى — لا أن الشهر قد بدأ. */
export function monthsCompleted(start: Date, now: Date): number {
  const s = orgCalendarDate(start);
  const n = orgCalendarDate(now);
  let months = (n.year - s.year) * 12 + (n.month - s.month);
  // لم يَحِن يومُه في هذا الشهر بعد، فالشهر الأخير غير مكتمل
  const dueDay = Math.min(s.day, daysInMonth(n.year, n.month));
  if (n.day < dueDay) months -= 1;
  return Math.max(0, months);
}

/** تاريخ استحقاق الذكرى بعد `months` شهراً من البداية.
 *
 *  يُرجَع كـ`Date` عند منتصف نهار المنطقة تقريباً، فلا يتأرجح حول
 *  منتصف الليل بتحوّلات التوقيت. */
export function anniversaryDate(start: Date, months: number): Date {
  const s = orgCalendarDate(start);
  const total = s.month - 1 + months;
  const year = s.year + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(s.day, daysInMonth(year, month));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** هل أكمل ثلاثة أشهر تقويمية؟ */
export function completedThreeMonths(start: Date, now: Date = new Date()): boolean {
  return monthsCompleted(start, now) >= 3;
}
