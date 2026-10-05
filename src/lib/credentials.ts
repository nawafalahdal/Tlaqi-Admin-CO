import crypto from "crypto";
import bcrypt from "bcryptjs";

/** كلمة مرور مؤقتة عشوائية قوية بما يكفي، يسهل نسخها ونقلها (بلا رموز ملتبسة) */
export function generateTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}
