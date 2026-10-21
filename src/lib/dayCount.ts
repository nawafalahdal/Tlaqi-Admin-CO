/** عددُ الأيام بصيغته الصحيحة — «٧ أيام» لا «٧ يوماً».
 *
 *  التمييزُ في العربية يتبع العدد: يومٌ ويومان، ثم «أيام» من الثلاثة إلى
 *  العشرة، ثم «يوماً» فما بعدها. وحدةٌ نقيّةٌ بلا قاعدة، فتُقرأ في المتصفّح
 *  والخادم معاً. */
export function dayCount(n: number, locale: "ar" | "en" = "ar"): string {
  const d = Math.max(0, Math.floor(n));
  if (locale === "en") return d === 1 ? "1 day" : `${d} days`;
  if (d === 0) return "أقل من يوم";
  if (d === 1) return "يومٌ واحد";
  if (d === 2) return "يومان";
  if (d <= 10) return `${d} أيام`;
  return `${d} يوماً`;
}
