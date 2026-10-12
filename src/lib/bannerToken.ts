import crypto from "crypto";

/** توقيع رابط اللوحة الترحيبية.
 *
 *  اللوحة تحمل اسم صاحبها ومسمّاه وقسمه، وتُفتح بلا تسجيل دخول — لأن
 *  عميل البريد لا يحمل جلسة. فلو كان الرابط بالمعرّف وحده لأمكن تخمينُ
 *  معرّفٍ وقراءةُ بيانات صاحبه من صورةٍ مفتوحة. والتوقيع يربط الرابط
 *  بصاحبه: لا يُفتح إلا بما وُقِّع له.
 *
 *  وهو منفصلٌ عن توقيع الشهادة عمداً: رسالةٌ مختلفة في الـHMAC، فرابطُ
 *  لوحةٍ لا يُفتح به سجلُّ شهادة ولا العكس. */
function bannerSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET غير مضبوط — لا يمكن توقيع رابط اللوحة");
  return secret;
}

export type BannerSubject = { kind: "member" | "user"; id: string };

export function signBannerToken(subject: BannerSubject): string {
  const mac = crypto
    .createHmac("sha256", bannerSecret())
    .update(`welcome-banner:${subject.kind}:${subject.id}`)
    .digest("base64url");
  return `${subject.kind}.${subject.id}.${mac}`;
}

export function verifyBannerToken(token: string): BannerSubject | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [kind, id] = parts;
  if (kind !== "member" && kind !== "user") return null;

  const subject: BannerSubject = { kind, id };
  const expected = signBannerToken(subject);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  // المقارنة ثابتة الزمن: المقارنة العادية تُسرّب طول البادئة الصحيحة
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return subject;
}

export function bannerUrl(subject: BannerSubject, base: string): string {
  return `${base}/api/welcome-banner/${signBannerToken(subject)}`;
}
