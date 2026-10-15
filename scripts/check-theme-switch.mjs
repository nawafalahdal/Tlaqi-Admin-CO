/** فحصُ مفتاح السمة واللوحِ الناعم — على الصفحات العامّة.
 *
 *  **ولماذا على العامّة:** المفتاحُ يُراد في كل شاشة، وأوّلُ شاشةٍ
 *  تُفتَح قبل أيّ تسجيلٍ هي شاشةُ الدخول وشاشةُ استعادة الكلمة وشاشةُ
 *  الرابط القديم. فإن صَدَق فيها صَدَق في الترويسة التي تَستعمل المكوّنَ
 *  نفسَه — ولا يَحتاج الفحصُ باباً ولا عاملاً ثانياً.
 *
 *  التشغيل: node scripts/check-theme-switch.mjs
 */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const fails = [];
const check = (c, n, d) => {
  console.log((c ? "✓ " : "✗ ") + n + (d ? ` — ${d}` : ""));
  if (!c) fails.push(n);
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** إضاءةُ لونٍ محسوبٍ أياً كان فضاؤه — بالبكسل المرسوم لا بتحليل النصّ،
 *  لأن `color-mix` يُعيده المتصفّح `oklab(...)` لا `rgb(...)`. */
const lum = (css) =>
  page.evaluate((value) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#000000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }, css);

const sw = () => page.locator('button.theme-switch[role="switch"]').first();
const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme);
const setLight = async () => {
  const on = page.locator('button.theme-switch[aria-checked="true"]').first();
  if (await on.count()) { await on.click(); await page.waitForTimeout(600); }
};

// ── المفتاحُ موجودٌ في كل شاشةٍ تُفتَح بلا تسجيل
for (const path of ["/login", "/forgot-password", "/reset-password/none", "/invite/none"]) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  check((await sw().count()) > 0, `مفتاحُ السمة في ${path}`);
}

await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await setLight();

// ── عقدُه مع القارئ الآليّ: القبضةُ تقول ما تقوله الوثيقة
check((await sw().getAttribute("aria-checked")) === ((await themeOf()) === "dark" ? "true" : "false"),
  "aria-checked يُطابق السمةَ المكتوبة على الوثيقة",
  `aria-checked=${await sw().getAttribute("aria-checked")} / data-theme=${await themeOf()}`);

// ── القبضةُ تَنتقل من طرفٍ إلى طرف: إزاحةٌ مرسومةٌ تُقاس لا صنفٌ يُقرأ
const knobX = () =>
  page.evaluate(() => {
    const k = document.querySelector(".theme-switch__knob");
    const t = document.querySelector(".theme-switch__track");
    if (!k || !t) return null;
    return Math.round(k.getBoundingClientRect().left - t.getBoundingClientRect().left);
  });
const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const x1 = await knobX();
const bg1 = await bodyBg();
const theme1 = await themeOf();
await sw().click();
await page.waitForTimeout(700);
const x2 = await knobX();
const bg2 = await bodyBg();
const theme2 = await themeOf();

check(theme2 !== theme1, "المفتاحُ يُبدّل السمة فعلاً", `${theme1} ← ${theme2}`);
check(bg2 !== bg1, "وسطحُ الصفحة نفسُه تغيّر — لا الوسمُ وحده", `${bg1} ← ${bg2}`);
check(x1 !== null && x2 !== null && Math.abs(x2 - x1) > 10,
  "وقبضتُه تَنتقل من طرفٍ إلى طرف", `${x1}px ← ${x2}px`);
check((await sw().getAttribute("aria-checked")) === (theme2 === "dark" ? "true" : "false"),
  "وعقدُه يَتبعها بعد الضغط");

// ── وفي الداكن: لوحُ الإرشاد البيج يَغمِق وحبرُه يُقرأ عليه
//
//    واللوحُ نفسُه لا يُرسَم إلا في الخطوة الثانية من الدخول، فلا يُفتَح
//    بلا بيانات. فيُقاس **صنفُه من الورقة المنشورة** لا موضعُه: تُزرَع
//    عقدةٌ تحمل أصنافَه عينها، فتَسري عليها قواعدُ الورقة كما تسري على
//    اللوح الحقيقي — وهذا قياسٌ للـCSS المنشور لا تخمينٌ له.
if ((await themeOf()) !== "dark") { await sw().click(); await page.waitForTimeout(700); }
const panel = await page.evaluate(() => {
  const host = document.createElement("div");
  host.innerHTML =
    '<div id="tlaqi-probe" class="rounded-xl bg-[#EEF6DF]/70 px-4 py-3 text-sm">' +
    '<p class="font-semibold text-black/75">نصّ</p></div>';
  document.body.appendChild(host);
  const box = host.querySelector("#tlaqi-probe");
  const ink = host.querySelector("p");
  const out = {
    bg: getComputedStyle(box).backgroundColor,
    fg: getComputedStyle(ink).color,
    token: getComputedStyle(document.documentElement).getPropertyValue("--accent-soft").trim(),
  };
  host.remove();
  return out;
});
{
  const bg = await lum(panel.bg);
  const fg = await lum(panel.fg);
  check(panel.token.length > 0, "الداكن: متغيّرُ اللوح الناعم مُعرَّف", panel.token);
  check(bg !== null && bg < 0.45,
    "الداكن: لوحُ الإرشاد البيج غَمِق — لا لوحٌ ساطعٌ في شاشةٍ ليلية", panel.bg);
  check(fg !== null && bg !== null && Math.abs(fg - bg) > 0.3,
    "وحبرُه يُقرأ عليه — لا فاتحٌ على فاتح", `${panel.fg} على ${panel.bg}`);
}

// ── والسمةُ تَثبت عبر الصفحات: تُحفَظ لا تُنسى
const dark = await themeOf();
await page.goto(BASE + "/forgot-password", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
check((await themeOf()) === dark, "السمةُ تَثبت عبر الصفحات", String(dark));
check((await sw().getAttribute("aria-checked")) === "true", "والقبضةُ معها في الصفحة الجديدة");

// ── وبالإنجليزية يُقرأ نصُّه مترجَماً لا عربياً مُقحَماً
await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.locator("button", { hasText: "English" }).first().click();
await page.waitForTimeout(2500);
const label = (await sw().textContent())?.trim() ?? "";
check(/Light|Dark/.test(label), "والنصُّ يُترجَم مع اللغة", label);

await setLight();
check(errors.length === 0, "لا أخطاء جافاسكربت" + (errors.length ? `: ${errors[0]}` : ""));

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(" | ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
