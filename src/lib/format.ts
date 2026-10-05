/** تنسيق تاريخ ميلادي ثابت بالعربي — يفرض التقويم الغريغوري صراحة لتفادي اختلاف
 *  التقويم الافتراضي (هجري/ميلادي) بين محرك Node على الخادم ومحرك المتصفح،
 *  والذي يسبب عدم تطابق Hydration عند استخدام toLocaleDateString("ar-SA") مباشرة. */
export function formatDate(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
