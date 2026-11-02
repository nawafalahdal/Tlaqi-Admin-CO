import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { EMAIL_POLICY } from "@/lib/emailPolicy";
import { mirroredToSheet, sendRequestReminderEmail } from "@/lib/email";
import { GET } from "@/app/api/cron/sweep/route";

/** **ما أوقفته الإدارة لا يعود** — تذكيرُ التحقق الثنائي وتذكيرُ مهلة الدخول.
 *
 *  الحادثة: أوقفت الإدارةُ الرسالتين (`EMAIL_POLICY`، a588b11)، لكن الكنسَ اليوميَّ ظلّ يناديهما، وكلُّ
 *  نداءٍ مكتومٍ كان يُكتب في الإكسل سطراً «لم تُرسل (سياسة التقليل)» — ولأن ختمَ التذكير لا يُكتب إلا
 *  لرسالةٍ خرجت، عاد كلُّ حسابٍ بلا تحققٍ ثنائيٍّ «مستحقاً» كلَّ يوم: سطرٌ يومياً لكل حساب.
 *
 *  ١) لا أثرَ في الشيفرة للمهمّتين ولا لنوعَيهما ولا لدالّتَي إرسالهما.
 *  ٢) والكنسُ اليوميُّ — يُشغَّل مرّتين كما يُعاد في الواقع — لا يكتب عنهما شيئاً، ولا يمسّ ختمَ التذكير.
 *  ٣) والمكتومُ بالسياسة يُسجَّل في سجلّ المنصة ولا يُنسَخ إلى الشيت.
 *  ٤) والتحقق الثنائي نفسه باقٍ: صفحة الحماية، والتحقق من الرمز عند الدخول.
 *
 *    npx tsx --env-file=.env scripts/check-discontinued-features.ts   (القاعدة المحلية وحدها) */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra && !ok ? " — " + extra : ""}`);
const DOMAIN = "@e2e-discontinued.test";

/** كل ملفّات الشيفرة تحت `src` */
function sources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

async function cleanup() {
  await prisma.emailLog.deleteMany({ where: { recipient: { endsWith: DOMAIN } } });
  const ms = await prisma.member.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true, inviteId: true } });
  for (const m of ms) {
    await prisma.member.delete({ where: { id: m.id } });
    await prisma.invite.deleteMany({ where: { id: m.inviteId } });
  }
  await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();

  // ── ١) الشيفرة
  const RETIRED = ["nudgeMissingTwoFactor", "sendTotpNudgeEmail", "remindExpiringCandidates", "sendWindowReminderEmail", '"totp.nudge"', '"window.reminder"'];
  const hits = sources().flatMap((f) => {
    const text = readFileSync(f, "utf8");
    return RETIRED.filter((id) => text.includes(id)).map((id) => `${f}: ${id}`);
  });
  chk("لا أثرَ في الشيفرة لمهمّتَي التذكير ولا لدالّتَي إرسالهما ولا لنوعَيهما", hits.length === 0, hits.join("، "));
  chk("والنوعان خارج سياسة البريد", !("totp.nudge" in EMAIL_POLICY) && !("window.reminder" in EMAIL_POLICY));
  const cron = readFileSync("src/app/api/cron/sweep/route.ts", "utf8");
  chk("والكنسُ اليوميُّ لا يستورد من التذكير شيئاً", !/import[^;]*\b(remind|nudge)\w*/i.test(cron));

  // ── ٢) الكنسُ نفسه — حسابٌ إداريٌّ بلا تحققٍ ثنائي، ومرشّحٌ بقيت له ساعاتٌ قبل سقوط مهلته
  const admin = await prisma.user.create({
    data: { fullName: "فحص إداريٌّ بلا تحقق", email: `admin${DOMAIN}`, passwordHash: await hashPassword("Disc#2026aaBB"), role: "operations_officer", isActive: true, totpEnabled: false },
  });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const track = await prisma.testTrack.findFirstOrThrow();
  const invite = await prisma.invite.create({
    data: { fullName: "فحص مرشّح", email: `cand${DOMAIN}`, targetRole: "member", testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  await prisma.member.create({
    data: { fullName: "فحص مرشّح", email: `cand${DOMAIN}`, inviteId: invite.id, credentialsIssuedAt: new Date(Date.now() - 13 * 3600_000), passwordHash: null },
  });
  const started = new Date();
  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = randomBytes(32).toString("hex");
  const call = () =>
    GET(new Request("http://localhost/api/cron/sweep", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  const r1 = await call();
  const r2 = await call(); // يومٌ ثانٍ — كما كان التذكير يعود كل يوم
  process.env.CRON_SECRET = prevSecret;
  const body = (await r2.json()) as Record<string, unknown>;
  chk("الكنسُ يجري مرّتين بنجاح", r1.status === 200 && r2.status === 200, `${r1.status} ${r2.status}`);
  chk("وردُّه لا يحمل أثراً للتذكيرين", !("totpNudged" in body) && !("reminded" in body), Object.keys(body).join(","));
  const logs = await prisma.emailLog.findMany({
    where: { recipient: { in: [admin.email, `cand${DOMAIN}`] }, createdAt: { gte: started } },
    select: { kind: true, status: true },
  });
  chk("**ولا سطرَ عنهما في سجلّ الرسائل — بعد تشغيلين**", logs.length === 0, JSON.stringify(logs));
  chk("ولا يُمسّ ختمُ التذكير القديم", (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).totpNudgedAt === null);

  // ── ٣) المكتومُ بالسياسة: في سجلّ المنصة بسببه، لا في الشيت
  chk("ما كُتم بالسياسة لا يُنسَخ إلى الشيت", mirroredToSheet("لم تُرسل (سياسة التقليل)") === false);
  chk("وما حوول إرسالُه يُنسَخ — وصل أو فشل أو تعذّر", ["أُرسلت", "فشل الإرسال", "لم تُرسل (البريد معطّل)"].every(mirroredToSheet));
  const emailSrc = readFileSync("src/lib/email.ts", "utf8");
  chk("والنسخُ إلى الشيت يمرّ بهذا الشرط وحده", /if \(!mirroredToSheet\(status\)\) return;\s*try \{\s*await appendEmailLog/.test(emailSrc));
  await sendRequestReminderEmail({ to: `muted${DOMAIN}`, typeLabel: "فحص", memberName: null, note: null, dueDate: null, fromName: "فحص" });
  const muted = await prisma.emailLog.findFirst({ where: { recipient: `muted${DOMAIN}` }, select: { status: true } });
  chk("والمكتومُ يبقى في «سجل الرسائل» داخل المنصة بسببه", muted?.status === "لم تُرسل (سياسة التقليل)", String(muted?.status));

  // ── ٤) التحقق الثنائي نفسه باقٍ — أُوقف التذكير لا الحماية
  const auth = readFileSync("src/auth.ts", "utf8");
  chk("الدخولُ ما يزال يتحقّق من رمز التطبيق لمن فعّله", auth.includes("verifyTotpCode(user.totpSecret"));
  chk("وصفحةُ تفعيله قائمة", sources("src/app/admin/security").some((f) => f.endsWith("page.tsx")));

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
