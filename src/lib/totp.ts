import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const ISSUER = "تَـــلاقِ";

/** يولّد سرّاً عشوائياً جديداً (base32) لحساب إداري لم يفعّل التحقق بخطوتين بعد */
export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function buildTotp(secret: string, email: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/** يُنتج رابط otpauth:// وصورة QR (data URL) لمسح الرمز بتطبيق المصادقة */
export async function buildTotpEnrollment(secret: string, email: string) {
  const totp = buildTotp(secret, email);
  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri, { width: 240, margin: 1 });
  return { uri, qrDataUrl };
}

/** يتحقق من رمز مكوّن من 6 أرقام بهامش دقيقة واحدة (قبل/بعد) لتفاوت الساعة */
export function verifyTotpCode(secret: string, code: string, email: string): boolean {
  const totp = buildTotp(secret, email);
  const delta = totp.validate({ token: code.trim(), window: 1 });
  return delta !== null;
}
