/** حسابُ الوقت بتوقيت الرياض — موضعٌ واحدٌ لا موضعان.
 *
 *  **ولماذا وحدةٌ مستقلّة؟** لأن المنصة تَحسب بالرياض في موضعين على
 *  الأقل: حدُّ الأرشفة الأسبوعية، وفتراتُ التنفيذ واجتماعُها. ومنطقُ
 *  المناطق الزمنية إن كُرِّر انحرف: يُصلَح في أحدهما ويبقى الآخر على
 *  خطئه — والخطأُ هنا يُزيح يوماً كاملاً.
 *
 *  والخادم يعمل بـUTC، فلا تُقارَن ساعةٌ بساعةٍ من منطقتين: يُنقَل
 *  الوقت إلى الرياض، ويُحسَب فيه، ثم يُردّ إلى UTC.
 *
 *  **ولا ساعةَ صيفيةٍ في السعودية** — فالفارقُ ثابتٌ ثلاثُ ساعات، وهذه
 *  هي العلّة التي تُجيز الحسابَ بالإزاحة بدل مكتبةِ مناطق. ولو تغيّر
 *  ذلك يوماً فالتغييرُ هنا وحدَه.
 */

/** فرق توقيت الرياض عن UTC — ثابتٌ لا صيفيَّ فيه */
export const RIYADH_OFFSET_HOURS = 3;
export const RIYADH_TZ = "Asia/Riyadh";

/** السبت في تقويم جافاسكربت (الأحد = ٠) */
export const SATURDAY = 6;

/** نفسُ اللحظة منقولةً إلى «ساعة الرياض» — تُقرأ بدوالّ UTC */
export function toRiyadh(at: Date): Date {
  return new Date(at.getTime() + RIYADH_OFFSET_HOURS * 3600_000);
}

/** العكس: لحظةٌ بُنيت بأرقام الرياض تُردّ إلى UTC */
export function fromRiyadhParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - RIYADH_OFFSET_HOURS * 3600_000);
}

/** آخرُ لحظةٍ بلغ فيها يومُ الأسبوع وساعتُه المطلوبان — قبل `now`.
 *
 *  تُستعمَل لحدِّ الأرشفة ولبداية فترة التنفيذ معاً: كلاهما «آخر سبتٍ
 *  عند ساعةٍ بعينها». */
export function lastWeekdayAt(
  weekday: number,
  hour: number,
  minute = 0,
  now: Date = new Date()
): Date {
  const riyadh = toRiyadh(now);
  const day = riyadh.getUTCDay();

  let daysSince = (day - weekday + 7) % 7;
  if (daysSince === 0) {
    const minutesNow = riyadh.getUTCHours() * 60 + riyadh.getUTCMinutes();
    if (minutesNow < hour * 60 + minute) daysSince = 7;
  }

  return fromRiyadhParts(
    riyadh.getUTCFullYear(),
    riyadh.getUTCMonth(),
    riyadh.getUTCDate() - daysSince,
    hour,
    minute
  );
}

/** أولُ لحظةٍ قادمةٍ بلغ فيها يومُ الأسبوع وساعتُه — بعد `now` */
export function nextWeekdayAt(
  weekday: number,
  hour: number,
  minute = 0,
  now: Date = new Date()
): Date {
  const last = lastWeekdayAt(weekday, hour, minute, now);
  return new Date(last.getTime() + 7 * 86_400_000);
}

/** بدايةُ يومٍ بتوقيت الرياض — منتصفُ ليله لا منتصفُ ليل UTC */
export function startOfRiyadhDay(at: Date = new Date()): Date {
  const r = toRiyadh(at);
  return fromRiyadhParts(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate());
}

/** التاريخُ كما يُكتَب في الرياض: `2026-10-15` — لا بإزاحة الخادم */
export function riyadhDateKey(at: Date): string {
  const r = toRiyadh(at);
  const m = String(r.getUTCMonth() + 1).padStart(2, "0");
  const d = String(r.getUTCDate()).padStart(2, "0");
  return `${r.getUTCFullYear()}-${m}-${d}`;
}

/** فرقُ الأيام بالتقويم لا بالساعات.
 *
 *  **والفرقُ بينهما يقع فعلاً:** مهمّةٌ موعدُها غداً الثامنةَ صباحاً
 *  وقد مضى من اليوم ساعةٌ واحدة — الفرقُ بالساعات أقلُّ من يوم،
 *  فيُقال «موعدُها اليوم» وهو غداً. فالعدُّ على حدود الأيام في الرياض. */
export function riyadhDaysBetween(from: Date, to: Date): number {
  const a = startOfRiyadhDay(from).getTime();
  const b = startOfRiyadhDay(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** عدُّ الأيام كما يُقرأ: «بقي ١٢ يوماً»، «يستحقّ غداً»، «متأخّرٌ ٣ أيام» */
export function countdownLabel(due: Date, now: Date = new Date(), locale: "ar" | "en" = "ar"): string {
  const days = riyadhDaysBetween(now, due);
  if (locale === "en") {
    if (days === 0) return "Due today";
    if (days === 1) return "Due tomorrow";
    if (days === -1) return "1 day late";
    if (days > 0) {
      if (days < 30) return `In ${days} days`;
      const months = Math.round(days / 30);
      return months === 1 ? "In 1 month" : `In ${months} months`;
    }
    return `${Math.abs(days)} days late`;
  }
  if (days === 0) return "يستحقّ اليوم";
  if (days === 1) return "يستحقّ غداً";
  if (days === -1) return "متأخّرٌ يوماً";
  if (days === 2) return "بعد يومين";
  if (days === -2) return "متأخّرٌ يومين";
  if (days > 0) {
    if (days <= 10) return `بعد ${days} أيام`;
    if (days < 30) return `بعد ${days} يوماً`;
    const months = Math.round(days / 30);
    return months === 1 ? "بعد شهر" : months === 2 ? "بعد شهرين" : `بعد ${months} أشهر`;
  }
  const late = Math.abs(days);
  return late <= 10 ? `متأخّرٌ ${late} أيام` : `متأخّرٌ ${late} يوماً`;
}
