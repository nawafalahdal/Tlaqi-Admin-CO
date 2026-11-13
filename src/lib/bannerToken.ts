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

/** رابطُ صورة المشاركة — ملصق الدعوة أو بطاقة العضوية.
 *
 *  `v` ختمُ الإصدار: الصورة تُخزَّن سنةً، فإن تغيّر الاسم أو القسم بعدها
 *  حمل البريدُ التالي رابطاً جديداً ولم يُعرَض القديم. */
export function shareCardUrl(
  type: "invite" | "welcome" | "business",
  subject: BannerSubject,
  base: string,
  /** تاريخٌ، أو بصمةُ ما يُرسم في البطاقة (`cardFingerprint`) — فلا يتغيّر الرابطُ إلا إن تغيّرت البطاقة */
  version: Date | string = new Date()
): string {
  const v = typeof version === "string" ? version : version.getTime().toString(36);
  return `${base}/api/cards/${type}/${signBannerToken(subject)}?v=${encodeURIComponent(v)}`;
}

/** بصمةٌ قصيرةٌ لما يُرسم في البطاقة: تتغيّر إن تغيّر الاسمُ أو المسمّى أو القسمُ أو لونُه — فتُخزَّن الصورةُ سنةً
 *  ولا يُعرض القديمُ بعد تعديل (صفحةُ «بطاقتي» تُفتح مراراً، فلا يُعاد رسمُها في كل زيارة) */
export function cardFingerprint(parts: (string | null | undefined)[]): string {
  let h = 2166136261;
  for (const ch of parts.map((x) => x ?? "").join("|")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
