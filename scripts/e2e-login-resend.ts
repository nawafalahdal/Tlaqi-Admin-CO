import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createCandidateAccount } from "@/lib/workflow";
import {
  issueLoginCodeGuarded,
  issueLoginCode,
  consumeLoginCode,
  RESEND_COOLDOWN_SECONDS,
  MAX_CODES_PER_WINDOW,
  CODE_WINDOW_MINUTES,
  LOGIN_CODE_MINUTES,
} from "@/lib/loginCodes";

/** **الدعوة والتحقق** — رمز البريد يُعاد إرساله بمهلةٍ وسقف، والرمز المؤقت للدعوة ثابت.
 *
 *  على بياناتٍ اصطناعيةٍ تُنشأ وتُحذف، والقاعدةُ محليةٌ وحدها. والجزء الأخير عبر HTTP
 *  بدخولٍ حقيقي (الخادم على :3000): خروجٌ وعودةٌ بالرمز المؤقت نفسه مراراً.
 *
 *    npx tsx --tsconfig tsconfig.json scripts/e2e-login-resend.ts */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const TAG = `e2e-resend-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const sec = (n: number) => n * 1000;

async function cleanup() {
  const ms = await prisma.member.findMany({ where: { email: { startsWith: "e2e-resend-" } }, select: { id: true, inviteId: true } });
  for (const m of ms) {
    await prisma.member.delete({ where: { id: m.id } }).catch(() => {});
    await prisma.invite.delete({ where: { id: m.inviteId } }).catch(() => {});
  }
  await prisma.loginCode.deleteMany({ where: { email: { startsWith: "e2e-resend-" } } });
  await prisma.loginAttempt.deleteMany({ where: { identifier: { startsWith: "e2e-resend-" } } }).catch(() => {});
}

async function liveCodes(email: string) {
  return prisma.loginCode.count({ where: { email, usedAt: null, expiresAt: { gt: new Date() } } });
}

async function login(email: string, password: string, loginCode: string) {
  const jar = new Map<string, string>();
  const keep = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${BASE}/api/auth/csrf`); keep(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  keep(await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() }, body: new URLSearchParams({ csrfToken, email, password, loginCode, callbackUrl: "/" }) }));
  const session = (await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookie() } })).json()) as { user?: { email?: string; mustChangePassword?: boolean } } | null;
  return { cookie: cookie(), csrfToken, session };
}

async function logout(cookie: string, csrfToken: string) {
  await fetch(`${BASE}/api/auth/signout`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ csrfToken, callbackUrl: "/login" }) });
}

(async () => {
  await cleanup();
  const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false } });
  const track = await prisma.testTrack.findFirstOrThrow();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  // ١ — الدعوة: رمزٌ مؤقتٌ واحد يُخزَّن مُجزّأً
  const email = `${TAG}@example.test`;
  const { tempPassword, member } = await createCandidateAccount({
    fullName: "مدعوّ نموذج", email, targetRole: "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id,
  }).then(async (r) => ({ ...r, member: await prisma.member.findUniqueOrThrow({ where: { email } }) }));
  const hashAtInvite = member.passwordHash!;
  chk("الدعوة تُنشئ رمزاً مؤقتاً مُخزَّناً مُجزّأً لا نصاً", !!hashAtInvite && hashAtInvite !== tempPassword && hashAtInvite.startsWith("$2") && (await bcrypt.compare(tempPassword, hashAtInvite)));
  chk("ويُلزَم بتغييره عند الدخول", member.mustChangePassword === true);
  const inviteBefore = await prisma.invite.findUniqueOrThrow({ where: { id: member.inviteId } });

  // ٢ — رمز البريد: الخطوة الأولى، ثم إعادة الصفحة خلال المهلة
  const t0 = new Date();
  const first = await issueLoginCodeGuarded(email, "login", t0);
  chk("الخطوة الأولى تُصدر رمز تحقق صالحاً عشر دقائق", first.ok && !!first.code && first.expiresAt.getTime() - t0.getTime() === LOGIN_CODE_MINUTES * 60_000);
  const again = await issueLoginCodeGuarded(email, "login", new Date(t0.getTime() + sec(5)));
  chk("إعادة الصفحة خلال دقيقة لا تُرسل رمزاً ثانياً (يُكمل بما وصله)", again.ok && again.code === null && (await liveCodes(email)) === 1);

  // ٣ — إعادة الإرسال: المهلة
  const tooSoon = await issueLoginCodeGuarded(email, "resend", new Date(t0.getTime() + sec(10)));
  chk(`الإعادة قبل ${RESEND_COOLDOWN_SECONDS} ثانية تُرفض مع موعد السماح`, !tooSoon.ok && tooSoon.reason === "cooldown" && Math.abs(tooSoon.retryAt.getTime() - (t0.getTime() + sec(RESEND_COOLDOWN_SECONDS))) < 50);

  // ٤ — الإعادة بعد المهلة: رمزٌ جديد يُبطل القديم
  const second = await issueLoginCodeGuarded(email, "resend", new Date(t0.getTime() + sec(RESEND_COOLDOWN_SECONDS + 1)));
  chk("الإعادة بعد المهلة تُصدر رمزاً جديداً", second.ok && !!second.code && second.code !== (first.ok ? first.code : ""));
  chk("ويبقى رمزٌ صالحٌ واحد فقط", (await liveCodes(email)) === 1);
  const oldTry = first.ok && first.code ? await consumeLoginCode(email, first.code) : { ok: false as const, reason: "missing" as const };
  chk("الرمز القديم لم يعد يُقبل", !oldTry.ok, JSON.stringify(oldTry));
  const newTry = second.ok && second.code ? await consumeLoginCode(email, second.code) : { ok: false as const };
  chk("والرمز الجديد يُقبل مرّةً واحدة", newTry.ok === true && !(await consumeLoginCode(email, second.ok ? second.code! : "")).ok);

  // ٥ — السقف: خمسة رموز في نصف ساعة
  await prisma.loginCode.deleteMany({ where: { email } });
  const base = Date.now();
  let issuedCount = 0;
  let lastResult: Awaited<ReturnType<typeof issueLoginCodeGuarded>> | null = null;
  for (let i = 0; i < MAX_CODES_PER_WINDOW + 1; i++) {
    lastResult = await issueLoginCodeGuarded(email, "resend", new Date(base + i * sec(RESEND_COOLDOWN_SECONDS + 1)));
    if (lastResult.ok) issuedCount++;
  }
  chk(`السقف: ${MAX_CODES_PER_WINDOW} رموز في ${CODE_WINDOW_MINUTES} دقيقة ثم يُرفض السادس`, issuedCount === MAX_CODES_PER_WINDOW && !!lastResult && !lastResult.ok && lastResult.reason === "limit");
  if (lastResult && !lastResult.ok) {
    chk("وموعدُ السماح حين يخرج أقدمُها من النافذة", Math.abs(lastResult.retryAt.getTime() - (base + CODE_WINDOW_MINUTES * 60_000)) < 50);
    const after = await issueLoginCodeGuarded(email, "resend", new Date(base + CODE_WINDOW_MINUTES * 60_000 + sec(1)));
    chk("وبعده يُسمح من جديد", after.ok && !!after.code);
  }

  // ٦ — التزامن: نقراتٌ متزامنة = رمزٌ واحدٌ صالح
  await prisma.loginCode.deleteMany({ where: { email } });
  const tc = new Date();
  const burst = await Promise.all(Array.from({ length: 6 }, () => issueLoginCodeGuarded(email, "resend", tc)));
  chk("ست نقراتٍ متزامنة تُصدر رمزاً واحداً والباقي يُرفض بالمهلة", burst.filter((r) => r.ok).length === 1 && burst.filter((r) => !r.ok && r.reason === "cooldown").length === 5);
  chk("ولا يبقى رمزان صالحان معاً", (await liveCodes(email)) === 1);

  // ٧ — انتهاء الصلاحية ثم الإعادة
  await prisma.loginCode.deleteMany({ where: { email } });
  const expiring = await issueLoginCodeGuarded(email, "login", new Date(Date.now() - sec(LOGIN_CODE_MINUTES * 60 + 5)));
  const late = expiring.ok && expiring.code ? await consumeLoginCode(email, expiring.code) : null;
  chk("الرمز المنتهي يُرفض «expired»", !!late && !late.ok && late.reason === "expired");
  const renewed = await issueLoginCodeGuarded(email, "resend");
  chk("وإعادة الإرسال بعده تُصدر رمزاً يعمل", renewed.ok && !!renewed.code && (await consumeLoginCode(email, renewed.code!)).ok);

  // ٨ — لا شيء مما سبق يمسّ الرمز المؤقت ولا الدعوة
  const afterCodes = await prisma.member.findUniqueOrThrow({ where: { email } });
  const inviteAfter = await prisma.invite.findUniqueOrThrow({ where: { id: member.inviteId } });
  chk("إعادة إرسال رمز التحقق لا تغيّر الرمز المؤقت", afterCodes.passwordHash === hashAtInvite);
  chk("ولا تُنشئ دعوة ولا تغيّر بياناتها", (await prisma.invite.count({ where: { email } })) === 1 && inviteAfter.status === inviteBefore.status && inviteAfter.emailAttempts === inviteBefore.emailAttempts && inviteAfter.createdAt.getTime() === inviteBefore.createdAt.getTime());

  // ٩ — عبر HTTP: دخولٌ وخروجٌ وعودةٌ بالرمز المؤقت نفسه
  const up = await fetch(`${BASE}/api/auth/csrf`).then((r) => r.ok).catch(() => false);
  if (up) {
    await prisma.loginCode.deleteMany({ where: { email } });
    const a = await login(email, tempPassword, await issueLoginCode(email));
    chk("HTTP: الدخول بالرمز المؤقت ورمز البريد", a.session?.user?.email === email && a.session?.user?.mustChangePassword === true);
    await logout(a.cookie, a.csrfToken);
    const b = await login(email, tempPassword, await issueLoginCode(email));
    chk("HTTP: الخروج ثم العودة بالرمز المؤقت نفسه", b.session?.user?.email === email);
    const c = await login(email, tempPassword, await issueLoginCode(email));
    chk("HTTP: وعودةٌ ثالثة (كتحديث الصفحة وإعادة الدخول) بالرمز نفسه", c.session?.user?.email === email);
    const stable = await prisma.member.findUniqueOrThrow({ where: { email } });
    chk("HTTP: الرمز المؤقت لم يتغيّر بعد ثلاث دخولات", stable.passwordHash === hashAtInvite && stable.mustChangePassword === true);

    // ١٠ — كلمة المرور الدائمة تُلغي المؤقتة
    const permanent = "Perm#2026-Strong!";
    await prisma.member.update({ where: { email }, data: { passwordHash: await bcrypt.hash(permanent, 10), mustChangePassword: false } });
    const tempAfter = await login(email, tempPassword, await issueLoginCode(email));
    chk("HTTP: الرمز المؤقت يُرفض بعد تعيين كلمة المرور الدائمة", !tempAfter.session?.user);
    const permOk = await login(email, permanent, await issueLoginCode(email));
    chk("HTTP: والدائمة تعمل", permOk.session?.user?.email === email && permOk.session?.user?.mustChangePassword === false);
  } else {
    checks.push("… الخادم غير مشغَّل على :3000 — تُخطّى جزء HTTP");
  }

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  const total = checks.filter((x) => x.startsWith("✓") || x.startsWith("✗")).length;
  console.log(`\n${total - failed}/${total} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
