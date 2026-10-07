"use server";

import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { isLockedOut, recordFailedAttempt, lockoutMinutesLeft } from "@/lib/loginAttempts";
import { issueLoginCode, LOGIN_CODE_MINUTES } from "@/lib/loginCodes";
import { sendLoginCodeEmail } from "@/lib/email";
import { candidateWindowExpired } from "@/lib/workflow";

/** يسمح فقط بمسار داخلي نسبي (يبدأ بـ "/" وليس "//" أو "/\") لمنع Open Redirect
 *  عبر callbackUrl القادم من query string (قابل للتحكم الكامل من المهاجم) */
function safeRedirectPath(input: string): string {
  if (/^\/(?!\/|\\)/.test(input)) return input;
  return "/admin";
}

const GENERIC_ERROR = "البريد الإلكتروني أو كلمة المرور غير صحيح";

export type LoginStep1 = {
  error: string | null;
  /** أُرسل رمز إلى البريد وننتظر إدخاله */
  codeSent: boolean;
  /** هذا الحساب يملك تطبيق مصادقة أيضاً، فيُعرض عليه الطريقان */
  needsTotp: boolean;
  maskedEmail: string | null;
};

/** يُخفي وسط البريد: يؤكّد لصاحبه أنه بريده دون كشفه لمن يقف خلفه */
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const head = name.slice(0, 2);
  return `${head}${"•".repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

/** الخطوة الأولى: التحقّق من كلمة المرور ثم إرسال رمز الدخول.
 *
 *  لا تُنشئ جلسة ولا تقترب منها — النتيجة الوحيدة هنا رمزٌ في بريد صاحب
 *  الحساب. إصدار الرمز لا يقع إلا بعد صحّة كلمة المرور: لو وقع قبلها
 *  لاستطاع من يعرف البريد وحده أن يُغرق صاحبه برسائل ويحرق رموزه.
 */
export async function requestLoginCodeAction(
  _prev: LoginStep1,
  formData: FormData
): Promise<LoginStep1> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const base: LoginStep1 = { error: null, codeSent: false, needsTotp: false, maskedEmail: null };

  if (!email || !password) return { ...base, error: "البريد وكلمة المرور مطلوبان" };

  const minutes = await lockoutMinutesLeft(email);
  if (minutes > 0 || (await isLockedOut(email))) {
    return {
      ...base,
      error: `الحساب مقفل مؤقتاً بعد محاولات دخول متتالية. أعد المحاولة بعد ${Math.max(minutes, 1)} دقيقة.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.isActive && (await bcrypt.compare(password, user.passwordHash))) {
    // يُرسَل رمز البريد حتى لمن فعّل تطبيق المصادقة، ليختار أيّهما أقرب
    // إليه الآن. مَن ضاع جهازه يبقى بريده معه، والعكس.
    const sent = await deliverCode(email, user.fullName);
    return { ...sent, needsTotp: user.totpEnabled };
  }

  const member = await prisma.member.findUnique({ where: { email } });
  const candidateAllowed =
    member &&
    member.isActive &&
    member.approvalStatus !== "rejected" &&
    !member.terminatedAt &&
    !candidateWindowExpired(member);

  if (member && candidateAllowed && member.passwordHash && (await bcrypt.compare(password, member.passwordHash))) {
    return deliverCode(email, member.fullName);
  }

  await recordFailedAttempt(email);
  return { ...base, error: GENERIC_ERROR };
}

async function deliverCode(email: string, fullName: string): Promise<LoginStep1> {
  const code = await issueLoginCode(email);
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
    return { error: null, codeSent: true, needsTotp: false, maskedEmail: maskEmail(email) };
  }

  // رمزٌ لم يُرسل يعني باباً مغلقاً بلا سبب ظاهر. نقولها صراحةً بدل أن
  // ننتظر من صاحب الحساب بريداً لن يصل.
  if (result.skipped) {
    return {
      error:
        "تعذّر إرسال رمز الدخول إلى بريدك الآن. أعد المحاولة بعد قليل، وإن تكرّر فراجع مسؤول المنصة.",
      codeSent: false,
      needsTotp: false,
      maskedEmail: null,
    };
  }

  return { error: null, codeSent: true, needsTotp: false, maskedEmail: maskEmail(email) };
}

export async function loginAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
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
          error: `الحساب مقفل مؤقتاً بعد محاولات دخول متتالية. أعد المحاولة بعد ${minutes} دقيقة — كلمة المرور لم تتغيّر.`,
        };
      }
      return { error: "الرمز غير صحيح أو انتهت صلاحيته — اطلب رمزاً جديداً" };
    }
    throw err;
  }
}
