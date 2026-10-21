/** تنسيق تاريخ ميلادي ثابت — يفرض التقويم الغريغوري والأرقام اللاتينية صراحةً:
 *  - التقويم: لتفادي اختلاف الافتراضي (هجري/ميلادي) بين Node على الخادم
 *    والمتصفح، وهو ما يسبب عدم تطابق Hydration.
 *  - النسق (en-GB بأرقام لاتينية، يوم/شهر/سنة): ناتج واحد في الواجهتين
 *    العربية والإنجليزية، بلا علامات اتجاه مخفية تشوّه الصفحة الإنجليزية. */
export function formatDate(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** المدّة منذ تاريخٍ بكلمات: «منذ ٣ أشهر»، «منذ سنتين» — للسجلّ والملف */
export function sinceLabel(d: Date, now: Date = new Date(), locale: "ar" | "en" = "ar"): string {
  const months = Math.floor((now.getTime() - d.getTime()) / (30.44 * 86_400_000));
  // الإنجليزيةُ بلا مثنّى: صيغتان تكفيان (مثل `dayCount`)
  if (locale === "en") {
    if (months < 1) return "Less than a month";
    if (months < 12) return months === 1 ? "1 month" : `${months} months`;
    const years = Math.floor(months / 12);
    return years === 1 ? "1 year" : `${years} years`;
  }
  if (months < 1) return "أقل من شهر";
  if (months < 12) return months === 1 ? "منذ شهر" : months === 2 ? "منذ شهرين" : `منذ ${months} أشهر`;
  const y = Math.floor(months / 12);
  return y === 1 ? "منذ سنة" : y === 2 ? "منذ سنتين" : `منذ ${y} سنوات`;
}
