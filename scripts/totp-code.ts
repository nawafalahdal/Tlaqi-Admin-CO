/** رمزُ TOTP الحاليّ لسرٍّ معطى — لفحوص المتصفّح على القاعدة المحلية وحدها.
 *  الاستعمال: npx tsx scripts/totp-code.ts <base32-secret> <email> */
import * as OTPAuth from "otpauth";
const [secret, email] = process.argv.slice(2);
const totp = new OTPAuth.TOTP({
  issuer: "تَـــلاقِ", label: email, algorithm: "SHA1", digits: 6, period: 30,
  secret: OTPAuth.Secret.fromBase32(secret),
});
console.log(totp.generate());
