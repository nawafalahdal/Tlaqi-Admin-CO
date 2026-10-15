/** رابطُ الصورة الشخصية — موضعٌ واحدٌ يَبنيه، والعميلُ يَستورده.
 *
 *  **لا استيرادَ لخادمٍ هنا بقصد.** هذا الملفّ يَدخل حزمةَ المتصفّح مع
 *  البطاقات، فلو جرّ `@/lib/prisma` أو `sharp` لسَقط البناء — وقد سقط من
 *  قبلُ حين استورد مكوّنٌ عميلٌ ثوابتَ `@/lib/plans` فجرَّت `googleapis`
 *  إلى المتصفّح. فالصيغةُ وحدها هنا، والقراءةُ هناك.
 */

export type AvatarKind = "member" | "user";

/** رابطُ صورةِ فلان، أو `null` إن لم يرفع صورة.
 *
 *  والختمُ جزءٌ من الرابط لا ترويسةٌ على جانبه: به يَصلح الجوابُ
 *  للتخزين الأبديّ في المتصفّح (`immutable`) — ومتى استُبدلت الصورة
 *  تغيّر الختمُ فتغيّر الرابط، فطُلبت الجديدةُ بلا إبطالِ مخزَنٍ ولا
 *  انتظارِ انتهاءِ مدّة. */
export function avatarUrl(
  kind: AvatarKind,
  id: string,
  version: Date | string | null | undefined
): string | null {
  if (!version) return null;
  const stamp = typeof version === "string" ? version : version.toISOString();
  return `/api/avatar/${kind}/${encodeURIComponent(id)}?v=${encodeURIComponent(stamp)}`;
}
