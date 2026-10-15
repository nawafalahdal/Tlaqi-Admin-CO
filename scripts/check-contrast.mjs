/** تبايُنُ النصّ على سطحه — بنسبةٍ محسوبةٍ لا بالنظر.
 *
 *  **ولماذا تُقاس ولا تُقدَّر:** «يُقرأ» حكمٌ تَختلف فيه العيونُ
 *  والشاشات. ومعيارُ WCAG 2.2 AA رقمٌ لا يَختلف: ٤٫٥:١ للنصّ المعتاد،
 *  و٣:١ للكبير (١٨٫٦٦px غليظاً أو ٢٤px). فتُقاس النسبةُ على كل عقدةِ
 *  نصٍّ مرسومةٍ فعلاً، في السمتين.
 *
 *  **والقياسُ على البكسل المرسوم:** الألوانُ هنا `color-mix` و
 *  `light-dark` و`oklab`، فتحليلُ النصّ لا يَكفي. يُملأ بها قماشٌ ١×١
 *  وتُقرأ بايتاتُه — وهذا يَصدق في كل فضاء لون. والسطحُ الفعليُّ يُبحَث
 *  عنه صعوداً في الآباء حتى يُوجَد لونٌ غيرُ شفّاف: النصُّ يُرسَم على
 *  ما تحته لا على ما حوله.
 *
 *  التشغيل: node scripts/check-contrast.mjs [مسار…]
 */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const PATHS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/login", "/forgot-password", "/reset-password/none", "/invite/none"];

const fails = [];
const warn = [];
const check = (c, n, d) => {
  console.log((c ? "✓ " : "✗ ") + n + (d ? ` — ${d}` : ""));
  if (!c) fails.push(n);
};

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server"],
});
const page = await b.newPage({ viewport: { width: 390, height: 880 } });

/** يَجمع كلَّ نصٍّ مرسومٍ مع لونه ولونِ ما تحته، ويَرسمهما بكسلاً */
async function audit(path, theme) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const sw = page.locator('button[role="switch"]').first();
  if ((await sw.count()) > 0) {
    const now = await page.evaluate(() => document.documentElement.dataset.theme);
    if (now !== theme) { await sw.click(); await page.waitForTimeout(700); }
  }

  return page.evaluate(() => {
    const px = (v) => parseFloat(v) || 0;
    /** لونٌ محسوبٌ → [r,g,b] بالرسم على قماشٍ ١×١ */
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgb = (value) => {
      if (!cx) return null;
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000000";
      cx.fillStyle = value;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return d[3] === 0 ? null : [d[0], d[1], d[2]];
    };
    const lum = (c) => {
      const f = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    /** السطحُ الفعليّ: أوّلُ سلفٍ له لونٌ غيرُ شفّاف */
    const surfaceOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };

    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? "").trim();
      if (text.length < 2) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0" || cs.display === "none") continue;

      const fg = rgb(cs.color);
      const bg = rgb(surfaceOf(el));
      if (!fg || !bg) continue;

      const size = px(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      out.push({
        text: text.slice(0, 42),
        size: Math.round(size),
        large,
        need: large ? 3 : 4.5,
        got: Math.round(ratio(fg, bg) * 100) / 100,
        fg: cs.color,
        bg: surfaceOf(el),
      });
    }
    return out;
  });
}

for (const path of PATHS) {
  for (const theme of ["light", "dark"]) {
    const rows = await audit(path, theme);
    const bad = rows.filter((r) => r.got < r.need);
    check(bad.length === 0, `${path} / ${theme}: كلُّ نصٍّ يَبلغ حدَّ WCAG AA`,
      bad.length === 0
        ? `${rows.length} عقدةَ نصٍّ فُحصت`
        : bad.map((r) => `«${r.text}» ${r.got}:1 < ${r.need}:1 (${r.size}px)`).join(" | "));
    // ونصٌّ دون ١٢px بالعربية: التشكيلُ يَلتصق فيُقرأ حرفاً آخر
    const tiny = rows.filter((r) => r.size < 12 && /[؀-ۿ]/.test(r.text));
    if (tiny.length) {
      warn.push(`${path}/${theme}: ${tiny.length} نصّاً عربياً دون ١٢px`);
    }
  }
}

if (warn.length) {
  console.log("\nتنبيهات (لا تُسقِط الفحص):");
  for (const w of warn) console.log("  • " + w);
}

await b.close();
console.log(fails.length ? `\nFAILED (${fails.length})` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
