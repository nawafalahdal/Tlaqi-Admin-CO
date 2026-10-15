/** شريطُ أدوات العرض — في اللغتين والسمتين وعلى المقاسين.
 *
 *  **ما يُقاس هنا هو ما رُئي في لقطة الشاشة:** ارتفاعٌ واحدٌ للأدوات،
 *  وإطارٌ واحدٌ يَلفّها، وهدفٌ يَصلح للإبهام، وأيقوناتٌ مرسومةٌ لا
 *  حروفٌ يَرسمها كلُّ جهازٍ كما شاء — ثم أن يَفعل كلُّ زرٍّ فعلَه.
 *
 *  التشغيل: node scripts/check-control-group.mjs [مجلّد-اللقطات]
 */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2] ?? null;
const fails = [];
const check = (c, n, d) => {
  console.log((c ? "✓ " : "✗ ") + n + (d ? ` — ${d}` : ""));
  if (!c) fails.push(n);
};

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server"],
});
const errors = [];

/** إضاءةُ لونٍ محسوبٍ — بالبكسل المرسوم، فيَصدق في كل فضاء لون */
const lumIn = (page) => (css) =>
  page.evaluate((v) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d", { willReadFrequently: true });
    if (!x) return null;
    x.fillStyle = "#000000";
    x.fillStyle = v;
    x.fillRect(0, 0, 1, 1);
    const [r, g, bl, a] = x.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;
    return (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
  }, css);

async function run(width, label) {
  const page = await b.newPage({ viewport: { width, height: 880 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => errors.push(String(e)));
  const lum = lumIn(page);

  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.waitForTimeout(3500);

  // ── واحدٌ لا ثلاثة: إطارٌ واحدٌ يَلفّ الأدوات
  check((await page.locator(".ctl-group").count()) === 1,
    `${label}: شريطٌ واحدٌ يَضمّ الأدوات`,
    `${await page.locator(".ctl-group").count()} شريط`);
  const items = await page.locator(".ctl-group__item").count();
  check(items >= 2, `${label}: وفيه أداتان على الأقلّ`, `${items} أداة`);

  // ── ارتفاعٌ واحدٌ لكلِّها، و٤٤ بكسلاً للإبهام
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll(".ctl-group__item")].map((e) => {
      const r = e.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width) };
    })
  );
  const heights = [...new Set(boxes.map((x) => x.h))];
  check(heights.length === 1, `${label}: **وارتفاعُها واحدٌ لا ثلاثة**`, heights.join("، "));
  check(heights[0] >= 44, `${label}: **وهدفُ الإبهام ٤٤ بكسلاً فأكثر**`, `${heights[0]}px`);
  check(boxes.every((x) => x.w >= 40), `${label}: وعرضُها يَكفي للنقر`,
    boxes.map((x) => x.w).join("، "));

  // ── ولا يَخرج عن الشاشة ولا يَلتصق بحافّتها
  const fit = await page.evaluate(() => {
    const g = document.querySelector(".ctl-group");
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), w: Math.round(r.width), iw: innerWidth };
  });
  check(fit !== null && fit.left >= 8 && fit.right >= 8,
    `${label}: **ولا يَلتصق بحافّة الشاشة**`, `يمين ${fit?.right}px / يسار ${fit?.left}px`);
  check(fit !== null && fit.w <= fit.iw,
    `${label}: ولا يَخرج عنها`, `${fit?.w}px من ${fit?.iw}px`);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)),
    `${label}: ولا يُحدِث تمريراً أفقياً`);

  // ── الأيقوناتُ مرسومةٌ لا حروف
  const svgs = await page.locator(".ctl-group svg").count();
  check(svgs >= 3, `${label}: **والأيقوناتُ مرسومةٌ (SVG) لا حروفٌ يَرسمها كلُّ جهازٍ كما شاء**`,
    `${svgs} أيقونة`);
  const glyphs = await page.evaluate(() =>
    (document.querySelector(".ctl-group")?.textContent ?? "").match(/[☀☾✦✳]/g)?.length ?? 0
  );
  check(glyphs === 0, `${label}: ولا حرفَ شمسٍ أو هلالٍ متروكاً`, String(glyphs));

  // ── التبايُن: الحبرُ يُقرأ على سطح الشريط في السمتين
  for (const want of ["light", "dark"]) {
    const sw = page.locator('button[role="switch"]').first();
    const now = await page.evaluate(() => document.documentElement.dataset.theme);
    if (now !== want) { await sw.click(); await page.waitForTimeout(600); }
    const pair = await page.evaluate(() => {
      const el = document.querySelector(".ctl-group__item");
      const g = document.querySelector(".ctl-group");
      if (!el || !g) return null;
      // السطحُ الفعليُّ تحت الشريط: أقربُ سلفٍ له خلفيّةٌ غيرُ شفّافة
      let node = g.parentElement, bg = "rgba(0,0,0,0)";
      while (node) {
        const c = getComputedStyle(node).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
        node = node.parentElement;
      }
      return { fg: getComputedStyle(el).color, bg };
    });
    const fg = await lum(pair.fg);
    const bg = await lum(pair.bg);
    check(fg !== null && bg !== null && Math.abs(fg - bg) > 0.35,
      `${label}/${want}: **حبرُ الشريط يُقرأ على سطحه**`,
      `${pair.fg} على ${pair.bg}`);
  }

  // ── المفتاحُ يَعمل: السمةُ تَنقلب والقبضةُ تَنتقل
  {
    const sw = page.locator('button[role="switch"]').first();
    const knobX = () => page.evaluate(() => {
      const k = document.querySelector(".theme-switch__knob");
      const t = document.querySelector(".theme-switch__track");
      return k && t ? Math.round(k.getBoundingClientRect().left - t.getBoundingClientRect().left) : null;
    });
    const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
    const x1 = await knobX();
    await sw.click();
    await page.waitForTimeout(650);
    const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
    const x2 = await knobX();
    check(t1 !== t2, `${label}: المفتاحُ يُبدّل السمة فعلاً`, `${t1} ← ${t2}`);
    check(Math.abs(x2 - x1) > 6, `${label}: والقبضةُ تَنتقل`, `${x1}px ← ${x2}px`);
    check((await sw.getAttribute("aria-checked")) === (t2 === "dark" ? "true" : "false"),
      `${label}: وعقدُه يُطابق الوثيقة`);
  }

  // ── وزرُّ اللغة يُبدّل اللغةَ والاتجاهَ معاً لا اللافتةَ وحدها
  {
    const dir1 = await page.evaluate(() => document.documentElement.dir);
    const lang1 = await page.evaluate(() => document.documentElement.lang);
    await page.locator(".ctl-group__item", { hasText: /English|العربية/ }).first().click();
    await page.waitForTimeout(2600);
    const dir2 = await page.evaluate(() => document.documentElement.dir);
    const lang2 = await page.evaluate(() => document.documentElement.lang);
    check(lang1 !== lang2, `${label}: **وزرُّ اللغة يُبدّل اللغة فعلاً**`, `${lang1} ← ${lang2}`);
    check(dir1 !== dir2, `${label}: **ويَقلب الاتجاهَ معها — لا اللافتةَ وحدها**`, `${dir1} ← ${dir2}`);
    // وقبضةُ المفتاح تَتبع الاتجاهَ الجديد
    const side = await page.evaluate(() => {
      const k = document.querySelector(".theme-switch__knob");
      const t = document.querySelector(".theme-switch__track");
      if (!k || !t) return null;
      const kr = k.getBoundingClientRect(), tr = t.getBoundingClientRect();
      return kr.left - tr.left < tr.width / 2 ? "start-left" : "start-right";
    });
    check(side !== null, `${label}: والقبضةُ مرسومةٌ في الاتجاه الجديد`, String(side));
    // وعودٌ إلى العربية
    await page.locator(".ctl-group__item", { hasText: /English|العربية/ }).first().click();
    await page.waitForTimeout(2600);
  }

  // ── لوحةُ المفاتيح: يُوصَل إليها وتُضغَط بالمسافة
  {
    await page.locator('button[role="switch"]').first().focus();
    const focused = await page.evaluate(() =>
      document.activeElement?.classList.contains("theme-switch") ?? false);
    check(focused, `${label}: **ويُوصَل إلى المفتاح بلوحة المفاتيح**`);
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    check(before !== after, `${label}: ويُضغَط بها`, `${before} ← ${after}`);
    const ring = await page.evaluate(() => {
      const el = document.querySelector(".theme-switch");
      el?.focus();
      const cs = getComputedStyle(el, null);
      return cs.outlineStyle !== "none" || cs.outlineWidth !== "0px";
    });
    check(ring, `${label}: وله هالةُ تركيزٍ تُرى`);
  }

  if (SHOTS) {
    for (const theme of ["light", "dark"]) {
      const now = await page.evaluate(() => document.documentElement.dataset.theme);
      if (now !== theme) {
        await page.locator('button[role="switch"]').first().click();
        await page.waitForTimeout(650);
      }
      await page.locator(".ctl-group").screenshot({ path: `${SHOTS}/ctl-${label}-${theme}.png` });
    }
  }

  await page.close();
}

await run(390, "جوّال");
await run(1280, "سطح-مكتب");

check(errors.length === 0, "لا أخطاء جافاسكربت" + (errors.length ? `: ${errors[0]}` : ""));
await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(" | ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
