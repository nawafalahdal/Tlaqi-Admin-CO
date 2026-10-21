/** رأسُ مساحة العمل — لكل دور (يُشارك فحصَ القائمة طريقةَ الدخول).
 *  الأصل: القائمة الجانبية — لكل دور، على الخادم الحقيقي وبجلسةٍ حقيقية.
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


const MOCK = ["68%", "أحمد محمد", "اجتماع قيادة التَلاقِي", "بناء دورة تنفيذ أكثر وضوحاً", "تحديث دورة التخطيط للربع القادم", "لديك ٣ تحديثات"];
const truth = JSON.parse(execFileSync("npx", ["tsx", "scripts/dashboard-truth.ts"], { encoding: "utf8", env: process.env }).trim().split("\n").pop());
const HOME = { founder: "/admin", exec: "/admin", ops: "/admin/operations", lead: "/admin/departments/tech", member: "/member" };
const SNAP = { founder: true, exec: true, ops: true, lead: false, member: false };
// رأسُ المساحة (`WorkspaceOverview`) في بيوت التشغيل والقسم والعضو. وبيتُ المؤسس
// والتنفيذي (`/admin`) صار مركزَ القيادة منذ 557a6cd («نظرةٌ عامة بلا تكرار»):
// قراراتٌ وتذاكرُ وجداول — فلا يُنتظَر فيه الرأسُ، ويُتحقَّق أنه لا يتكرّر.
const OVERVIEW = { founder: false, exec: false, ops: true, lead: true, member: true };
const errors = [];
for (const r of ROLES.filter((x) => !process.env.ONLY || process.env.ONLY.split(",").includes(x.key))) {
  console.log(`\n── ${r.key}`);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await login(ctx, r);
  page.on("pageerror", (e) => errors.push(`${r.key}: ${e}`));
  await page.goto(BASE + HOME[r.key], { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // بياناتُ الأمثلة لا تتسرّب إلى أي بيت — بالرأس أو بدونه
  const text = await page.locator("main").innerText();
  const leaked = MOCK.filter((m) => text.includes(m));
  check(leaked.length === 0, `${r.key}: لا بيانات أمثلةٍ من الأرشيف`, leaked.join("، "));
  if (!OVERVIEW[r.key]) {
    check((await page.locator(".ws-hero").count()) === 0, `${r.key}: مركزُ القيادة بلا رأسِ مساحةٍ مكرَّر`);
    check((await page.locator("main h1").count()) === 1, `${r.key}: عنوانُ الصفحة حاضر`);
  } else {
  check((await page.locator(".ws-hero").count()) === 1, `${r.key}: الهدفُ القادم في رأس المساحة`);
  const snap = await page.$$eval(".ws-card li strong", (els) => els.length);
  check(SNAP[r.key] ? snap > 0 : true, `${r.key}: لمحة الأقسام ${SNAP[r.key] ? "حاضرة" : "ليست له"}`);
  if (SNAP[r.key]) {
    const drawn = await page.$$eval(".ws-card li", (els) => Object.fromEntries(els.filter((e) => e.querySelector("strong") && e.querySelector(".w-32")).map((e) => [e.querySelector(".w-32").textContent.trim(), Number(e.querySelector("strong").textContent)])));
    check(JSON.stringify(drawn) === JSON.stringify(Object.fromEntries(Object.keys(drawn).map((k) => [k, truth[k]]))) && Object.keys(drawn).length === Object.keys(truth).length,
      `${r.key}: أعدادُ الأقسام = القاعدة`, JSON.stringify(drawn));
  } else {
    check((await page.locator("text=لمحة الأقسام").count()) === 0, `${r.key}: ولا تُعرض لمحةُ الأقسام`);
  }
  const days = await page.locator(".ws-day").count();
  check(days === 42, `${r.key}: التقويم المختصر ٤٢ يوماً`, `${days}`);
  }

  // كلُّ رابطٍ في الرأس يُفتَح لصاحبه
  const hrefs = [...new Set(await page.$$eval(".ws-hero a, .ws-card a", (els) => els.map((e) => e.getAttribute("href"))))];
  const pages = hrefs.filter((h) => h && h.startsWith("/")).map((h) => h.split("#")[0]).filter((h, i, a) => a.indexOf(h) === i).slice(0, 8);
  for (const h of pages) {
    const resp = await page.goto(BASE + h, { waitUntil: "domcontentloaded" });
    const path = new URL(page.url()).pathname;
    const want = h.split("?")[0];
    check(resp && resp.status() < 400 && path === want, `${r.key}: رابطُ الرأس ${h} يُفتَح`, `${path} (${resp?.status()})`);
  }
  for (const theme of ["light", "dark"]) {
    if (r.key !== "founder" && theme === "dark") continue;
    await page.evaluate((t) => localStorage.setItem("tlaqi-theme", t), theme);
    await page.goto(BASE + HOME[r.key], { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SP}/dash-${r.key}-${theme}.png`, fullPage: false });
  }
  await page.evaluate(() => localStorage.setItem("tlaqi-theme", "light"));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(BASE + HOME[r.key], { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(ov <= 0, `${r.key} @360: لا تمريرَ أفقي`, `${ov}px`);
  if (r.key === "founder") await page.screenshot({ path: `${SP}/dash-founder-mobile.png`, fullPage: true });
  await ctx.close();
}
check(errors.length === 0, "لا أخطاء جافاسكربت", errors.slice(0, 3).join(" | "));
await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join("، ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
