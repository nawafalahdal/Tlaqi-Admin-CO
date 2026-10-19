/** الصورةُ تُطلَب مرّةً وتُقرأ من المخزَن بعدها — قياسٌ لا دعوى.
 *
 *  **وما يُقاس هنا هو الفرقُ الذي من أجله وُجد المسار:** data URL لا
 *  تُخزَّن، فكلُّ فتحةٍ للهيكل كانت تُعيد تحميل الصور. والمورد يُخزَّن —
 *  فالفتحةُ الثانية لا تَطلبه أصلاً.
 *
 *  التشغيل: node scripts/check-avatar-cache.mjs <سجلّ-الخادم>
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
  execFileSync("npx", ["tsx", "scripts/totp-code.ts", secret, EMAIL], { encoding: "utf8" })
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
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });

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

/** يَفتح الهيكلَ ويَعدّ ما نُقل فعلاً من الشبكة لصور الأشخاص.
 *
 *  **والقياسُ من `transferSize` لا من حدث `response` — وهذا تصحيحُ
 *  القياس نفسِه:** أوّلُ كتابةٍ عدّت البايتاتِ في مُنصِتِ `response`،
 *  فسقط الفحصُ والمخزَنُ يعمل. والسببُ أن المتصفّح يُطلق الحدثَ للمخدوم
 *  من مخزَنه أيضاً ويُتيح جسمَه، فيُعَدّ وكأنه نُقل. و`transferSize`
 *  صفرٌ لما لم يُنقَل — وهو ما يَعنينا. (وهو عينُ الدرس الذي أُخذ في
 *  فحص السمة الداكنة: قد يكون الفحصُ هو المخطئ لا الكود.) */
async function visit() {
  await page.goto(BASE + "/structure", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const net = await page.evaluate(() => {
    const avatars = performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/api/avatar/"));
    const doc = performance.getEntriesByType("navigation")[0];
    return {
      avatarReqs: avatars.length,
      avatarBytes: avatars.reduce((n, e) => n + e.transferSize, 0),
      fromCache: avatars.filter((e) => e.transferSize === 0).length,
      docBytes: doc ? doc.transferSize : 0,
      imgs: document.querySelectorAll('img[src*="/api/avatar/"]').length,
    };
  });
  return net;
}

const first = await visit();
const second = await visit();

check(first.imgs > 0, "الهيكلُ يَعرض صوراً من المسار لا من الصفحة", `${first.imgs} صورة`);
check(first.docBytes < 300 * 1024,
  "**وثيقةُ الهيكل خفيفة — لا صورٌ مدموجةٌ فيها**",
  `${(first.docBytes / 1024).toFixed(0)}KB`);
check(first.avatarReqs > 0, "والصورةُ تُطلَب أوّلَ مرّة",
  `${first.avatarReqs} طلب، ${(first.avatarBytes / 1024).toFixed(0)}KB`);
check(second.avatarBytes === 0 && second.fromCache >= first.avatarReqs,
  "**وفي الفتحة الثانية لا تُنقَل بايتٌ واحدة — تُقرأ من المخزَن**",
  `نُقل ${(second.avatarBytes / 1024).toFixed(0)}KB، ${second.fromCache} من المخزَن`);

// والختمُ في الرابط هو ما أتاح `immutable`
const src = await page.evaluate(() =>
  document.querySelector('img[src*="/api/avatar/"]')?.getAttribute("src") ?? ""
);
check(/\?v=/.test(src), "ورابطُها يَحمل الختمَ — فيُبطَل بالاستبدال لا بالمهلة", src);

const head = await page.request.get(BASE + src);
check((head.headers()["cache-control"] ?? "").includes("immutable"),
  "والجوابُ `immutable` خاصٌّ بصاحبه", head.headers()["cache-control"]);
check((head.headers()["content-type"] ?? "").startsWith("image/"),
  "ونوعُه صورةٌ مُعلَنة", head.headers()["content-type"]);
check((head.headers()["x-content-type-options"] ?? "") === "nosniff",
  "ومعه nosniff");

await b.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(" | ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
