/** فحص عَرْض: يفتح صفحات الإدارة الجديدة بمتصفّحٍ حقيقي بعد دخولٍ كامل.
 *
 *  الاختبارات الأخرى في `scripts/e2e-*.ts` تفحص القواعد في الطبقة
 *  الخلفية، وهي لا ترى عطباً في العَرْض: صفحةٌ تُترجَم وتُبنى بلا خطأ
 *  قد تنكسر عند أول طلبٍ حقيقي. وهذا يفتحها فعلاً.
 *
 *  التشغيل:
 *    npx next dev -p 3000 > dev.log 2>&1 &
 *    node scripts/render-check-admin.mjs dev.log [صورة-كبيرة.png]
 *
 *  ورمز الدخول يُقرأ من سجلّ التطوير لأن البريد معطّل محلياً — ولا
 *  يُتجاوَز بابُ التحقّق بخطوتين: الرمز يُدخَل كما يُدخله صاحبه.
 */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium } = pw;
import fs from "fs";
import { execFileSync } from "child_process";

const LOG = process.argv[2];
const EMAIL = "nawafalahdal.sa@gmail.com";
const PASS = "Tlaqi@2026";
// المضيف يُطابق `NEXTAUTH_URL`: بناءُ الإنتاج يرفض مضيفاً غير موثوق
const BASE = process.env.CHECK_BASE_URL ?? "http://127.0.0.1:3000";

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
// في بناء الإنتاج لا بريد ولا طبعَ رمزٍ في السجل، فيُستعمل تطبيق
// المصادقة: عاملٌ ثانٍ كاملٌ لا تجاوزٌ له. ويُمرَّر سرُّه في
// `TOTP_SECRET` ويُحتسب رمزُه بـ`TOTP_CODE_CMD`.
if (process.env.TOTP_SECRET && process.env.TOTP_CODE_CMD) {
  await page.locator('button:has-text("رمز التطبيق")').first().click();
  await page.waitForTimeout(500);
  const [tc, ...targs] = process.env.TOTP_CODE_CMD.split(" ");
  const totp = execFileSync(tc, [...targs, process.env.TOTP_SECRET, EMAIL], {
    encoding: "utf8",
  }).trim().match(/\d{6}/)?.[0];
  check(!!totp, "احتُسب رمز تطبيق المصادقة");
  await page.evaluate((creds) => {
    const set = (n, v) => { const el = document.querySelector(`input[name="${n}"]`); if (el) el.value = v; };
    set("email", creds.email); set("password", creds.pass);
  }, { email: EMAIL, pass: PASS });
  await page.fill('input[name="totp"]', totp ?? "");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  check(!page.url().includes("/login"), "نجح الدخول وفُتحت لوحة الإدارة — " + page.url());
} else {

let code = null;
for (let i = 0; i < 12 && !code; i++) {
  code = codeFromLog(before);
  if (!code) await page.waitForTimeout(1000);
}
// بناءُ الإنتاج لا يطبع الرمز في السجل (وهذا صحيح: إنتاجٌ نُسي فيه
// مفتاحُ البريد يجب أن يَمنع الدخول لا أن يُذيع الرموز). فيُصدَر رمزٌ
// جديد لصاحب الحساب نفسه بأمرٍ يُمرَّر في `LOGIN_CODE_CMD` — والبابُ
// قائم: الخادم يتحقّق من كلمة المرور ويستهلك الرمز.
if (!code && process.env.LOGIN_CODE_CMD) {
  const [cmd, ...args] = process.env.LOGIN_CODE_CMD.split(" ");
  code = execFileSync(cmd, [...args, EMAIL], { encoding: "utf8" }).trim().match(/\d{6}/)?.[0] ?? null;
}
check(!!code, "صدر رمز الدخول");
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
}

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

// ── رفع صورةٍ كبيرة كما يرفعها صاحب جوّال
//
// **العطب الذي يُختبَر هنا:** الصورة من الجوّال تتجاوز حدَّ حجم طلب
// Server Action، فيُرفَض الطلب قبل أن يبلغ الإجراء — فلا رسالةَ خطأٍ
// مفهومة بل حاجزُ الأخطاء العام: «تعذّر إتمام العملية». والفحص يرفع
// ملفاً كبيراً فعلاً ويتحقّق أن الصورة حُفظت.
const BIG = process.argv[3];
if (BIG) {
  await page.goto(BASE + "/admin/profile", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const body0 = await page.textContent("body");
  check(!/تعذّر إتمام العملية/.test(body0 ?? ""), "/admin/profile — بلا خطأ تشغيل");
  check((body0 ?? "").includes("قسمك في الهيكل"), "/admin/profile — فيه تسجيل قسم المؤسس");

  await page.setInputFiles('input[type="file"][name="avatar"]', BIG);
  await page.waitForTimeout(1500);
  const saveBtn = page.locator('button:has-text("حفظ الصورة"), button:has-text("استبدال الصورة")').first();
  await saveBtn.click();
  await page.waitForTimeout(12000);
  const body1 = await page.textContent("body");
  check(!/تعذّر إتمام العملية|Application error/.test(body1 ?? ""),
        "**صورةٌ كبيرة تُرفَع بلا «تعذّر إتمام العملية»**");
  check(/حُفظت صورتك/.test(body1 ?? ""), "وتُحفَظ ويُقال ذلك صريحاً",
        (body1 ?? "").slice(0, 0));
}

// ── الهيكل: شجرةٌ واحدة، وبطاقةُ المُشاهد مميَّزة، والنسخة الرسمية
// تُمنَع وهي ناقصة — ويُفرَض المنع في الخادم لا بإخفاء الزرّ
await page.goto(BASE + "/structure", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const structure = (await page.textContent("body")) ?? "";
check(!/تعذّر إتمام العملية|Application error/.test(structure), "/structure — بلا خطأ تشغيل");
check(structure.includes("هيكل تَـــلاقِ التنظيمي"), "/structure — الشجرة تُعرَض");
check(structure.includes("أنت هنا"), "**/structure — بطاقةُ المُشاهد مميَّزة بـ«أنت هنا»**");
check(structure.includes("نسخة الهيكل الرسمية"), "/structure — فيه بطاقة النسخة الرسمية");

await page.goto(BASE + "/structure/pdf", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const pdfPage = (await page.textContent("body")) ?? "";
const gated = pdfPage.includes("النسخة الرسمية غير متاحة بعد");
const sheet = pdfPage.includes("نسخة رسمية");
check(gated || sheet, "/structure/pdf — إمّا الورقة أو منعٌ مُعلَّل", gated ? "مُنع" : "ورقة");
if (gated) {
  check(/بلا قائد|أعضاء خلا القائد|شاغر|غير مصنّف/.test(pdfPage),
        "**والمنع يُسمّي ما ينقص بعينه لا «غير مكتمل»**");
}

// ── التقارير: تُفتح لمن يملك قراءتها، وأرقامُها من العدّاد
await page.goto(BASE + "/admin/reports", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const reports = (await page.textContent("body")) ?? "";
check(!/تعذّر إتمام العملية|Application error/.test(reports), "/admin/reports — بلا خطأ تشغيل");
check(reports.includes("ملخّص القادة والأقسام"), "/admin/reports — ملخّص القادة يُعرَض");
check(reports.includes("أُغلقت في موعدها"), "/admin/reports — قائمة المُغلقة في موعدها");

// ── إدارة الأعضاء: زرّ التكريم وحالة الدخول للمؤسس
await page.goto(BASE + "/admin/people", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const people = (await page.textContent("body")) ?? "";
check(!/تعذّر إتمام العملية|Application error/.test(people), "/admin/people — بلا خطأ تشغيل");
check(people.includes("كرِّمه على إنجاز"), "**/admin/people — زرّ التكريم معروضٌ للمؤسس**");

// ── اللجان: طابورُ الاعتماد عند من يقرّر، واللجنةُ فرعٌ في الهيكل
//
// **وما يُختبَر هنا لا تراه اختباراتُ الطبقة الخلفية:** الطابورُ مكوّنٌ
// عميل بأزرارٍ وحقل سبب، والشجرةُ تُرسم نفسها تكراراً — وكلاهما قد
// يُبنى بلا خطأ ثم ينكسر عند أول طلبٍ حقيقي.
await page.goto(BASE + "/admin/departments", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const depts = (await page.textContent("body")) ?? "";
check(!/تعذّر إتمام العملية|Application error/.test(depts), "/admin/departments — بلا خطأ تشغيل");
check(depts.includes("اقتراحات اللجان"), "**/admin/departments — طابورُ اللجان معروضٌ لمن يقرّر**");
check(/لجنة المحتوى|لجنة «?المحتوى/.test(depts), "وفيه اللجنةُ المقترحة باسمها");
check(depts.includes("بانتظار الاعتماد"), "وموسومةٌ بأنها بانتظار الاعتماد");
check(depts.includes("لجنة التطوير"), "واللجنةُ المعتمدة تُعرَض لجنةً لا قسماً");
check(depts.includes("داخل التسويق"), "ومنسوبةٌ إلى أبيها صريحاً");
check(
  (await page.locator('button:has-text("اعتمدها وافتحها")').count()) > 0,
  "**وزرُّ الاعتماد مرسومٌ وقابلٌ للضغط**"
);
check(
  (await page.locator('button:has-text("ردّها بسبب")').count()) > 0,
  "وزرُّ الردّ بسبب كذلك"
);
// الردُّ يَطلب سبباً قبل أن يُرسَل — الحرسُ مُعلَنٌ في الواجهة لا مخفيّ
await page.locator('button:has-text("ردّها بسبب")').first().click();
await page.waitForTimeout(600);
const rejectForm = (await page.textContent("body")) ?? "";
check(rejectForm.includes("سببُ الردّ"), "والردُّ يفتح حقل السبب قبل الإرسال");
check(
  await page.locator('button:has-text("أرسل الردّ")').first().isDisabled(),
  "**وزرُّ الإرسال معطَّلٌ حتى يُكتب السبب**"
);

// الهيكل: اللجنةُ فرعٌ داخل أبيها لا بطاقةٌ بجانبه
await page.goto(BASE + "/structure", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const tree = (await page.textContent("body")) ?? "";
check(!/تعذّر إتمام العملية|Application error/.test(tree), "/structure — بلا خطأ تشغيل مع اللجان");
check(tree.includes("لجنة التطوير"), "**/structure — اللجنةُ المعتمدة في الشجرة**");
check(tree.includes("اللجان"), "وعدّادُ اللجان ظاهر");
check(!tree.includes("لجنة المحتوى") && !tree.includes("المحتوى"),
      "**والمقترحةُ غائبةٌ عن الهيكل — الاقتراحُ ليس فتحاً**");
// والفرعُ مرسومٌ داخل إطار أبيه: ترويسةُ اللجنة تقع داخل عمود التسويق
const nestedInDom = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll("span")];
  const committee = nodes.find((n) => n.textContent?.trim() === "لجنة التطوير");
  const parent = nodes.find((n) => n.textContent?.trim() === "التسويق");
  if (!committee || !parent) return "لم يُعثر على الترويستين";
  // أقربُ عمودِ فرعٍ للتسويق يجب أن يحتوي ترويسةَ اللجنة
  const col = parent.closest("div.flex-col");
  return col && col.contains(committee) ? "nested" : "sibling";
});
check(nestedInDom === "nested", "**واللجنةُ مرسومةٌ داخل فرع أبيها لا بجانبه**", String(nestedInDom));

// ── السمتان: التبديل، والثبات عبر الصفحات، وبلا ومضة
{
  const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bodyBg = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const first = await themeOf();
  check(first === "light" || first === "dark", "السمة مكتوبةٌ على الوثيقة", String(first));

  const bgBefore = await bodyBg();
  await page.locator('button[title="الوضع الداكن"], button[title="الوضع الفاتح"]').first().click();
  await page.waitForTimeout(700);
  const second = await themeOf();
  check(second !== first, "**الزرّ يُبدّل السمة فعلاً**", `${first} ← ${second}`);
  const bgAfter = await bodyBg();
  check(bgAfter !== bgBefore, "**وسطحُ الصفحة نفسُه تغيّر — لا الوسمُ وحده**",
        `${bgBefore} ← ${bgAfter}`);

  // الثبات: تُفتح صفحةٌ أخرى فتبقى السمة
  await page.goto(BASE + "/admin/people", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  check((await themeOf()) === second, "**وتثبت عبر الصفحات — تُحفَظ لا تُنسى**");

  // ولا ومضة: الوسم مكتوبٌ في أول HTML يصل، قبل أن يَحيا React
  // والمقياس موضعُه لا وجودُه: يجب أن يسبق `<body>`، فيُنفَّذ قبل أن
  // يُرسَم شيء. (قِستُه أولاً بأوّل ٤٠٠ حرفٍ فسقط الفحص والنصُّ موجود
  // في الحرف ١٦٠٥ — الفحصُ كان الخطأ لا الكود.)
  const order = await page.evaluate(async () => {
    const res = await fetch(location.href, { headers: { accept: "text/html" } });
    const html = await res.text();
    return { script: html.indexOf("tlaqi-theme"), body: html.indexOf("<body") };
  });
  check(order.script > -1 && order.body > -1 && order.script < order.body,
        "**ونصُّ السمة يسبق `<body>` — فلا ومضةَ بيضاء قبل الداكن**",
        `script@${order.script} < body@${order.body}`);

  // ورجوعٌ إلى الفاتح حتى لا تتأثّر بقية الفحوص
  if (second === "dark") {
    await page.locator('button[title="الوضع الفاتح"]').first().click();
    await page.waitForTimeout(500);
  }
}

check(errors.length === 0, "لا أخطاء جافاسكربت في المتصفح" + (errors.length ? `: ${errors[0]}` : ""));

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(" | ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
