import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** **ربطُ الجلسة بالمتصفّح الذي فتحها — ما يجعل الخروجَ خروجاً.**
 *
 *  الجلسةُ توكنٌ موقَّعٌ في كعكة، و`updateAge: 0` يُعيد إصدارها مع كل ردٍّ من
 *  مسارٍ محروس (هكذا تُقاس الساعتان من آخر نشاط). فطلبٌ بدأ قبل الخروج ووصل
 *  ردُّه بعده يُعيد التوكنَ القديم إلى المتصفّح — وهو ما زال صالحَ التوقيع:
 *  الصفحةُ تذهب إلى الدخول والحسابُ باقٍ مفتوحاً. ولا يمنعه إيقافُ الجلب
 *  المسبق وحده: أيُّ طلبٍ في الطريق لحظةَ الخروج يفعل الشيءَ نفسه.
 *
 *  **العلاج:** عند الدخول تُولَّد قيمةٌ عشوائية تُحفظ في كعكةٍ ثانية لا تُكتب
 *  إلا مرّةً واحدة، ويحمل التوكنُ بصمتَها لا هي. وكلُّ قراءةٍ للجلسة (حارسُ
 *  المسارات، والصفحات، والإجراءات، ومسارات الـAPI) تشترط أن تطابق الكعكةُ
 *  البصمة. والخروجُ يمحو الكعكة — والردُّ المتأخر يُعيد كعكةَ Auth.js وحدها،
 *  فيعود توكنٌ لا قيمةَ له: لا يطابق شيئاً، ولا يُستعاد باليد لأن القيمةَ
 *  نفسها لم تَعُد في المتصفّح.
 *
 *  بلا ترحيل: الربطُ كلُّه في كعكتين — لا جدولَ ولا عمود. */

/** `__Host-` على HTTPS: لا تُكتب إلا من الموقع نفسه وبمسار `/` وبلا نطاق،
 *  فلا يُبدّلها نطاقٌ فرعيّ. ومحلياً (HTTP) اسمٌ عاديٌّ بلا بادئة. */
const SECURE =
  process.env.VERCEL === "1" || /^https:/.test(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "");
export const SESSION_BINDING_COOKIE = SECURE ? "__Host-tlaqi.sid" : "tlaqi.sid";

/** أقصى عمرٍ للكعكة: سقفُ الجلسة نفسه (`maxAge` في `auth.ts`) */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

/** عند الدخول: كعكةُ الربط تُكتب، والبصمةُ تعود لتُحفظ في التوكن.
 *  تُستدعى من `jwt` حين يحضر `user` — أي في إجراء الدخول أو مسار
 *  `/api/auth/callback`، وكلاهما يملك كتابةَ الكعكات. */
export async function issueSessionBinding(): Promise<string> {
  const value = randomBytes(32).toString("base64url");
  (await cookies()).set(SESSION_BINDING_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return fingerprint(value);
}

/** هل في هذا الطلب كعكةُ الربط التي تطابق بصمةَ التوكن؟
 *  والتوكنُ بلا بصمة (صدر قبل هذا الربط) لا يُقبل: خروجٌ واحدٌ عند النشر
 *  أهونُ من جلساتٍ لا يُغلقها الخروج. */
export async function sessionBindingMatches(expected: unknown): Promise<boolean> {
  if (typeof expected !== "string" || expected.length !== 64) return false;
  const value = (await cookies()).get(SESSION_BINDING_COOKIE)?.value;
  if (!value) return false;
  const a = Buffer.from(fingerprint(value), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** عند الخروج: تُمحى الكعكة — بالخصائص نفسها التي كُتبت بها، وإلا لم يمحُها
 *  المتصفّح (`__Host-` يشترط `Secure` و`/`). */
export async function clearSessionBinding(): Promise<void> {
  (await cookies()).set(SESSION_BINDING_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE,
    path: "/",
    maxAge: 0,
  });
}
