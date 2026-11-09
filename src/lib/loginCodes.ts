import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/** مهلة الرمز. قصيرة عمداً: رمز من ست خانات يبقى صالحاً ساعةً رمزٌ ضعيف،
 *  لأن مجاله مليون احتمال فقط وطول العمر يمنح المهاجم وقتاً للتخمين. */
export const LOGIN_CODE_MINUTES = 10;

/** محاولات إدخال الرمز قبل إبطاله. ستّ خانات = مليون احتمال، وخمس محاولات
 *  تجعل احتمال التخمين 5 من مليون — ثم يُبطَل الرمز فيبدأ العدّ من جديد. */
const MAX_CODE_ATTEMPTS = 5;

function hashCode(email: string, code: string) {
  // البريد جزء من المُجزّأ: رمزٌ أُصدر لشخص لا يصلح لحساب آخر حتى لو تطابق
  return crypto.createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");
}

/** رمز عشوائي من ست خانات بمولّد آمن تشفيرياً.
 *  Math.random غير صالح هنا: ناتجه متوقَّع لمن يعرف حالة المولّد. */
function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** **سياسة إصدار الرموز** — تمنع إغراق البريد وتخمين الرموز بالتكرار.
 *
 *  - **مهلة بين رمزين** (`RESEND_COOLDOWN_SECONDS`): لا يُطلب رمزٌ جديد قبل دقيقة من سابقه.
 *  - **سقفٌ في النافذة** (`MAX_CODES_PER_WINDOW` في `CODE_WINDOW_MINUTES`): خمسة رموز
 *    في نصف ساعة لكل بريد، ثم يُنتظر حتى يخرج أقدمها من النافذة.
 *
 *  والإصدار كلُّه يمرّ بإعادة التحقق من كلمة المرور قبله (`login/actions.ts`)، فمن يعرف
 *  البريد وحده لا يستطيع أن يُرسل لصاحبه رمزاً واحداً. والعدّ من صفوف `LoginCode`
 *  نفسها — لا جدول جديد — والكنسُ لا يمحو إلا ما مضى عليه يوم. */
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODES_PER_WINDOW = 5;
export const CODE_WINDOW_MINUTES = 30;

export type IssuedCode =
  | {
      ok: true;
      /** الرمز الجديد — أو `null` إن أُعيد استعمال رمزٍ صالحٍ أُرسل للتوّ (لا بريد ثانٍ) */
      code: string | null;
      expiresAt: Date;
      /** متى يُسمح بطلب رمزٍ آخر */
      resendAt: Date;
    }
  | { ok: false; reason: "cooldown" | "limit"; retryAt: Date };

/** يُصدر رمز دخول جديداً ويُبطل ما سبقه — في معاملةٍ مقفلةٍ بالبريد.
 *
 *  الإبطال مقصود: لو بقيت الرموز القديمة صالحة، لصار كل طلب جديد يوسّع مجال ما
 *  يُقبل بدل أن يستبدله. والقفلُ (`pg_advisory_xact_lock`) يجعل طلبين متزامنين لبريدٍ
 *  واحد يمرّان واحداً بعد الآخر — فلا يُنشئ كلٌّ منهما رمزاً بعد أن أبطل الآخرُ ما
 *  قبله، فيبقى رمزان صالحان معاً.
 *
 *  - `login`: الخطوة الأولى من الدخول. إن وُجد رمزٌ صالح أُرسل قبل أقلّ من دقيقة لم
 *    يُصدَر غيره (من أعاد الصفحة لا يُغرَق بريده) — ويُكمل بالرمز الذي وصله.
 *  - `resend`: زرّ «إعادة إرسال رمز التحقق». المهلة تُفرض دائماً، والرمز الجديد يُبطل
 *    السابق ولو كان صالحاً.
 *
 *  ولا يمسّ كلمة المرور ولا الرمز المؤقت للدعوة: رمز البريد شيءٌ آخر تماماً. */
export async function issueLoginCodeGuarded(
  rawEmail: string,
  mode: "login" | "resend",
  now = new Date()
): Promise<IssuedCode> {
  const email = rawEmail.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`login-code:${email}`}))`;
    const since = new Date(now.getTime() - CODE_WINDOW_MINUTES * 60_000);
    const recent = await tx.loginCode.findMany({
      where: { email, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, expiresAt: true, usedAt: true },
    });
    const last = recent.at(-1);
    const cooldownEnds = last ? new Date(last.createdAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000) : null;
    const inCooldown = !!cooldownEnds && cooldownEnds.getTime() > now.getTime();

    if (mode === "login" && inCooldown && last && !last.usedAt && last.expiresAt.getTime() > now.getTime()) {
      return { ok: true as const, code: null, expiresAt: last.expiresAt, resendAt: cooldownEnds! };
    }
    if (mode === "resend" && inCooldown) {
      return { ok: false as const, reason: "cooldown" as const, retryAt: cooldownEnds! };
    }
    if (recent.length >= MAX_CODES_PER_WINDOW) {
      const oldest = recent[0].createdAt.getTime();
      return { ok: false as const, reason: "limit" as const, retryAt: new Date(oldest + CODE_WINDOW_MINUTES * 60_000) };
    }

    const code = generateCode();
    const expiresAt = new Date(now.getTime() + LOGIN_CODE_MINUTES * 60_000);
    await tx.loginCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: now } });
    await tx.loginCode.create({ data: { email, codeHash: hashCode(email, code), expiresAt, createdAt: now } });
    return {
      ok: true as const,
      code,
      expiresAt,
      resendAt: new Date(now.getTime() + RESEND_COOLDOWN_SECONDS * 1000),
    };
  });
}

/** يُصدر رمز دخول بلا سياسة الإصدار — للفحوص الآلية وحدها (تدخل بحسابٍ تجريبيّ عبر
 *  مسار الدخول نفسه). والمنصةُ لا تناديه: الدخولُ وإعادةُ الإرسال يمرّان بـ`issueLoginCodeGuarded`. */
export async function issueLoginCode(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const code = generateCode();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`login-code:${email}`}))`;
    await tx.loginCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
    await tx.loginCode.create({
      data: { email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + LOGIN_CODE_MINUTES * 60_000) },
    });
  });
  return code;
}

export type CodeCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "used" | "wrong" | "too_many" };

/** يستهلك الرمز إن صحّ.
 *
 *  الاستهلاك ذرّي بشرط usedAt = null، فمحاولتان متزامنتان بالرمز نفسه لا
 *  تنجحان معاً. والمحاولة الخاطئة تُحسب، فلا يُترك الرمز هدفاً لتخمين
 *  غير محدود. */
export async function consumeLoginCode(rawEmail: string, code: string): Promise<CodeCheck> {
  const email = rawEmail.trim().toLowerCase();
  const digits = code.replace(/\D/g, "");

  const record = await prisma.loginCode.findFirst({
    where: { email, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return { ok: false, reason: "missing" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    await prisma.loginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return { ok: false, reason: "too_many" };
  }

  if (digits.length !== 6 || record.codeHash !== hashCode(email, digits)) {
    const bumped = await prisma.loginCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    // بلوغ الحدّ يُبطل الرمز فوراً لا عند المحاولة التالية
    if (bumped.attempts >= MAX_CODE_ATTEMPTS) {
      await prisma.loginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      return { ok: false, reason: "too_many" };
    }
    return { ok: false, reason: "wrong" };
  }

  const claimed = await prisma.loginCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, reason: "used" };

  return { ok: true };
}

/** ينظّف الرموز المنتهية. يُستدعى مع الكنس اليومي — الجدول لا ينمو بلا حدّ. */
export async function purgeExpiredLoginCodes() {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const { count } = await prisma.loginCode.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
  });
  return count;
}
