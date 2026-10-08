import crypto from "crypto";
import bcrypt from "bcryptjs";
import { isPasswordStrong } from "@/lib/passwordPolicy";

/** محرف عشوائي من مجموعة، بتوزيع متساوٍ.
 *
 *  `% length` وحده ينحاز للأوائل حين لا تقسم 256 على طول المجموعة، فتُرفض
 *  البايتات الزائدة بدل أن يُسحب الاحتمال نحو أوّل الحروف. */
function pick(set: string): string {
  const limit = Math.floor(256 / set.length) * set.length;
  for (;;) {
    const b = crypto.randomBytes(1)[0];
    if (b < limit) return set[b % set.length];
  }
}

function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/** كلمة مرور مؤقتة تستوفي شروط المنصة نفسها.
 *
 *  كانت تُولَّد من حروف وأرقام فقط، فصارت — بعد تشديد الشروط — كلمةً
 *  يُصدرها النظام ثم يرفضها حين يُعاد إدخالها. فتُبنى الآن بضمان وجود
 *  كل صنف مطلوب: صغير وكبير ورقم ورمز، والباقي عشوائي.
 *
 *  والرموز الملتبسة مستبعدة (O/0، l/1، I) لأن هذه الكلمة تُقرأ وتُنقل
 *  يدوياً، وخطأُ قراءةٍ واحد يُحسب محاولة دخول فاشلة على صاحبها. */
export function generateTempPassword(): string {
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%*?";
  const all = lower + upper + digits + symbols;

  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));

  const out = shuffle(chars).join("");
  // حزامٌ وحمّالة: لو تغيّرت الشروط يوماً ولم يُحدَّث هذا المولّد، يُعاد
  // التوليد بدل أن يُصدر النظام كلمةً يرفضها هو نفسه
  return isPasswordStrong(out) ? out : generateTempPassword();
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}
