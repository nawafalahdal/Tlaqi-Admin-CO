/** يُعيد رسالة الخطأ فقط إذا كانت خطأً مقصوداً أطلقناه نحن (throw new Error("..."))
 *  — يُميَّز بامتلاكه name="Error" الافتراضي. أي خطأ آخر (Prisma، شبكة، إلخ) قد
 *  يحمل تفاصيل داخلية (أسماء أعمدة/قيود قاعدة البيانات) فلا يُعرض للمستخدم؛
 *  يُسجَّل في سجل الخادم فقط وتُعاد رسالة عامة بدلاً منه. */
export function safeErrorMessage(err: unknown, fallback = "حدث خطأ غير متوقع"): string {
  if (err instanceof Error && err.name === "Error") return err.message;
  console.error(err);
  return fallback;
}
