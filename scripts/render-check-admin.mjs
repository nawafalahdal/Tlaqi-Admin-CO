/** فحص عَرْض: يفتح صفحات الإدارة الجديدة بمتصفّحٍ حقيقي بعد دخولٍ كامل.
 *
 *  الاختبارات الأخرى في `scripts/e2e-*.ts` تفحص القواعد في الطبقة
 *  الخلفية، وهي لا ترى عطباً في العَرْض: صفحةٌ تُترجَم وتُبنى بلا خطأ
 *  قد تنكسر عند أول طلبٍ حقيقي. وهذا يفتحها فعلاً.
 *
 *  التشغيل:
 *    npx next dev -p 3000 > dev.log 2>&1 &
 *    node scripts/render-check-admin.mjs dev.log
 *
 *  ورمز الدخول يُقرأ من سجلّ التطوير لأن البريد معطّل محلياً — ولا
 *  يُتجاوَز بابُ التحقّق بخطوتين: الرمز يُدخَل كما يُدخله صاحبه.
 */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium } = pw;
import fs from "fs";

const LOG = process.argv[2];
const EMAIL = "nawafalahdal.sa@gmail.com";
const PASS = "Tlaqi@2026";
const BASE = "http://127.0.0.1:3000";

function codeFromLog(since) {
  const txt = fs.readFileSync(LOG).subarray(since).toString("utf8");
  const m = [...txt.matchAll(/(?:رمز دخولك|رمز دخول \S+): (\d{6})/g)];
  return m.length ? m[m.length - 1][1] : null;
}

const fails = [];
const ok = (n) => console.log("✓ " + n);
const check = (c, n) => (c ? ok(n) : (fails.push(n), console.log("✗ " + n)));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-proxy-server"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
// الكتابة قبل أن يَحيا React تَضيع: الحقل يَقبلها والحالة لا تُحدَّث،
// فتصل الخطوة الثانية ببريدٍ فارغ ويُرفض الرمز الصحيح
await page.waitForLoadState("load");
await page.waitForTimeout(6000);
// ضغطاتٌ حقيقية لا قيمةٌ تُزرع: الحقل غير مُتحكَّم به ويُحدِّث حالةً
// في React عند كل ضغطة، والقيمة المزروعة قد لا تُحدِّثها
await page.click('input[type="email"]');
await page.locator('input[type="email"]').pressSequentially(EMAIL, { delay: 10 });
await page.click('input[type="password"]');
await page.locator('input[type="password"]').pressSequentially(PASS, { delay: 10 });
const before = fs.statSync(LOG).size;
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);

const step1 = await page.evaluate(() => document.body.innerText.split("\n").filter(l => /مقفل|غير صحيح|رمز|تعذّر/.test(l)).slice(0,4).join(" | "));
console.log("  بعد الخطوة الأولى:", step1);
let code = null;
for (let i = 0; i < 20 && !code; i++) {
  code = codeFromLog(before);
  if (!code) await page.waitForTimeout(1000);
}
check(!!code, "صدر رمز الدخول ووُجد في سجل التطوير");
if (!code) { await browser.close(); process.exit(1); }

await page.fill('input[name="loginCode"]', code);
// الحقلان المخفيان يحملان ما كُتب في الخطوة الأولى. وفي هذه البيئة لا
// يَحيا React (الصفحة تعمل بالـ HTML وحده)، فلا تُحدَّث حالتُه وتصل
// الخطوة الثانية فارغةً. فنكتبهما كما يكتبهما المتصفح — والخادم يتحقّق
// من كلمة المرور والرمز معاً على كل حال، فلا حرسٌ يُتجاوَز.
await page.evaluate((creds) => {
  const set = (n, v) => { const el = document.querySelector(`input[name="${n}"]`); if (el) el.value = v; };
  set("email", creds.email); set("password", creds.pass);
}, { email: EMAIL, pass: PASS });
const hid = await page.evaluate(() => ({
  email: document.querySelector('input[name="email"]')?.value,
  pass: (document.querySelector('input[name="password"]')?.value ?? "").length,
  code: document.querySelector('input[name="loginCode"]')?.value,
}));
console.log("  الحقول المخفية:", JSON.stringify(hid));
await page.click('button[type="submit"]');
await page.waitForTimeout(6000);
const errText = await page.evaluate(() => document.body.innerText.split("\n").filter(l => /غير صحيح|مقفل|انتهت/.test(l)).join(" | "));
if (errText) console.log("  رسالة الصفحة:", errText);
// الحكم على نجاح الدخول من صفحةٍ محميّة تُفتح، لا من عنوان الصفحة:
// المضيف في NEXTAUTH_URL قد يختلف عن الذي زرناه فيبدو العنوان غريباً
await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
check(!page.url().includes("/login"), "نجح الدخول وفُتحت لوحة الإدارة — " + page.url());

for (const [path, needles] of [
  ["/admin", ["إدارة الأعضاء والهيكل التنظيمي", "الاعتمادات الإدارية"]],
  ["/admin/people", ["إدارة الأعضاء والهيكل التنظيمي", "سجل الأعضاء", "هيكل تَـــلاقِ التنظيمي"]],
  ["/admin/approvals", ["الاعتمادات الإدارية", "بانتظار اعتمادي", "طلباتي القائمة"]],
  ["/admin/accounts", []],
  ["/admin/members", []],
]) {
  for (let i = 0; i < 12; i++) {
    try { await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); break; }
    catch (e) { if (i === 11) throw e; await page.waitForTimeout(4000); }
  }
  await page.waitForTimeout(2500);
  const body = await page.textContent("body");
  check(!/Application error|Unhandled Runtime Error|تعذّر إتمام العملية/.test(body ?? ""), `${path} — بلا خطأ تشغيل`);
  if (path === "/admin/accounts" || path === "/admin/members") {
    check(page.url().endsWith("/admin/people"), `${path} — يحوّل إلى /admin/people (${page.url()})`);
  }
  for (const n of needles) check((body ?? "").includes(n), `${path} — يحمل «${n}»`);
}

check(errors.length === 0, "لا أخطاء جافاسكربت في المتصفح" + (errors.length ? `: ${errors[0]}` : ""));

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(" | ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
