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
