"use server";

import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { isLockedOut, recordFailedAttempt, lockoutMinutesLeft } from "@/lib/loginAttempts";
import { issueLoginCodeGuarded, LOGIN_CODE_MINUTES } from "@/lib/loginCodes";
import { sendLoginCodeEmail } from "@/lib/email";
import { candidateWindowExpired } from "@/lib/workflow";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
/** يسمح فقط بمسار داخلي نسبي (يبدأ بـ "/" وليس "//" أو "/\") لمنع Open Redirect
 *  عبر callbackUrl القادم من query string (قابل للتحكم الكامل من المهاجم) */
function safeRedirectPath(input: string): string {
  if (/^\/(?!\/|\\)/.test(input)) return input;
  return "/admin";
}


export type LoginStep1 = {
  error: string | null;
  /** أُرسل رمز إلى البريد وننتظر إدخاله */
  codeSent: boolean;
  /** هذا الحساب يملك تطبيق مصادقة أيضاً، فيُعرض عليه الطريقان */
  needsTotp: boolean;
  maskedEmail: string | null;
  /** متى ينتهي الرمز المُرسَل (ms) — لعدّاد الصلاحية في الواجهة */
  codeExpiresAt?: number | null;
  /** متى يُسمح بطلب رمزٍ جديد (ms) — لعدّاد «إعادة إرسال رمز التحقق» */
  resendAt?: number | null;
};

/** يُخفي وسط البريد: يؤكّد لصاحبه أنه بريده دون كشفه لمن يقف خلفه */
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const head = name.slice(0, 2);
  return `${head}${"•".repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

type Verified = { ok: true; fullName: string; needsTotp: boolean } | { ok: false; error: string };

/** يتحقّق من البريد وكلمة المرور — للخطوة الأولى ولإعادة إرسال الرمز معاً.
 *
 *  لا يُصدَر رمزٌ إلا بعد صحّة كلمة المرور: لو صدر قبلها لاستطاع من يعرف البريد
 *  وحده أن يُغرق صاحبه برسائل ويحرق رموزه. والقفلُ المؤقت وعدُّ المحاولات الفاشلة
 *  كما هما في الخطوة الأولى، فلا يصير زرُّ الإعادة باباً جانبياً لتخمين كلمة المرور. */
async function verifyForCode(rawEmail: string, password: string): Promise<Verified> {
  const L = getDictionary(await getLocale()).rLoginActions;
  const email = rawEmail.trim().toLowerCase();
  if (!email || !password) return { ok: false, error: L.emailAndPasswordAre };

  const minutes = await lockoutMinutesLeft(email);
  if (minutes > 0 || (await isLockedOut(email))) {
    return { ok: false, error: fmt(L.theAccountIsTemporarily, Math.max(minutes, 1)) };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.isActive) {
    // من له حسابٌ إداريٌّ نشط لا يدخل بسجلّ ترشّحه — كما في `authorize`
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await recordFailedAttempt(email);
      return { ok: false, error: L.genericError };
    }
    // يُرسَل رمز البريد حتى لمن فعّل تطبيق المصادقة، ليختار أيّهما أقرب إليه الآن
    return { ok: true, fullName: user.fullName, needsTotp: user.totpEnabled };
  }

  const member = await prisma.member.findUnique({ where: { email } });
  const candidateAllowed =
    member &&
    member.isActive &&
    member.approvalStatus !== "rejected" &&
    !member.terminatedAt &&
    !candidateWindowExpired(member);

  if (member && candidateAllowed && member.passwordHash && (await bcrypt.compare(password, member.passwordHash))) {
    return { ok: true, fullName: member.fullName, needsTotp: false };
  }

  await recordFailedAttempt(email);
  return { ok: false, error: L.genericError };
}

/** الخطوة الأولى: التحقّق من كلمة المرور ثم إرسال رمز الدخول.
 *
 *  لا تُنشئ جلسة ولا تقترب منها — النتيجة الوحيدة هنا رمزٌ في بريد صاحب الحساب.
 *  ومن أعاد الصفحة خلال دقيقةٍ من رمزٍ صالح لا يُرسَل له غيره: يُكمل بما وصله. */
export async function requestLoginCodeAction(
  _prev: LoginStep1,
  formData: FormData
): Promise<LoginStep1> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const base: LoginStep1 = { error: null, codeSent: false, needsTotp: false, maskedEmail: null };

  const verified = await verifyForCode(email, password);
  if (!verified.ok) return { ...base, error: verified.error };
  const sent = await deliverCode(email, verified.fullName, "login");
  return { ...sent, needsTotp: verified.needsTotp };
}

export type ResendResult =
  | { ok: true; maskedEmail: string; codeExpiresAt: number; resendAt: number }
  | { ok: false; error: string; retryAt?: number };

/** **إعادة إرسال رمز التحقق** — من الخطوة الثانية دون الرجوع إلى أولها.
 *
 *  يُعيد التحقق من كلمة المرور في الخادم (لا يكفي أن الزرّ ظاهر)، ثم يُصدر رمزاً
 *  جديداً يُبطل السابق — بمهلة دقيقة بين رمزين وسقف خمسة رموز في نصف ساعة. ولا
 *  يمسّ الدعوة ولا الرمز المؤقت ولا بيانات الحساب: رمزُ البريد وحده يتجدّد. */
export async function resendLoginCodeAction(input: { email: string; password: string }): Promise<ResendResult> {
  const L = getDictionary(await getLocale()).rLoginActions;
  const email = String(input?.email ?? "").trim().toLowerCase();
  const password = String(input?.password ?? "");
  const verified = await verifyForCode(email, password);
  if (!verified.ok) return { ok: false, error: verified.error };
  const sent = await deliverCode(email, verified.fullName, "resend");
  if (sent.error || !sent.codeExpiresAt || !sent.resendAt) {
    return { ok: false, error: sent.error ?? L.couldNotSendThe, retryAt: sent.resendAt ?? undefined };
  }
  return { ok: true, maskedEmail: sent.maskedEmail ?? maskEmail(email), codeExpiresAt: sent.codeExpiresAt, resendAt: sent.resendAt };
}

async function deliverCode(email: string, fullName: string, mode: "login" | "resend"): Promise<LoginStep1> {
  const L = getDictionary(await getLocale()).rLoginActions;
  const none: LoginStep1 = { error: null, codeSent: false, needsTotp: false, maskedEmail: null };
  const issued = await issueLoginCodeGuarded(email, mode);
  if (!issued.ok) {
    const seconds = Math.max(1, Math.ceil((issued.retryAt.getTime() - Date.now()) / 1000));
    return {
      ...none,
      error:
        issued.reason === "cooldown"
          ? fmt(L.resendCooldown, seconds)
          : fmt(L.resendLimit, Math.max(1, Math.ceil(seconds / 60))),
      resendAt: issued.retryAt.getTime(),
    };
  }
  const timers = { codeExpiresAt: issued.expiresAt.getTime(), resendAt: issued.resendAt.getTime() };
  // رمزٌ صالحٌ أُرسل للتوّ: لا بريد ثانٍ — يُكمل صاحبه بما وصله
  if (issued.code === null) {
    return { ...none, codeSent: true, maskedEmail: maskEmail(email), ...timers };
  }

  const code = issued.code;
  const result = await sendLoginCodeEmail({
    to: email,
    fullName,
    code,
    minutesValid: LOGIN_CODE_MINUTES,
  });

  // في التطوير المحلي لا مفتاح بريد، فلا يصل شيء. بدون هذا المنفذ يستحيل
  // تسجيل الدخول محلياً إطلاقاً. الشرط على NODE_ENV لا على وجود المفتاح:
  // إنتاجٌ نُسي فيه المفتاح يجب أن يَمنع الدخول لا أن يطبع الرموز.
  if (result.skipped && process.env.NODE_ENV !== "production") {
    console.warn(`[dev] رمز دخول ${email}: ${code}`);
    return { ...none, codeSent: true, maskedEmail: maskEmail(email), ...timers };
  }

  // رمزٌ لم يُرسل يعني باباً مغلقاً بلا سبب ظاهر. نقولها صراحةً بدل أن
  // ننتظر من صاحب الحساب بريداً لن يصل.
  if (result.skipped) {
    return { ...none, error: L.couldNotSendThe, resendAt: timers.resendAt };
  }

  return { ...none, codeSent: true, maskedEmail: maskEmail(email), ...timers };
}

export async function loginAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rLoginActions;
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const totp = String(formData.get("totp") ?? "");
  const loginCode = String(formData.get("loginCode") ?? "");
  const remember = formData.get("remember") === "on" ? "on" : "";
  const callbackUrl = safeRedirectPath(String(formData.get("callbackUrl") ?? "/admin"));

  try {
    await signIn("credentials", { email, password, totp, loginCode, remember, redirectTo: callbackUrl });
    return { error: null };
  } catch (err) {
    if (err instanceof AuthError) {
      // القفل المؤقت يردّ كلمة المرور الصحيحة أيضاً. إخفاء ذلك خلف رسالة
      // "بيانات غير صحيحة" يجعل صاحب الحساب يظن أن كلمته خاطئة فيعيد
      // تعيينها بلا فائدة. العدّاد يُسجَّل للبريد غير المسجّل أيضاً، فإعلان
      // القفل لا يكشف من هو عضو في المنصة.
      const minutes = await lockoutMinutesLeft(email.toLowerCase().trim());
      if (minutes > 0) {
        return {
          error: fmt(L.theAccountIsTemporarily2, minutes),
        };
      }
      return { error: L.theCodeIsWrong };
    }
    throw err;
  }
}
