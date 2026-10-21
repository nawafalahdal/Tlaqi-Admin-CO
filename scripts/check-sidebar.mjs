/** القائمة الجانبية — لكل دور، على الخادم الحقيقي وبجلسةٍ حقيقية.
 *
 *  ما يُثبَت:
 *  ١. الترتيبُ المشترك محفوظ (الأعضاء، الاعتمادات، الأقسام، التنفيذ،
 *     التقويم، التقارير) بما يملكه كل دور منها.
 *  ٢. **كلُّ رابطٍ في القائمة يُفتَح لصاحبها** — الصفحةُ لا تردّه إلى غيرها.
 *     فالقائمةُ لا تَعِد بما يرفضه الخادم.
 *  ٣. البندُ الحاليُّ مُضاء، وواحدٌ فقط.
 *  ٤. الطيُّ يعمل ويُحفظ بعد إعادة التحميل.
 *  ٥. الجوال: لا قائمةَ جانبية، والبنودُ نفسُها في قائمة الترويسة، ولا تمريرَ
 *     أفقيٌّ على ٣٢٠ و٣٦٠ و٣٧٥ و٣٩٠ و٤١٤.
 *
 *  يتطلّب `scripts/fixtures-roles.ts setup` قبله. التشغيل:
 *    SCRATCH=<مجلد السرّ واللقطات> node scripts/check-sidebar.mjs
 */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = pw;

const SP = process.env.SCRATCH ?? ".";
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const secret = fs.readFileSync(SP + "/.totp-secret", "utf8").trim();
const totp = (email) =>
  execFileSync("npx", ["tsx", "scripts/totp-code.ts", secret, email], { encoding: "utf8" }).trim().match(/\d{6}/)[0];
const memberCode = (email) =>
  execFileSync("npx", ["tsx", "scripts/fixtures-roles.ts", "code", email], { encoding: "utf8", env: process.env })
    .trim().match(/\d{6}/)[0];

const ROLES = [
  { key: "founder", email: "nawafalahdal.sa@gmail.com", pass: "Tlaqi@2026", kind: "totp",
    shared: ["الأعضاء", "الاعتمادات", "الأقسام", "التنفيذ والأهداف", "التقويم والاجتماعات", "التقارير والملفات"] },
  { key: "exec", email: "exec@fixture.test", pass: "Fixture#2026aa", kind: "totp",
    shared: ["الأعضاء", "الاعتمادات", "الأقسام", "التنفيذ والأهداف", "التقويم والاجتماعات", "التقارير والملفات"] },
  { key: "ops", email: "ops@fixture.test", pass: "Fixture#2026aa", kind: "totp",
    shared: ["الاعتمادات", "الأقسام", "التنفيذ والأهداف", "التقويم والاجتماعات", "التقارير والملفات"] },
  { key: "lead", email: "lead@fixture.test", pass: "Fixture#2026aa", kind: "totp",
    shared: ["أعضاء قسمي", "الاعتمادات", "التنفيذ والأهداف", "التقويم والاجتماعات", "التقارير والملفات"] },
  { key: "member", email: "member@fixture.test", pass: "Fixture#2026aa", kind: "code",
    shared: ["التقويم والاجتماعات"] },
];

const fails = [];
const check = (c, n, d) => {
  console.log((c ? "✓ " : "✗ ") + n + (d ? ` — ${d}` : ""));
  if (!c) fails.push(n);
};

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server"],
});

async function login(ctx, r) {
  const page = await ctx.newPage();
  if (r.kind === "code") {
    // محلياً لا بريد، فالنموذجُ يرفض المتابعة (لا يستطيع إرسال الرمز) — وهذا
    // صحيح. فتُؤدّى الخطوةُ الثانية كما يؤدّيها النموذج: البريدُ وكلمةُ المرور
    // ورمزٌ صادرٌ للتوّ، إلى نقطة Auth.js بمفتاح CSRF. والتحقّقُ من الرمز حقيقي.
    await page.goto(BASE + "/login", { waitUntil: "load" });
    const code = memberCode(r.email);
    const res = await page.evaluate(async ({ email, pass, code }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const body = new URLSearchParams({ csrfToken, email, password: pass, loginCode: code, callbackUrl: "/" });
      const resp = await fetch("/api/auth/callback/credentials", { method: "POST", body, redirect: "follow" });
      return resp.url;
    }, { email: r.email, pass: r.pass, code });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    void res;
    return page;
  }
  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.waitForTimeout(3000);
  await page.locator('input[type="email"]').pressSequentially(r.email, { delay: 4 });
  await page.locator('input[type="password"]').pressSequentially(r.pass, { delay: 4 });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  if (r.kind === "totp") {
    await page.locator('button:has-text("رمز التطبيق")').first().click();
    await page.waitForTimeout(300);
    await page.fill('input[name="totp"]', totp(r.email));
  } else {
    await page.fill('input[name="loginCode"]', memberCode(r.email));
  }
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4500);
  return page;
}

const errors = [];
for (const r of ROLES.filter((x) => !process.env.ONLY || process.env.ONLY.split(",").includes(x.key))) {
  console.log(`\n── ${r.key}`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await login(ctx, r);
  page.on("pageerror", (e) => errors.push(`${r.key}: ${e}`));
  const landed = new URL(page.url()).pathname;
  check(!landed.startsWith("/login"), `${r.key}: الدخول`, landed);

  check((await page.locator(".app-sidebar").count()) === 1, `${r.key}: قائمةٌ جانبيةٌ واحدة`);
  const items = await page.$$eval(".app-sidebar__item", (els) =>
    els.map((e) => ({ label: e.textContent.trim(), href: e.getAttribute("href") })));
  const labels = items.map((i) => i.label);
  const sharedSeen = labels.filter((l) => r.shared.includes(l) || ["الأعضاء", "أعضاء قسمي", "الاعتمادات", "الأقسام", "التنفيذ والأهداف", "التقويم والاجتماعات", "التقارير والملفات"].includes(l));
  check(JSON.stringify(sharedSeen) === JSON.stringify(r.shared), `${r.key}: الترتيبُ المشترك`, sharedSeen.join(" ← "));
  check(!labels.some((l) => /تحسين|عطب/.test(l)), `${r.key}: لا «تحسين» مكرّرٌ في القائمة`);
  check(new Set(labels).size === labels.length, `${r.key}: لا بندَ مكرّر`);

  // ١ب) المجموعات والشعار وذيل الحساب
  const groups = await page.$$eval(".app-sidebar__section", (els) => els.filter((e) => e.offsetParent).map((e) => e.textContent.trim()));
  check(groups.length >= 2 && new Set(groups).size === groups.length, `${r.key}: عناوينُ مجموعاتٍ ظاهرة ولا تتكرّر`, groups.join(" | "));
  const lockupShown = await page.locator(".app-sidebar__lockup").isVisible();
  const markShown = await page.locator(".app-sidebar__mark").isVisible();
  check(lockupShown && !markShown, `${r.key}: موسَّعةً: الشعارُ كاملاً لا الرمزُ وحده`);
  const ov = await page.evaluate(() => {
    const n = document.querySelector(".app-sidebar__nav")?.getBoundingClientRect();
    const f = document.querySelector(".account-menu")?.getBoundingClientRect();
    return n && f ? Math.round(f.top - n.bottom) : null;
  });
  check(ov !== null && ov >= -1, `${r.key}: ذيلُ الحساب لا يقع فوق البنود`, `${ov}px`);
  // شريطٌ واحدٌ في الغلاف، ولا ترويسةَ قديمةٌ في الصفحة (`.app-header`) ولا أزرارُ حسابٍ فيه بجوار القائمة
  const bars = await page.locator(".ws-bar").count();
  const legacy = await page.locator(".app-header, .hdr-account").count();
  const barAccount = await page.locator(".ws-bar .account-menu__item").evaluateAll((els) => els.filter((e) => e.offsetParent).length);
  check(bars === 1 && legacy === 0 && barAccount === 0, `${r.key}: شريطٌ واحد، بلا ترويسةٍ قديمة ولا حسابٍ مكرَّرٍ فيه`, `bars=${bars} legacy=${legacy} account=${barAccount}`);
  await page.click(".account-menu > summary");
  await page.waitForTimeout(250);
  const acct = await page.$$eval(".account-menu__item", (els) => els.map((e) => ({ label: e.textContent.trim(), href: e.getAttribute("href") })));
  check(acct.some((a) => !a.href), `${r.key}: الخروجُ في قائمة الحساب`);
  const acctLinks = acct.filter((a) => a.href);
  for (const a of acctLinks) {
    const resp = await page.goto(BASE + a.href, { waitUntil: "domcontentloaded" });
    const path = new URL(page.url()).pathname;
    check(resp && resp.status() < 400 && path === a.href, `${r.key}: «${a.label}» من قائمة الحساب يُفتَح`, `${a.href} → ${path}`);
  }
  await page.goto(BASE + (r.key === "member" ? "/member" : "/calendar"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  // ٢) كلُّ رابطٍ يُفتَح لصاحبه
  for (const it of items) {
    const resp = await page.goto(BASE + it.href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const path = new URL(page.url()).pathname;
    const ok = resp && resp.status() < 400 && (path === it.href || path.startsWith(it.href + "/"));
    check(ok, `${r.key}: «${it.label}» يُفتَح`, `${it.href} → ${path} (${resp?.status()})`);
    if (ok) {
      const act = await page.$$eval('.app-sidebar__item[data-active="true"]', (els) => els.map((e) => e.textContent.trim()));
      check(act.length === 1 && act[0] === it.label, `${r.key}: «${it.label}» مُضاءٌ وحده`, act.join("،"));
    }
  }

  // ٤) الطيّ يُحفظ
  if (r.key === "founder") {
    await page.goto(BASE + "/calendar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const w0 = await page.locator(".app-sidebar").evaluate((e) => e.getBoundingClientRect().width);
    await page.click(".app-sidebar__toggle");
    await page.waitForTimeout(500);
    const w1 = await page.locator(".app-sidebar").evaluate((e) => e.getBoundingClientRect().width);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const w2 = await page.locator(".app-sidebar").evaluate((e) => e.getBoundingClientRect().width);
    check(w0 > 200 && w1 < 100 && w2 < 100, "الطيُّ يعمل ويبقى بعد إعادة التحميل", `${Math.round(w0)} → ${Math.round(w1)} → ${Math.round(w2)}`);
    check(await page.locator(".app-sidebar__mark").isVisible() && !(await page.locator(".app-sidebar__lockup").isVisible()),
      "ومطويّةً: الرمزُ وحده، والشعارُ الكامل مخفيّ لا مقصوص");
    const hiddenHeads = await page.$$eval(".app-sidebar__section", (els) => els.every((e) => !e.offsetParent));
    check(hiddenHeads, "ومطويّةً: لا عناوين مجموعات");
    const tip = await page.locator(".app-sidebar__item").first().getAttribute("title");
    check(!!tip, "ومطويّةً: لكل أيقونةٍ تلميحٌ باسمها", tip);
    await page.click(".app-sidebar__toggle");
    await page.waitForTimeout(400);
    // اللقطات: الفاتح والداكن
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => { localStorage.setItem("tlaqi-theme", t); }, theme);
      await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${SP}/sidebar-${theme}-desktop.png` });
    }
    await page.evaluate(() => localStorage.setItem("tlaqi-theme", "light"));
  }

  // ٥) الجوال
  for (const w of [320, 360, 375, 390, 414]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto(BASE + (r.key === "member" ? "/member" : "/calendar"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const visible = await page.locator(".app-sidebar").isVisible().catch(() => false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(!visible && overflow <= 0, `${r.key} @${w}: لا قائمةَ جانبية ولا تمريرَ أفقي`, `${overflow}px`);
    if (w === 390) {
      await page.locator(".ws-bar__menu").click();
      await page.waitForTimeout(400);
      const mob = await page.$$eval(".mobile-nav__item", (els) => els.map((e) => e.textContent.trim()));
      check(JSON.stringify(mob) === JSON.stringify(labels), `${r.key} @390: البنودُ نفسُها في قائمة الترويسة`, `${mob.length}/${labels.length}`);
      if (r.key === "founder" || r.key === "member") await page.screenshot({ path: `${SP}/sidebar-${r.key}-mobile.png` });
    }
  }
  await ctx.close();
}

check(errors.length === 0, "لا أخطاء جافاسكربت", errors.slice(0, 3).join(" | "));
await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join("، ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
