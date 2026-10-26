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
 *  يتطلّب `fixtures-roles.ts setup` ثم `fixtures-marketing.ts setup <totpSecret>` (ويُمرَّر ناتجُه في IDS) —
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
  mklead: { email: "mklead@fixture.test", pass: "Fixture#2026aa", kind: "totp" },
  crew: { email: "crew@fixture.test", pass: "Fixture#2026aa", kind: "totp" },
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
  // الدليلُ رابطٌ على منصة المخرج: رابطٌ غريبٌ يُردّ برسالةٍ مفهومة، ورابطُ المنشور يُقبل
  const pub = page.locator("#publish");
  await pub.locator('input[name="url"]').fill("https://example.com/not-instagram");
  await pub.locator('input[name="confirmedLive"]').check();
  await pub.locator('button:has-text("تسجيل النشر")').click();
  await page.waitForTimeout(2500);
  check((await pub.innerText()).includes("ليس على منصة «instagram»"), "ops: رابطٌ ليس على منصة المخرج يُردّ");
  await pub.locator('input[name="url"]').fill("https://www.instagram.com/p/qa-check");
  await pub.locator('button:has-text("تسجيل النشر")').click();
  await page.waitForTimeout(3000);
  check((await text(page)).includes("instagram.com/p/qa-check") && (await page.locator('main').innerText()).includes("منشور"), "ops: رابطُ المنشور نفسه يُسجَّل");
  // نتائجُ اليوم نفسه: «حتى تاريخ» اليوم يُقرأ «الآن» فلا يُردّ لأنه قبل وقت النشر
  await page.locator('summary:has-text("حفظ النتائج")').click();
  await page.locator('input[name="metric.reach"]').fill("120");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await page.locator('input[name="asOf"]').fill(today);
  await page.locator('input[name="source"]').fill("Instagram Insights");
  await page.locator('button:has-text("حفظ النتائج")').click();
  await page.waitForTimeout(3000);
  check((await page.locator("#publish").innerText()).includes("Instagram Insights"), "ops: نتائجُ يوم النشر نفسه تُحفظ بمصدرها");

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
  check((await text(page)).includes("الإعدادات لقائد التسويق"), "member: صفحةُ الإعدادات تردّه");
  check(errors.length === 0, "member: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

// ── المؤسس — لا يشارك في عمليات التسويق ولا في اعتماد خططه
{
  console.log("\n── founder");
  const { ctx, page, errors } = await login("founder");
  check(!(await navHasMarketing(page)), "founder: لا بندَ «وكيل التسويق» في القائمة");
  check((await status(page, "/marketing")) === 404, "founder: /marketing ← 404");
  check((await status(page, `/marketing/campaigns/${A}`)) === 404, "founder: رابطُ الحملة المباشر ← 404");
  check(errors.length === 0, "founder: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

// ── كاتبٌ ومصمّمٌ ثانٍ — يعتمد ما لم يصنعه
{
  console.log("\n── crew (مصمّمٌ آخر)");
  const { ctx, page, errors } = await login("crew");
  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  check((await page.locator('#design button:has-text("اعتماد")').count()) >= 1, "crew: المصمّمُ الآخر يرى قرار التصميم");
  await page.evaluate(() => localStorage.setItem("tlaqi-theme", "dark"));
  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SP}/mk-deliverable-dark.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem("tlaqi-theme", "light"));
  check(!(await page.content()).includes('href="/marketing/settings"'), "crew: لا «إعدادات» لغير قائد التسويق");
  check(errors.length === 0, "crew: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

// ── سلسلةُ اعتماد الخطة في الواجهة: مسؤولُ التشغيل ثم الرئيسُ التنفيذي، ثم يبدأ القائد
{
  console.log("\n── خطة الحملة «ج»");
  const C = IDS.C;
  const plan = (page) => page.locator("#plan");
  const decideBtn = (page) => plan(page).locator('button:has-text("اعتماد")');

  const ceo1 = await login("exec");
  await ceo1.page.goto(BASE + `/marketing/campaigns/${C}`, { waitUntil: "networkidle" });
  check((await decideBtn(ceo1.page).count()) === 0, "exec: لا قرارَ للرئيس التنفيذي قبل مسؤول التشغيل");
  await ceo1.ctx.close();

  const ops = await login("ops");
  await ops.page.goto(BASE + "/marketing", { waitUntil: "networkidle" });
  check((await text(ops.page)).includes("خططٌ تنتظر قرارك") && (await text(ops.page)).includes("حملة المعرض"), "ops: الخطةُ في «خططٌ تنتظر قرارك»");
  await ops.page.goto(BASE + `/marketing/campaigns/${C}`, { waitUntil: "networkidle" });
  check((await plan(ops.page).innerText()).includes("اعتُمدت") && (await decideBtn(ops.page).count()) === 1, "ops: مرحلةُ القسم معتمدة، وقرارُ التشغيل له");
  check((await ops.page.locator('button:has-text("تقديم الخطة")').count()) === 0 && (await ops.page.locator('button:has-text("نقل إلى")').count()) === 0, "ops: لا تقديمَ ولا انتقالَ حالةٍ لمعتمِد الخطة");
  await decideBtn(ops.page).click();
  await ops.page.waitForTimeout(2500);
  check((await plan(ops.page).innerText()).includes("الاعتماد التنفيذي") && (await decideBtn(ops.page).count()) === 0, "ops: بعد قراره لا يتكرّر الزرّ");
  await ops.page.screenshot({ path: `${SP}/mk-plan-ops.png`, fullPage: true });
  check(ops.errors.length === 0, "ops: لا أخطاء في الصفحة", ops.errors.join(" | "));
  await ops.ctx.close();

  const lead1 = await login("mklead");
  await lead1.page.goto(BASE + `/marketing/campaigns/${C}`, { waitUntil: "networkidle" });
  check((await lead1.page.locator('button:has-text("إلى «قيد التنفيذ»")').count()) === 0 && (await text(lead1.page)).includes("بعد اعتماد الخطة"), "mklead: لا زرَّ بدء التنفيذ قبل الاعتماد الأخير");
  await lead1.ctx.close();

  const ceo = await login("exec");
  await ceo.page.goto(BASE + `/marketing/campaigns/${C}`, { waitUntil: "networkidle" });
  check((await decideBtn(ceo.page).count()) === 1, "exec: الآن قرارُ الرئيس التنفيذي");
  await decideBtn(ceo.page).click();
  await ceo.page.waitForTimeout(2500);
  check((await plan(ceo.page).innerText()).includes("الخطة معتمدة في مراحلها الثلاث"), "exec: الخطةُ معتمدةٌ في مراحلها الثلاث");
  check(ceo.errors.length === 0, "exec: لا أخطاء في الصفحة", ceo.errors.join(" | "));
  await ceo.ctx.close();

  const lead = await login("mklead");
  await lead.page.goto(BASE + `/marketing/campaigns/${C}`, { waitUntil: "networkidle" });
  check((await lead.page.locator('button:has-text("إلى «قيد التنفيذ»")').count()) === 1, "mklead: زرُّ بدء التنفيذ بعد الاعتمادات الثلاثة");
  await lead.page.screenshot({ path: `${SP}/mk-plan-approved.png`, fullPage: true });
  await lead.page.goto(BASE + "/marketing/settings", { waitUntil: "networkidle" });
  const st = await text(lead.page);
  check(st.includes("الفريق") && st.includes("المقاسات") && st.includes("سياسة الاعتماد") && st.includes("التكاملات"), "mklead: الإعداداتُ كاملة لقائد التسويق");
  check(st.includes("غير متكامل") && st.includes("لا نشر آلياً"), "mklead: التكاملاتُ غيرُ المهيّأة معلنة");
  check((await lead.page.locator('input[name="capabilities"][value="manager"]').count()) === 0, "mklead: لا خانةَ لمنح «قائد التسويق»");
  await lead.page.screenshot({ path: `${SP}/mk-settings-light.png`, fullPage: true });
  check(lead.errors.length === 0, "mklead: لا أخطاء في الصفحة", lead.errors.join(" | "));
  await lead.ctx.close();
}

// ── الجوال
{
  console.log("\n── الجوال (390)");
  const { ctx, page, errors } = await login("mklead", { width: 390, height: 844 });
  for (const path of ["/marketing", "/marketing/campaigns", `/marketing/campaigns/${A}`, `/marketing/campaigns/${A}?tab=tasks`, dpath(IDS.d1), dpath(IDS.d2), "/marketing/settings"]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    check(await noHScroll(page), `mklead 390: لا تمريرَ أفقي — ${path.replace(A, "A").replace(/deliverables\/\w+/, "deliverables/…")}`);
  }
  await page.goto(BASE + dpath(IDS.d1), { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SP}/mk-deliverable-mobile.png`, fullPage: true });
  check(errors.length === 0, "mklead 390: لا أخطاء في الصفحة", errors.join(" | "));
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join("; ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
