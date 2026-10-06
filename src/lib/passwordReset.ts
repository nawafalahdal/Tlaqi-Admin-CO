import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { appendMemberEvent } from "@/lib/googleSheets";
import { clearFailedAttempts } from "@/lib/loginAttempts";
import { ROLE_LABELS } from "@/lib/testTracks";

export const RESET_TOKEN_MINUTES = 30;

function baseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

/** الرمز يُخزَّن مُجزّأً: من يطّلع على القاعدة لا يستطيع انتحال طلب استعادة.
 *  SHA-256 كافٍ هنا (الرمز عشوائي 32 بايت) ولا يحتاج بطء bcrypt. */
function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** يبدأ طلب استعادة. لا يكشف أبداً ما إذا كان البريد مسجّلاً أم لا — كشفُه
 *  يحوّل الصفحة إلى أداة لحصر عناوين أعضاء المنصة. */
export async function requestPasswordReset(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return;

  const [user, member] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.member.findUnique({ where: { email } }),
  ]);

  // الحساب المُنحّى، والمرشّح الذي أُسقط أو رُفض، لا يُستعاد لهم شيء
  const account = user?.isActive
    ? { fullName: user.fullName, scope: ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role }
    : member && member.isActive && member.approvalStatus !== "rejected" && member.passwordHash
      ? { fullName: member.fullName, scope: "عضو" }
      : null;
  if (!account) return;

  // إبطال أي رموز سابقة لم تُستخدم: طلب جديد يُلغي ما قبله
  await prisma.passwordResetToken.updateMany({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(token),
      email,
      expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
    },
  });

  await sendPasswordResetEmail({
    to: email,
    fullName: account.fullName,
    resetUrl: `${baseUrl()}/reset-password/${token}`,
    minutesValid: RESET_TOKEN_MINUTES,
  });

  await appendMemberEvent({
    fullName: account.fullName,
    email,
    roleOrDepartment: account.scope,
    event: "طلب استعادة كلمة المرور",
    details: `أُرسل رابط صالح ${RESET_TOKEN_MINUTES} دقيقة`,
    at: new Date(),
  });
}

export type ResetTokenCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** يتحقق من الرمز دون استهلاكه — لعرض صفحة التعيين أو رسالة الخطأ */
export async function checkResetToken(token: string): Promise<ResetTokenCheck> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record) return { ok: false, reason: "invalid" };
  if (record.usedAt) return { ok: false, reason: "used" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, email: record.email };
}

/** يستهلك الرمز ويعيّن كلمة المرور الجديدة.
 *
 *  الاستهلاك ذرّي بشرط usedAt = null، فنقرتان متزامنتان لا تعيّنان مرتين.
 *  وبعد التعيين يُرفع إجبار التغيير، لأن المستخدم اختار كلمته بنفسه. */
export async function consumeResetToken(token: string, newPassword: string) {
  const check = await checkResetToken(token);
  if (!check.ok) return check;

  const tokenHash = hashToken(token);
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false as const, reason: "used" as const };

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const email = check.email;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
  } else {
    await prisma.member.update({
      where: { email },
      data: { passwordHash, mustChangePassword: false },
    });
  }

  // كلمة المرور الجديدة تُسقط كل أثر للمحاولات الفاشلة السابقة. بدون هذا
  // السطر يخرج صاحب الحساب من الاستعادة بكلمة مرور صحيحة ثم يُردّ على
  // باب الدخول برسالة "بيانات غير صحيحة" حتى ينتهي القفل.
  await clearFailedAttempts(email);

  const name = user?.fullName ?? (await prisma.member.findUnique({ where: { email } }))?.fullName ?? "—";
  await appendMemberEvent({
    fullName: name,
    email,
    roleOrDepartment: user ? (ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role) : "عضو",
    event: "تغيير كلمة المرور بالبريد",
    details: "عيّنها صاحب الحساب بنفسه عبر رابط الاستعادة",
    at: new Date(),
  });

  return { ok: true as const, email };
}
