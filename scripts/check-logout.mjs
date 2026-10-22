/** الخروج لا يترك جلسةً صالحة — لكل دور، على الخادم الحقيقي وبجلسةٍ حقيقية.
 *
 *  **العطب الذي يحرسه هذا الفحص:** `updateAge: 0` يُعيد إصدارَ كعكة الجلسة مع
 *  كل ردٍّ من مسارٍ محروس. فطلبٌ بدأ قبل الخروج ووصل ردُّه بعده يُعيد الكعكةَ
 *  القديمة إلى المتصفّح: الصفحةُ تذهب إلى الدخول، والحسابُ باقٍ مفتوحاً.
 *
 *  ما يُثبَت:
 *  ١. **الإعادة الحتمية:** تُحفظ كعكةُ الجلسة قبل الخروج، ثم تُعاد بعده كما
 *     يُعيدها الردُّ المتأخر — ولا يُفتح بها مسارٌ محروس ولا صفحةٌ خارج
 *     حارس المسارات. لا يعتمد على التوقيت، فلا يمرّ بالحظ.
 *  ٢. **السباق المفروض:** طلباتٌ متزامنةٌ إلى مسارٍ محروس لحظةَ الخروج — مهما
 *     وصلت ردودُها، لا يبقى الحسابُ مفتوحاً.
 *  ٣. **والدخولُ بعده سليم:** جلسةٌ جديدة تعمل بعد الخروج.
 *
 *  يتطلّب `scripts/fixtures-roles.ts setup` قبله. التشغيل:
 *    SCRATCH=<مجلد السرّ> [ONLY=founder,exec] [TRIALS=3] node scripts/check-logout.mjs
 *  والعضو يدخل برمز البريد، وبناءُ الإنتاج محلياً يرفضه بلا مفتاح بريد — فيُفحَص
 *  على `next dev`. */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = pw;

const SP = process.env.SCRATCH ?? ".";
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const TRIALS = Number(process.env.TRIALS ?? 3);
const secret = fs.readFileSync(SP + "/.totp-secret", "utf8").trim();
const totp = (email) =>
  execFileSync("npx", ["tsx", "scripts/totp-code.ts", secret, email], { encoding: "utf8" }).trim().match(/\d{6}/)[0];
const memberCode = (email) =>
  execFileSync("npx", ["tsx", "scripts/fixtures-roles.ts", "code", email], { encoding: "utf8", env: process.env })
    .trim().match(/\d{6}/)[0];

const ROLES = [
  { key: "founder", email: "nawafalahdal.sa@gmail.com", pass: "Tlaqi@2026", kind: "totp", home: "/admin" },
  { key: "exec", email: "exec@fixture.test", pass: "Fixture#2026aa", kind: "totp", home: "/admin" },
  { key: "ops", email: "ops@fixture.test", pass: "Fixture#2026aa", kind: "totp", home: "/admin/operations" },
  { key: "lead", email: "lead@fixture.test", pass: "Fixture#2026aa", kind: "totp", home: "/admin/departments/tech" },
  { key: "member", email: "member@fixture.test", pass: "Fixture#2026aa", kind: "code", home: "/member" },
];
const SESSION = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

const fails = [];
const check = (c, n, d) => {
  console.log((c ? "✓ " : "✗ ") + n + (d ? ` — ${d}` : ""));
  if (!c) fails.push(n);
};

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  // `CHECK_IGNORE_TLS=1`: خلف وكيل HTTPS محليّ بشهادةٍ ذاتية — لتُختبَر أسماءُ كعكات الإنتاج
  args: ["--no-proxy-server", ...(process.env.CHECK_IGNORE_TLS === "1" ? ["--ignore-certificate-errors"] : [])],
});

async function login(r, viewport = { width: 1440, height: 900 }) {
  const ctx = await b.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "load" });
  if (r.kind === "code") {
    // محلياً لا بريد: الخطوةُ الثانية كما يؤدّيها النموذج، برمزٍ صادرٍ للتوّ
    const code = memberCode(r.email);
    await page.evaluate(async ({ email, pass, code }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const body = new URLSearchParams({ csrfToken, email, password: pass, loginCode: code, callbackUrl: "/" });
      await fetch("/api/auth/callback/credentials", { method: "POST", body, redirect: "follow" });
    }, { email: r.email, pass: r.pass, code });
  } else {
    await page.waitForTimeout(2000);
    await page.locator('input[type="email"]').pressSequentially(r.email, { delay: 4 });
    await page.locator('input[type="password"]').pressSequentially(r.pass, { delay: 4 });
    await page.click('button[type="submit"]');
    await page.waitForSelector('button:has-text("رمز التطبيق")', { timeout: 20000 });
    await page.locator('button:has-text("رمز التطبيق")').first().click();
    await page.waitForTimeout(300);
    await page.fill('input[name="totp"]', totp(r.email));
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  }
  return { ctx, page };
}

/** أين يستقرّ الطلب. صفحاتُ التقويم والخطط والهيكل خارج حارس المسارات،
 *  وحرسُها في الصفحة نفسها بعد أن يبدأ البثّ — فيأتي ردُّها 200 ومعه تحويلٌ
 *  إلى الدخول (`NEXT_REDIRECT` و`meta refresh`) بلا شيءٍ من محتواها. فمن لا
 *  يرى شريطَ العمل يُنتظَر وصولُه إلى الدخول قبل الحكم. */
async function pathOf(page, path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  if ((await page.locator(".ws-bar").count()) === 0) {
    await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 6000 }).catch(() => {});
  }
  return new URL(page.url()).pathname;
}

/** الخروجُ من قائمة الحساب كما يضغطه صاحبه — وعلى الجوال من قائمة الشريط */
async function logout(page, mobile) {
  if (mobile) {
    await page.click(".ws-bar__menu");
    await page.click(".ws-bar__panel button.account-menu__item--danger");
  } else {
    await page.click(".app-sidebar .account-menu summary");
    await page.click(".app-sidebar .account-menu button.account-menu__item--danger");
  }
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
}

const sessionCookies = async (ctx) => (await ctx.cookies()).filter((c) => SESSION.test(c.name));

for (const r of ROLES.filter((x) => !process.env.ONLY || process.env.ONLY.split(",").includes(x.key))) {
  console.log(`\n── ${r.key}`);

  // ١) الإعادة الحتمية
  {
    const { ctx, page } = await login(r);
    const before = await pathOf(page, r.home);
    check(before === r.home, `${r.key}: الدخول`, before);
    const saved = await sessionCookies(ctx);
    check(saved.length > 0, `${r.key}: كعكةُ الجلسة محفوظةٌ قبل الخروج`, `${saved.length}`);
    await logout(page, false);
    check(new URL(page.url()).pathname.startsWith("/login"), `${r.key}: الخروج يعود إلى الدخول`);
    // ما يفعله الردُّ المتأخر: يُعيد الكعكةَ القديمة كما كانت
    await ctx.addCookies(saved.map(({ name, value, domain, path, expires, httpOnly, secure, sameSite }) =>
      ({ name, value, domain, path, expires, httpOnly, secure, sameSite })));
    const replayGuarded = await pathOf(page, r.home);
    check(replayGuarded.startsWith("/login"), `${r.key}: الكعكةُ القديمة بعد الخروج لا تفتح ${r.home}`, replayGuarded);
    const replayOpen = await pathOf(page, "/calendar");
    check(replayOpen.startsWith("/login"), `${r.key}: ولا تفتح صفحةً خارج حارس المسارات (/calendar)`, replayOpen);
    await ctx.close();
  }

  // ٢) السباق المفروض — طلباتٌ إلى مسارٍ محروس تُطلَق لحظةَ الخروج ولا تُنتظَر
  let reissued = 0;
  for (let i = 0; i < TRIALS; i++) {
    const mobile = r.key === "founder" && i === TRIALS - 1;
    const { ctx, page } = await login(r, mobile ? { width: 390, height: 844 } : undefined);
    await pathOf(page, r.home);
    await page.evaluate((home) => {
      for (let k = 0; k < 6; k++) fetch(home, { headers: { RSC: "1" } }).catch(() => {});
    }, r.home);
    await logout(page, mobile);
    await page.waitForTimeout(2500); // كلُّ الردود المتأخرة وصلت
    if ((await sessionCookies(ctx)).length) reissued++;
    const after = await pathOf(page, r.home);
    check(after.startsWith("/login"), `${r.key}: سباقٌ ${i + 1}${mobile ? " (الجوال)" : ""} — لا يبقى الحسابُ مفتوحاً`, after);
    await ctx.close();
  }
  console.log(`  (أعاد ردٌّ متأخرٌ كعكةَ الجلسة في ${reissued} من ${TRIALS} — والحكمُ على الوصول لا على الكعكة)`);

  // ٣) والدخولُ بعد الخروج سليم
  {
    const { ctx, page } = await login(r);
    const again = await pathOf(page, r.home);
    check(again === r.home, `${r.key}: الدخولُ من جديد بعد الخروج`, again);
    await ctx.close();
  }
}

await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join("، ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
