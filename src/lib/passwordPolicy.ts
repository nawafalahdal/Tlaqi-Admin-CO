/** شروط كلمة المرور — تُكتب مرة واحدة وتُفرض في كل مسار يضع كلمة مرور.
 *
 *  كانت الشروط سطراً واحداً («٨ أحرف») في موضعين منفصلين، فلا هي قويّة
 *  ولا هي معروفة لمن يكتبها: يُرفض إدخاله دون أن يُقال له لماذا. القاعدة
 *  هنا واحدة، والواجهة تعرضها قبل الكتابة لا بعد الرفض. */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRuleId = "length" | "lower" | "upper" | "digit" | "symbol";

export const PASSWORD_RULES: { id: PasswordRuleId; test: (v: string) => boolean }[] = [
  { id: "length", test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { id: "lower", test: (v) => /[a-z]/.test(v) },
  { id: "upper", test: (v) => /[A-Z]/.test(v) },
  { id: "digit", test: (v) => /[0-9]/.test(v) },
  // أي محرف ليس حرفاً لاتينياً ولا رقماً ولا مسافة — يشمل الرموز كلها
  { id: "symbol", test: (v) => /[^A-Za-z0-9\s]/.test(v) },
];

/** أي الشروط تحقّق وأيها لم يتحقّق — تستعمله الواجهة للعرض الحيّ */
export function passwordRuleStates(value: string): Record<PasswordRuleId, boolean> {
  return PASSWORD_RULES.reduce(
    (acc, r) => ({ ...acc, [r.id]: r.test(value) }),
    {} as Record<PasswordRuleId, boolean>
  );
}

export function isPasswordStrong(value: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(value));
}

/** رسالة الرفض تُسمّي ما نقص بالضبط بدل «كلمة المرور ضعيفة».
 *  يُستدعى في الخادم؛ النصوص عربية لأنها رسائل أخطاء مباشرة كبقية
 *  رسائل الإجراءات في هذا المشروع. */
export function passwordProblem(value: string): string | null {
  const missing: string[] = [];
  if (value.length < PASSWORD_MIN_LENGTH) missing.push(`${PASSWORD_MIN_LENGTH} خانات على الأقل`);
  if (!/[a-z]/.test(value)) missing.push("حرف لاتيني صغير (a-z)");
  if (!/[A-Z]/.test(value)) missing.push("حرف لاتيني كبير (A-Z)");
  if (!/[0-9]/.test(value)) missing.push("رقم (0-9)");
  if (!/[^A-Za-z0-9\s]/.test(value)) missing.push("رمز (مثل ! أو # أو @)");
  if (missing.length === 0) return null;
  return `كلمة المرور ينقصها: ${missing.join("، ")}.`;
}
