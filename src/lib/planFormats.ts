/** حدودُ الملفّات وأنواعُها — وحدَها بلا أيِّ استيرادٍ خادمي.
 *
 *  **ولهذا الملفُّ سببٌ لا ترفٌ في التقسيم:** نموذجُ الرفع مكوّنٌ عميل،
 *  وهو يحتاج الحدَّ وقائمةَ الأنواع ليَفرضهما قبل الإرسال. ولو قرأهما
 *  من `@/lib/plans` لَسُحِبت معه سلسلةُ استيراداتها — سجلُّ Google
 *  Sheets ومكتبةُ اعتماده — إلى حزمة المتصفّح، فيفشل البناء على
 *  `child_process`. (وقد فشل فعلاً: خمسةَ عشرَ خطأً من وحدةٍ واحدة.)
 *
 *  فالقاعدة: ما يُشارَك بين الخادم والعميل يُفرَد في وحدةٍ لا تستورد
 *  شيئاً.
 */

/** حدُّ حجم الملف الواحد.
 *
 *  أكبرُ من هذا لا يمرّ أصلاً: حدُّ جسم الإجراء الخادمي ثمانيةُ
 *  ميغابايت، فالملفُّ الأكبر يُرفَض قبل أن يبلغ الإجراء فلا تظهر
 *  لصاحبه رسالةٌ مفهومة. فالحدُّ هنا أقلُّ منه قليلاً ليُرفَض **داخل**
 *  الإجراء برسالةٍ تُسمّي السبب والحجم. ومن كان ملفُّه أكبر فله الرابط. */
export const MAX_PLAN_FILE_BYTES = 7 * 1024 * 1024;

/** أنواعُ الملفّات المقبولة — قائمةُ سماحٍ لا قائمةَ منع.
 *
 *  **ولا HTML ولا SVG فيها عمداً:** كلاهما يحمل سكربتاً يُنفَّذ في
 *  أصل المنصة نفسِه إن فُتح في المتصفح، فيصير رفعُ ملفٍّ باباً إلى
 *  جلسة من يفتحه. والقائمةُ تُقرأ مع `nosniff` في مسار التنزيل:
 *  النوعُ المُعلَن هو النوعُ المُطبَّق، فلا يُخمِّن المتصفحُ غيرَه. */
export const ALLOWED_PLAN_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "صورة PNG",
  "image/jpeg": "صورة JPEG",
  "image/webp": "صورة WebP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "مستند Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "جدول Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "عرض PowerPoint",
  "text/plain": "نصّ",
  "text/csv": "جدول CSV",
};

/** تُفتَح داخل المتصفح، وما عداها يُنزَّل.
 *
 *  والـPDF تحديداً هي أكثرُ ما يُرفَع هنا، وفتحُها في تبويبٍ أسهل من
 *  تنزيلها ثم فتحها. أما مستنداتُ أوفيس فلا يَعرضها المتصفح أصلاً. */
export const INLINE_PLAN_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** حجمٌ يُقرأ: «٢٫٤ ميغابايت» لا «2516582» */
export function humanSize(bytes: number | null, locale: "ar" | "en" = "ar"): string {
  if (!bytes || bytes <= 0) return "—";
  if (locale === "en") {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} كيلوبايت`;
  return `${(bytes / 1048576).toFixed(1)} ميغابايت`;
}

/** اسمُ النوع بالعربية — لا وسمُ MIME خاماً في الواجهة */
export function typeLabel(mimeType: string | null, locale: "ar" | "en" = "ar"): string {
  if (locale === "en") return (mimeType && PLAN_TYPES_EN[mimeType]) || "File";
  if (!mimeType) return "ملف";
  return ALLOWED_PLAN_TYPES[mimeType] ?? "ملف";
}

/** أسماءُ الأنواع بالإنجليزية — للواجهة الإنجليزية وحدها، والمفاتيحُ مفاتيحُ `ALLOWED_PLAN_TYPES` */
const PLAN_TYPES_EN: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
  "image/webp": "WebP image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel spreadsheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint presentation",
  "text/plain": "Text",
  "text/csv": "CSV table",
};
