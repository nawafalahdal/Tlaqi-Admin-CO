import { BRAND } from "@/lib/brand";
import { contrastRatio } from "@/lib/colors";
import { anniversaryDate, monthsCompleted } from "@/lib/anniversary";

/** ألوانُ الشهادة ومدّتُها — بلا قاعدةٍ ولا خادم، فتُستعمل في الصفحة المطبوعة
 *  وفي معاينة «الترحيب والتكريم» الحيّة في المتصفّح معاً، فلا تفترقان. */

/** ورقُ الشهادة — لونُها الحالي، لا لونٌ جديد */
export const CERTIFICATE_PAPER = "#FFFDF9";

const HEX6 = /^#[0-9a-f]{6}$/i;

/** حبرُ ما يُكتب فوق خلفيةٍ ما: من لونَي الهوية (Temptress الداكن، Beige الفاتح)
 *  الأعلى تبايناً معها (WCAG). به يُلوَّن التوقيع بحسب **خلفية منطقته** لا لون
 *  الشهادة العام — وبه يُلوَّن الرمزُ فوق الختم. */
export function inkForBackground(bg: string): string {
  if (!HEX6.test(bg)) return BRAND.temptress;
  return contrastRatio(BRAND.temptress, bg) >= contrastRatio(BRAND.beige, bg) ? BRAND.temptress : BRAND.beige;
}

/** ألوانُ «الإطار الكلاسيكي» المعتمد، مشتقّةً من لون القسم.
 *
 *  الإطارُ والختمُ بلون القسم — إلا لوناً يذوب في الورق (بيجُ الموارد البشرية)
 *  فيأخذ Temptress كما كانت الشهادة السابقة تفعل. وعنوانُ الشهادة بلون القسم
 *  إن قُرئ على الورق (٣:١ فأكثر)، وإلا Temptress: الأخضرُ إطارٌ ظاهر لكنه
 *  نصٌّ باهت. والتوقيعُ على الورق، فحبرُه حبرُ الورق. */
export function certificateFrame(colorHex: string | null | undefined) {
  const c = colorHex?.trim() && HEX6.test(colorHex.trim()) ? colorHex.trim() : BRAND.temptress;
  const onPaper = contrastRatio(c, CERTIFICATE_PAPER);
  const frame = onPaper < 1.5 ? BRAND.temptress : c;
  return {
    paper: CERTIFICATE_PAPER,
    ink: BRAND.temptress,
    frame,
    accent: onPaper < 3 ? BRAND.temptress : c,
    sealInk: inkForBackground(frame),
    signatureInk: inkForBackground(CERTIFICATE_PAPER),
  };
}

const AR_NUM = new Intl.NumberFormat("ar-u-nu-arab");

/** عددٌ ومعدودُه بقواعد العربية: «شهر واحد»، «شهران»، «٤ أشهر»، «١٢ شهراً» */
function counted(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${AR_NUM.format(n)} ${n >= 3 && n <= 10 ? few : many}`;
}

/** مدّةُ المشاركة كما تُكتب على الشهادة: أشهرٌ تقويمية مكتملة (بتوقيت المنظمة) ثم أيام.
 *  «٣ أشهر»، «٤ أشهر و١٢ يوماً»، «١٨ يوماً». */
export function serviceDurationAr(start: Date, end: Date): string {
  if (end.getTime() <= start.getTime()) return "أقل من يوم";
  const months = monthsCompleted(start, end);
  const from = months > 0 ? anniversaryDate(start, months) : start;
  const days = Math.max(0, Math.floor((end.getTime() - from.getTime()) / 86_400_000));
  if (months === 0 && days === 0) return "أقل من يوم";
  const parts: string[] = [];
  if (months > 0) parts.push(counted(months, "شهر واحد", "شهران", "أشهر", "شهراً"));
  if (days > 0) parts.push(counted(days, "يوم واحد", "يومان", "أيام", "يوماً"));
  return parts.join(" و");
}
