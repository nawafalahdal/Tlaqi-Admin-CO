/** دورةُ التنفيذ في المتصفّح — على الخادم المحلي، بجلساتٍ حقيقية وبيانات `fixtures-marketing`.
 *
 *  ما يُثبَت (والخادمُ يفرض كلَّ شيءٍ على كل حال — هذا يثبت أن الواجهة تطابقه):
 *  ١. **التخطيطُ مغلقٌ بعد الاعتماد** برسالته: اسمُ الحملة ومدتُها وموعدُ الفتح.
 *  ٢. **التقويم** بتوقيت الرياض، وتعديلُه بعد الاعتماد لقائد التسويق بسبب؛ ومعتمِدُ الخطة يراه ولا يعدّله.
 *  ٣. **الشات** يُرسم لصاحب المرحلة، ويقول الحقيقة: «غير مهيّأ» محلياً بلا خانة كتابة.
 *     أو — بـ `CHAT_SIMULATED=1` على خادم تطوير بالمحاكاة — يُرسل ويعود الرد.
 *  ٤. **موجزُ التصميم** و**الفحصُ النهائي** ونموذجُ النشر بعده وحده.
 *  ٥. **إيقافُ المساعد** من الإعدادات يعمل ويُستأنف.
 *  ٦. **الأرشيف** لقائد التسويق ومعتمدي الخطط وحدهم، والملفُّ غيرُ المهيّأ يُقال.
 *  ٧. الإنجليزية، والجوال بلا تمريرٍ أفقي، ولا أخطاءَ في الصفحة.
 *
 *  يتطلّب `fixtures-roles.ts setup` ثم `fixtures-marketing.ts setup <totpSecret>` (ويُمرَّر ناتجُه في IDS) —
 *  **قبل كل تشغيل، ولا بعد `check-marketing.mjs`:** ذاك يعتمد خطةً وينشر مخرجاً فيغيّر ما يفحصه هذا.
 *    SCRATCH=<مجلد السرّ> IDS='<json>' node scripts/check-marketing-execution.mjs */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = pw;

const SP = process.env.SCRATCH ?? ".";
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const SIM = process.env.CHAT_SIMULATED === "1";
const IDS = JSON.parse(process.env.IDS ?? "{}");
const secret = fs.readFileSync(SP + "/.totp-secret", "utf8").trim();
const totp = (email) =>
  execFileSync("npx", ["tsx", "scripts/totp-code.ts", secret, email], { encoding: "utf8" }).trim().match(/\d{6}/)[0];
const memberCode = (email) =>
  execFileSync("npx", ["tsx", "scripts/fixtures-roles.ts", "code", email], { encoding: "utf8", env: process.env }).trim().match(/\d{6}/)[0];

const ROLES = {
  ops: { email: "ops@fixture.test", pass: "Fixture#2026aa", kind: "totp" },
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

const go = async (page, path) => {
  const r = await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(SIM ? 2500 : 800);
  return r?.status() ?? 0;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const noHScroll = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const A = `/marketing/campaigns/${IDS.A}`;
const C = `/marketing/campaigns/${IDS.C}`;

// ── قائدُ التسويق
{
  const { ctx, page, errors } = await login("mklead");
  await go(page, A);
  const closed = page.locator("[data-planning-closed]");
  const closedText = (await closed.count()) ? await closed.innerText() : "";
  check(closedText.includes("حملة الإطلاق") && /\d{2}\/\d{2}\/\d{4}/.test(closedText), "١ التخطيطُ مغلقٌ بعد الاعتماد — برسالته (اسمُ الحملة وتواريخُها وموعدُ الفتح)", closedText.slice(0, 120));
  check(closedText.includes("فتح التخطيط مبكراً"), "١ والفتحُ المبكر معروضٌ لقائد التسويق");
  check((await page.locator("#archive").count()) === 0, "١ ولا قسمَ أرشفةٍ لحملةٍ جارية");
  await go(page, `${A}?tab=calendar`);
  const cal = await text(page);
  check(cal.includes("Asia/Riyadh") && cal.includes("تقويم النشر"), "٢ التقويمُ بمنطقته الزمنية");
  check((await page.locator('summary:has-text("تعديل الموعد بعد الاعتماد")').count()) >= 1 && (await page.locator('input[name="reason"]').count()) >= 1, "٢ وتعديلُه بعد الاعتماد لقائد التسويق — بسببٍ مطلوب");
  check((await page.locator('input[name="topic"]').count()) === 0, "٢ والنطاقُ لا يُعرض للتعديل تحت التنفيذ");
  await go(page, C);
  check((await page.locator("[data-planning-closed]").count()) === 1, "١ وشاتُ التخطيط لحملةٍ أخرى مغلقٌ برسالة الحملة المعتمدة");
  await go(page, "/marketing/settings");
  const control = page.locator("[data-ai-control]");
  check((await control.count()) === 1 && (await control.innerText()).includes("يعمل"), "٥ حالةُ المساعد في الإعدادات");
  await control.locator('button:has-text("إيقاف المساعد")').click();
  await page.waitForTimeout(2500);
  await go(page, "/marketing/settings");
  check((await page.locator("[data-ai-control]").innerText()).includes("موقوف"), "٥ إيقافُ المساعد يعمل ويُسجَّل باسمه");
  await page.locator('[data-ai-control] button:has-text("استئناف المساعد")').click();
  await page.waitForTimeout(2500);
  await go(page, "/marketing/settings");
  check((await page.locator("[data-ai-control]").innerText()).includes("يعمل"), "٥ ثم يُستأنف");
  await go(page, "/marketing/archive");
  check((await page.locator('a[href="/marketing/archive"]').count()) >= 1, "٦ تبويبُ الأرشيف لقائد التسويق");
  await page.locator('form button[type="submit"]:has-text("بحث")').click();
  await page.waitForTimeout(2500);
  check((await text(page)).includes("غير مهيّأ في هذه البيئة — لا أرشفة ولا حذف"), "٦ والبحثُ يقول صراحةً إن الملف غيرُ مهيّأ محلياً — لا نتائجَ قديمة");
  check(errors.length === 0, "٧ لا أخطاءَ في صفحات القائد", errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── مسؤولُ التشغيل: ناشرٌ وكاتبٌ في «أ»، ومعتمِدُ خطةِ «ج»
{
  const { ctx, page, errors } = await login("ops");
  await go(page, `${A}/deliverables/${IDS.d3}`);
  const chat = page.locator('[data-chat="content"]');
  check((await chat.count()) === 1, "٣ شاتُ الكاتب في صفحة قطعته");
  if (SIM) {
    await chat.locator('textarea[name="body"]').fill("اقترح افتتاحيةً أقصر");
    await chat.locator('button:has-text("إرسال")').click();
    await page.waitForTimeout(9000);
    await go(page, `${A}/deliverables/${IDS.d3}`);
    const t = await page.locator('[data-chat="content"]').innerText();
    check(t.includes("اقترح افتتاحيةً أقصر") && t.includes("محاكاة"), "٣ الرسالةُ تُرسل وتُحفظ ويعود الرد (محاكاة موسومة)", t.slice(0, 160));
  } else {
    const t = await chat.innerText();
    check(t.includes("غير مهيّأ") && (await chat.locator('textarea[name="body"]').count()) === 0, "٣ وغيرُ المهيّأ يُقال — بلا خانة كتابة");
  }
  await go(page, `${A}/deliverables/${IDS.d2}`);
  check((await page.locator("#final-check").count()) === 1 && (await text(page)).includes("اجتاز"), "٤ الفحصُ النهائي للناشر — وسجلُّه");
  check((await page.locator('input[name="confirmedLive"]').count()) === 1 && (await page.locator('textarea[name="notes"]').count()) === 1, "٤ ونموذجُ النشر بعده — بملاحظاته");
  check((await page.locator('[data-chat="publishing"]').count()) === 1, "٣ وشاتُ الفحص النهائي للناشر");
  await go(page, `${C}?tab=calendar`);
  check((await text(page)).includes("تقويم النشر") && (await page.locator('summary:has-text("تعديل")').count()) === 0, "٢ معتمِدُ الخطة يرى تقويمها ولا يعدّله");
  await go(page, "/marketing/archive");
  check((await page.locator('input[name="text"]').count()) === 1, "٦ ومعتمِدُ الخطة يبحث في الأرشيف");
  check(errors.length === 0, "٧ لا أخطاءَ في صفحات مسؤول التشغيل", errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── المصمّم (حسابُ عضو)
{
  const { ctx, page, errors } = await login("member");
  await go(page, `${A}/deliverables/${IDS.d1}`);
  check((await page.locator("#brief").count()) === 1 && (await text(page)).includes("الموجز مكتمل"), "٤ موجزُ التصميم مكتملٌ ومعروضٌ للمصمّم");
  check((await page.locator('input[name="logoSafeMargin"]').count()) === 1, "٤ والمصمّمُ يعدّل الموجز");
  check(errors.length === 0, "٧ لا أخطاءَ في صفحة المصمّم", errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── كاتبٌ ومصمّم: لا أرشيف
{
  const { ctx, page } = await login("crew");
  await go(page, "/marketing");
  check((await page.locator('a[href="/marketing/archive"]').count()) === 0, "٦ لا تبويبَ أرشيفٍ لغير القائد والمعتمِدين");
  await go(page, "/marketing/archive");
  check((await text(page)).includes("الأرشيفُ لقائد التسويق") && (await page.locator('input[name="text"]').count()) === 0, "٦ والرابطُ المباشر يُردّ");
  await ctx.close();
}

// ── الإنجليزية والجوال
{
  const { ctx, page, errors } = await login("mklead", { width: 390, height: 844 });
  await ctx.addCookies([{ name: "locale", value: "en", url: BASE }]);
  await go(page, `${A}?tab=calendar`);
  const t = await text(page);
  check(t.includes("Publishing calendar") && t.includes("Change the schedule after approval"), "٧ التقويمُ بالإنجليزية");
  check(await noHScroll(page), "٧ والجوالُ بلا تمريرٍ أفقي (التقويم)");
  await go(page, `${A}/deliverables/${IDS.d2}`);
  check((await text(page)).includes("Final check before publishing") && (await noHScroll(page)), "٧ والفحصُ النهائي بالإنجليزية على الجوال");
  await go(page, A);
  check((await text(page)).includes("Planning is closed until"), "٧ ورسالةُ الإغلاق بالإنجليزية");
  await ctx.addCookies([{ name: "locale", value: "ar", url: BASE }]);
  check(errors.length === 0, "٧ لا أخطاءَ بالإنجليزية", errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\nFAILED (${fails.length})` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
