/** زرُّ «تحسين» ودرجُه في متصفّحٍ حقيقي — يُفتَح، ويُرسِل، ويُغلَق.
 *
 *  **وما لا تراه اختباراتُ الطبقة الخلفية:** الدرجُ مكوّنٌ عميلٌ بسياقٍ
 *  يُلتقَط من المتصفّح نفسِه. و`e2e-improvements.ts` يُمرّر السياقَ بيدي
 *  فيَفحص ما يُفعَل به — لا ما يُلتقَط منه. وهذا يَفتح الدرجَ فعلاً،
 *  ويَكتب، ويُرسل، ويَقرأ ما وصل القاعدةَ من سياق.
 *
 *  التشغيل: SCRATCH=<مجلّد> node scripts/check-improve-drawer.mjs
 */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium } = pw;
import { execFileSync } from "child_process";
import fs from "fs";

const SP = process.env.SCRATCH ?? ".";
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const EMAIL = "nawafalahdal.sa@gmail.com", PASS = "Tlaqi@2026";
const secret = fs.readFileSync(SP + "/.totp-secret", "utf8").trim();
const code = () =>
  execFileSync("npx", ["tsx", SP + "/totp-code.ts", secret, EMAIL], { encoding: "utf8" })
    .trim().match(/\d{6}/)[0];

const fails = [];
const check = (c, n, d) => {
  console.log((c ? "✓ " : "✗ ") + n + (d ? ` — ${d}` : ""));
  if (!c) fails.push(n);
};

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server"],
});
const page = await b.newPage({ viewport: { width: 420, height: 880 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "/login", { waitUntil: "load" });
await page.waitForTimeout(5000);
await page.click('input[type="email"]');
await page.locator('input[type="email"]').pressSequentially(EMAIL, { delay: 6 });
await page.click('input[type="password"]');
await page.locator('input[type="password"]').pressSequentially(PASS, { delay: 6 });
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);
await page.locator('button:has-text("رمز التطبيق")').first().click();
await page.waitForTimeout(400);
await page.evaluate((c) => {
  const s = (n, v) => { const e = document.querySelector(`input[name="${n}"]`); if (e) e.value = v; };
  s("email", c.e); s("password", c.p);
}, { e: EMAIL, p: PASS });
await page.fill('input[name="totp"]', code());
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);

// ── الزرُّ في ترويسة الشاشات
for (const path of ["/admin", "/plans", "/calendar", "/admin/execution"]) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  check((await page.locator("button.improve-btn").count()) > 0, `زرُّ «تحسين» في ${path}`);
}

// ── يُفتَح درجاً، لا ينتقل بالصفحة
await page.goto(BASE + "/admin/execution", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const before = page.url();
await page.locator("button.improve-btn").first().click();
await page.waitForTimeout(600);
check(await page.locator('[role="dialog"].improve-sheet').isVisible(),
  "**يُفتَح درجاً فوق الصفحة**");
check(page.url() === before, "ولا ينتقل بالصفحة — ما خلفه يبقى كما كان", page.url());
check((await page.locator('[role="dialog"]').getAttribute("aria-modal")) === "true",
  "وهو حوارٌ مُعلَنٌ للقارئ الآليّ");

// ── Escape يُغلقه، والتركيزُ يعود إلى الزرّ
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check((await page.locator(".improve-sheet").count()) === 0, "**وEscape يُغلقه**");
check(await page.evaluate(() =>
  document.activeElement?.classList.contains("improve-btn") ?? false),
  "والتركيزُ يعود إلى الزرّ — لا يَضيع في الصفحة");

// ── والنقرُ على الظلّ يُغلقه
await page.locator("button.improve-btn").first().click();
await page.waitForTimeout(500);
await page.mouse.click(10, 10);
await page.waitForTimeout(400);
check((await page.locator(".improve-sheet").count()) === 0, "والنقرُ على الظلّ يُغلقه");

// ── يُرسِل فعلاً، والسياقُ يَصل
await page.locator("button.improve-btn").first().click();
await page.waitForTimeout(500);
const title = `فحصُ الدرج ${Date.now()}`;
await page.locator('button:has-text("شيءٌ غامض")').click();
await page.fill('input[name="title"]', title);
await page.fill('textarea[name="note"]', "هذه ملاحظةٌ من فحصِ العَرْض — تُحذَف بعده.");
const ctxSent = await page.inputValue('input[name="context"]');
check(ctxSent.length > 2 && ctxSent.includes("/admin/execution"),
  "**والسياقُ ملتقَطٌ قبل الإرسال — لا حقلٌ فارغ**", ctxSent.slice(0, 120));
await page.locator('button:has-text("أرسِل الملاحظة")').click();
await page.waitForTimeout(4000);
const body = (await page.textContent("body")) ?? "";
check(/وصلَت/.test(body), "**وتُرسَل فيُقال لصاحبها إنها وصلت برقمها**");
const numMatch = body.match(/#(\d+)/);
check(!!numMatch, "ومعها رقمُها", numMatch?.[0] ?? "—");

// ── وتُرى في الصندوق
await page.goto(BASE + "/admin/improvements", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const inbox = (await page.textContent("body")) ?? "";
check(!/تعذّر إتمام العملية|Application error/.test(inbox), "/admin/improvements — بلا خطأ تشغيل");
check(inbox.includes(title), "**والملاحظةُ في صندوق المؤسس بعنوانها**");
check(inbox.includes("/admin/execution"), "ومعها الصفحةُ التي رُفعت منها");
check(inbox.includes("420×880"), "ومقاسُ الشاشة كما كان", "420×880");
check((await page.locator('button:has-text("ابدأ العمل")').count()) > 0,
  "وأزرارُ النقل مرسومةٌ لمن يُقرّر");
check((await page.locator('button:has-text("جرّبتُها — زالت")').count()) === 0,
  "**ولا يُعرَض زرُّ الشهادة قبل أن تُصلَح**");

check(errors.length === 0, "لا أخطاء جافاسكربت" + (errors.length ? `: ${errors[0]}` : ""));

await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(" | ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
