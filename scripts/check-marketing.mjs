/** وكيلُ التسويق في المتصفّح — على الخادم المحلي، بجلساتٍ حقيقية وبيانات `fixtures-marketing`.
 *
 *  ما يُثبَت:
 *  ١. **من ليس في الفريق** (قائد القسم): لا بندَ في القائمة، والصفحاتُ والملفاتُ
 *     بروابطها المباشرة «غير موجودة» (404) — لا تُكشف.
 *  ٢. **عزلُ الحملات:** الكاتبُ لا يفتح حملةً لم يُعيَّن فيها برابطها المباشر.
 *  ٣. **الأزرارُ تطابق الخادم:** الكاتبُ يرى المسودة ولا يرى قرار التصميم؛ ومن صمّم
 *     نسخةً يُقال له إن زميلاً يعتمدها؛ والمصمّمُ الآخر يرى القرار؛ والناشرُ يرى
 *     نموذجَ النشر حين يكون المخرجُ جاهزاً وحده.
 *  ٤. **التوليدُ غيرُ مهيّأ** محلياً: الحالةُ مكتوبة، ولا زرَّ طلب.
 *  ٥. حفظُ المسودة من الواجهة يعمل ويقول ذلك.
 *  ٦. الإنجليزية، والجوال بلا تمريرٍ أفقي، والسمتان — ولا أخطاءَ في الصفحة.
 *
 *  يتطلّب `fixtures-roles.ts setup` ثم `fixtures-marketing.ts setup` (ويُمرَّر ناتجُه في IDS) —
 *  **قبل كل تشغيل:** الفحصُ يحفظ مسودةً على مخرجٍ فيغيّر ما يفحصه التشغيلُ التالي.
 *    SCRATCH=<مجلد السرّ> IDS='<json>' node scripts/check-marketing.mjs */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = pw;

const SP = process.env.SCRATCH ?? ".";
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const IDS = JSON.parse(process.env.IDS ?? "{}");
const secret = fs.readFileSync(SP + "/.totp-secret", "utf8").trim();
const totp = (email) =>
  execFileSync("npx", ["tsx", "scripts/totp-code.ts", secret, email], { encoding: "utf8" }).trim().match(/\d{6}/)[0];
const memberCode = (email) =>
  execFileSync("npx", ["tsx", "scripts/fixtures-roles.ts", "code", email], { encoding: "utf8", env: process.env }).trim().match(/\d{6}/)[0];

const ROLES = {
  founder: { email: "nawafalahdal.sa@gmail.com", pass: "Tlaqi@2026", kind: "totp" },
  exec: { email: "exec@fixture.test", pass: "Fixture#2026aa", kind: "totp" },
  ops: { email: "ops@fixture.test", pass: "Fixture#2026aa", kind: "totp" },
  lead: { email: "lead@fixture.test", pass: "Fixture#2026aa", kind: "totp" },
  member: { email: "member@fixture.test", pass: "Fixture#2026aa", kind: "code" },
};

const fails = [];
const check = (c, n, d) => {
  console.log((c ? "✓ " : "✗ ") + n + (d ? ` — ${d}` : ""));
  if (!c) fails.push(n);
};

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-proxy-server"] });

async function login(key, viewport = { width: 1440, height: 900 }) {
  const r = ROLES[key];
  const ctx = await b.newContext({ viewport });
  const page = await ctx.newPage();
  if (r.kind === "code") {
    await page.goto(BASE + "/login", { waitUntil: "load" });
    const code = memberCode(r.email);
    await page.evaluate(async ({ email, pass, code }) => {
      const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
      const body = new URLSearchParams({ csrfToken, email, password: pass, loginCode: code, callbackUrl: "/" });
      await fetch("/api/auth/callback/credentials", { method: "POST", body, redirect: "follow" });
    }, { email: r.email, pass: r.pass, code });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  } else {
    await page.goto(BASE + "/login", { waitUntil: "load" });
    await page.waitForTimeout(2500);
    await page.locator('input[type="email"]').pressSequentially(r.email, { delay: 4 });
    await page.locator('input[type="password"]').pressSequentially(r.pass, { delay: 4 });
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await page.locator('button:has-text("رمز التطبيق")').first().click();
    await page.waitForTimeout(300);
    await page.fill('input[name="totp"]', totp(r.email));
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource.*404/.test(m.text()) && errors.push(m.text()));
  return { ctx, page, errors };
}

const navHasMarketing = (page) => page.$$eval(".app-sidebar__item", (els) => els.some((e) => e.getAttribute("href") === "/marketing"));
const status = async (page, path) => (await page.goto(BASE + path, { waitUntil: "domcontentloaded" }))?.status();
const text = (page) => page.evaluate(() => document.querySelector("main")?.innerText ?? "");
const noHScroll = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const A = IDS.A, B = IDS.B;
const dpath = (d) => `/marketing/campaigns/${A}/deliverables/${d}`;

// ── ١) من ليس في الفريق
{
  console.log("\n── lead (خارج الفريق)");
  const { ctx, page, errors } = await login("lead");
  check(!(await navHasMarketing(page)), "lead: لا بندَ «وكيل التسويق» في القائمة");
  check((await status(page, "/marketing")) === 404, "lead: /marketing ← 404");
  check((await status(page, `/marketing/campaigns/${A}`)) === 404, "lead: رابطُ الحملة المباشر ← 404");
  check((await status(page, dpath(IDS.d1))) === 404, "lead: رابطُ المخرج المباشر ← 404");
  const file = await page.evaluate(async (u) => (await fetch(u)).status, `/api/marketing/files/${IDS.file}`);
  check(file === 404, "lead: ملفُّ التصميم برابطه ← 404", String(file));
  check(errors.length === 0, "lead: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

// ── ٢-٥) الكاتب والناشر
{
  console.log("\n── ops (كاتبٌ وناشر)");
  const { ctx, page, errors } = await login("ops");
  check(await navHasMarketing(page), "ops: البندُ في القائمة");
  await page.goto(BASE + "/marketing", { waitUntil: "networkidle" });
  const dash = await text(page);
  check(dash.includes("اكتب النص") && dash.includes("انشر وسجّل") && dash.includes("راجع النص واعتمده"), "ops: «ينتظرك» يجمع الكتابة والاعتماد والنشر");
  check(dash.includes("تحديد موعد النشر"), "ops: مهمّتُه المسندة إليه ظاهرة");
  await page.screenshot({ path: `${SP}/mk-dashboard-light.png`, fullPage: true });
  check((await status(page, `/marketing/campaigns/${B}`)) === 404, "ops: حملةٌ لم يُعيَّن فيها ← 404");
  await page.goto(BASE + "/marketing/campaigns", { waitUntil: "networkidle" });
  const list = await text(page);
  check(list.includes("حملة الإطلاق") && !list.includes("حملة داخلية"), "ops: قائمةُ الحملات بلا حملة «ب»");

  await page.goto(BASE + dpath(IDS.d3), { waitUntil: "networkidle" });
  const d3 = await text(page);
  // حقلُ التعليقات اسمُه `body` أيضاً — فالعدُّ في قسم النص وحده
  check((await page.locator('#content textarea[name="body"]').count()) === 1, "ops: محرّرُ المسودة للكاتب");
  check(d3.includes("غير مهيّأ") && (await page.locator('button:has-text("اطلب اقتراحاً")').count()) === 0, "ops: التوليدُ «غير مهيّأ» ولا زرَّ طلب");
  check(d3.includes("رقمٌ أو نسبة بلا مصدر") && d3.includes("روابط غير آمنة"), "ops: الفحصُ الآلي ينبّه إلى الرقم بلا مصدر والرابط غير الآمن");
  check(d3.includes("توليد الصور") && d3.includes("لا مزوّد لتوليد الصور"), "ops: توليدُ الصور «غير مهيّأ» صراحةً");
  await page.fill('#content textarea[name="body"]', "انضم إلى تَـــلاقِ — https://example.com");
  await page.click('button:has-text("حفظ المسودة")');
  await page.waitForTimeout(2500);
  check((await text(page)).includes("تمّ."), "ops: حفظُ المسودة يقول «تمّ.»");
  await page.reload({ waitUntil: "networkidle" });
  check((await page.inputValue('#content textarea[name="body"]')).includes("https://example.com"), "ops: المسودةُ محفوظةٌ بعد إعادة التحميل");

  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  check((await page.locator('button:has-text("اعتماد")').count()) === 0, "ops: لا قرارَ تصميمٍ للكاتب");
  const img = await page.locator("figure img").first().evaluate((el) => el.complete && el.naturalWidth);
  check(img === 1080, "ops: معاينةُ التصميم تُحمَّل من مسارها المحروس", String(img));
  await page.locator('label:has-text("إطار الجوال") input').check();
  await page.screenshot({ path: `${SP}/mk-deliverable-design-light.png`, fullPage: true });

  await page.goto(BASE + dpath(IDS.d2), { waitUntil: "networkidle" });
  check((await page.locator('input[name="url"]').count()) === 1 && (await page.locator('input[name="confirmedLive"]').count()) === 1, "ops: نموذجُ النشر للناشر حين يكون جاهزاً");
  check((await text(page)).includes("لا نشر آلياً"), "ops: النشرُ يدويٌّ معلَن");

  // الإنجليزية
  await ctx.addCookies([{ name: "locale", value: "en", url: BASE }]);
  await page.goto(BASE + "/marketing", { waitUntil: "networkidle" });
  const en = await text(page);
  check(en.includes("Marketing agent") && en.includes("Waiting for you"), "ops: الواجهةُ الإنجليزية");
  const arabicUi = en.split("\n").filter((l) => /[؀-ۿ]/.test(l) && !/qa-mk|ستوري|منشور|تغريدة|تحديد موعد|صور الحملة|حملة/.test(l));
  check(arabicUi.length === 0, "ops: لا نصَّ واجهةٍ عربيٌّ في الإنجليزية (سوى البيانات)", arabicUi.slice(0, 3).join(" | "));
  check(await page.evaluate(() => document.documentElement.dir === "ltr"), "ops: الاتجاهُ LTR");
  await page.goto(BASE + dpath(IDS.d3), { waitUntil: "networkidle" });
  check((await text(page)).includes("Not configured"), "ops: «Not configured» بالإنجليزية");
  await page.screenshot({ path: `${SP}/mk-deliverable-en.png`, fullPage: true });
  await ctx.addCookies([{ name: "locale", value: "ar", url: BASE }]);

  check(errors.length === 0, "ops: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

// ── المصمّم (حسابُ عضو) — صمّم النسخة فلا يعتمدها
{
  console.log("\n── member (مصمّم)");
  const { ctx, page, errors } = await login("member");
  check(await navHasMarketing(page), "member: البندُ في القائمة (عضوٌ في الفريق)");
  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  const t = await text(page);
  check(t.includes("صمّمتَ هذه النسخة") && (await page.locator('button:has-text("اعتماد")').count()) === 0, "member: من صمّم لا يُعرض له الاعتماد");
  check((await page.locator('#content textarea[name="body"]').count()) === 0, "member: لا محرّرَ نصٍّ للمصمّم");
  check(!(await page.content()).includes('href="/marketing/settings"'), "member: لا «إعدادات» لغير المدير");
  await page.goto(BASE + "/marketing/settings", { waitUntil: "networkidle" });
  check((await text(page)).includes("الإعدادات لمدير الفريق"), "member: صفحةُ الإعدادات تردّه");
  check(errors.length === 0, "member: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

// ── المؤسس — مصمّمٌ آخر يعتمد، ومديرُ الفريق
{
  console.log("\n── founder");
  const { ctx, page, errors } = await login("founder");
  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  check((await page.locator('button:has-text("اعتماد")').count()) >= 1, "founder: المصمّمُ الآخر يرى قرار التصميم");
  await page.goto(BASE + "/marketing/settings", { waitUntil: "networkidle" });
  const s = await text(page);
  check(s.includes("الفريق") && s.includes("المقاسات") && s.includes("سياسة الاعتماد") && s.includes("التكاملات"), "founder: الإعداداتُ كاملة");
  check(s.includes("غير متكامل") && s.includes("لا نشر آلياً"), "founder: التكاملاتُ غيرُ المهيّأة معلنة");
  await page.screenshot({ path: `${SP}/mk-settings-light.png`, fullPage: true });
  // الداكن
  await page.evaluate(() => localStorage.setItem("tlaqi-theme", "dark"));
  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SP}/mk-deliverable-dark.png`, fullPage: true });
  await page.goto(BASE + `/marketing/campaigns/${A}?tab=tasks`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SP}/mk-campaign-tasks-dark.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem("tlaqi-theme", "light"));
  check(errors.length === 0, "founder: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

// ── الجوال
{
  console.log("\n── الجوال (390)");
  const { ctx, page, errors } = await login("exec", { width: 390, height: 844 });
  for (const path of ["/marketing", "/marketing/campaigns", `/marketing/campaigns/${A}`, `/marketing/campaigns/${A}?tab=tasks`, dpath(IDS.d1), dpath(IDS.d2), "/marketing/settings"]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    check(await noHScroll(page), `exec 390: لا تمريرَ أفقي — ${path.replace(A, "A").replace(/deliverables\/\w+/, "deliverables/…")}`);
  }
  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SP}/mk-deliverable-mobile.png`, fullPage: true });
  check(errors.length === 0, "exec: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join("; ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
