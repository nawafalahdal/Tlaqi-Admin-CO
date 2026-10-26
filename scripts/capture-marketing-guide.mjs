/** صورُ دليل القيادة — من الواجهة الحقيقية على الخادم المحلي، بجلساتٍ حقيقية وبيانات
 *  `fixtures-marketing-guide` التجريبية. لا صورةَ مُركّبة ولا حالةَ مصطنعة في المتصفّح:
 *  كلُّ ما يظهر صنعه الخادم، والنقراتُ القليلة هنا (إسنادٌ مقترح، رابطٌ خاطئ) أفعالٌ حقيقية
 *  تُرفض أو تُقبل كما في الإنتاج.
 *
 *  **الحجب قبل كل صورة:** كلُّ بريدٍ إلكتروني يُستبدل بـ«•••@•••»، وقائمةُ أشخاص المنصة في
 *  الإعدادات تُحجب أسماؤها، واسمُ المؤسس في صورته يُطمس. ويُكتب ما الْتُقط وما تعذّر في
 *  `manifest.json` بجانب الصور.
 *
 *    SCRATCH=<مجلد السرّ> IDS='<json من fixtures-marketing-guide setup>' node scripts/capture-marketing-guide.mjs */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = pw;

const SP = process.env.SCRATCH ?? ".";
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const IDS = JSON.parse(process.env.IDS ?? "{}");
const OUT = "docs/marketing-agent-guide/screenshots";
const secret = fs.readFileSync(SP + "/.totp-secret", "utf8").trim();
const totp = (email) => execFileSync("npx", ["tsx", "scripts/totp-code.ts", secret, email], { encoding: "utf8" }).trim().match(/\d{6}/)[0];
const PASS = "Fixture#2026aa";
const G = (k) => `${k}@guide.example.test`;
const ROLES = {
  lead: G("lead"), writer: G("writer"), writer2: G("writer2"), designer: G("designer"), designer2: G("designer2"),
  reviewer: G("reviewer"), publisher: G("publisher"), ops: "ops@fixture.test", ceo: "exec@fixture.test",
};
fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-proxy-server"] });

async function login(email, viewport = { width: 1440, height: 1000 }) {
  const ctx = await b.newContext({ viewport, locale: "ar-SA", colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  await page.locator('input[type="email"]').pressSequentially(email, { delay: 3 });
  await page.locator('input[type="password"]').pressSequentially(PASS, { delay: 3 });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.locator('button:has-text("رمز التطبيق")').first().click();
  await page.waitForTimeout(300);
  await page.fill('input[name="totp"]', totp(email));
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  return { ctx, page };
}

/** الحجب: البريدُ في كل نصٍّ وحقل، وما يُطلب زيادةً */
async function redact(page, { people = false, account = false } = {}) {
  await page.evaluate(({ people, account }) => {
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/@/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(EMAIL, "•••@•••");
    for (const el of document.querySelectorAll("input, textarea")) if (/@/.test(el.value)) el.value = el.value.replace(EMAIL, "•••@•••");
    for (const el of document.querySelectorAll("[title],[aria-label]")) {
      for (const a of ["title", "aria-label"]) { const v = el.getAttribute(a); if (v && /@/.test(v)) el.setAttribute(a, v.replace(EMAIL, "•••@•••")); }
    }
    if (people) for (const o of document.querySelectorAll('select[name="person"] option')) o.textContent = "اسمٌ من المنصة (محجوب)";
    if (account) for (const el of document.querySelectorAll(".app-sidebar__name, .app-sidebar__role, .app-sidebar__avatar")) el.style.filter = "blur(7px)";
  }, { people, account });
}

/** صورةٌ واحدة: تُفتح الصفحة، ويُنتظر ما يُثبت أنها الحالة المقصودة، ثم تُحجب وتُلتقط */
async function shot(page, file, { path, role, action, observe, expect, scrollTo, full = false, element, redactOpts, before }) {
  try {
    if (path) await page.goto(BASE + path, { waitUntil: "networkidle" });
    if (before) await before(page);
    const body = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
    for (const e of [].concat(expect ?? [])) if (!body.includes(e)) throw new Error(`لم يظهر «${e}»`);
    if (scrollTo) {
      const el = page.locator(scrollTo).first();
      await el.scrollIntoViewIfNeeded();
      await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "start" }), scrollTo).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, -90));
    }
    await redact(page, redactOpts);
    await page.waitForTimeout(250);
    // قسمٌ بعينه كاملاً (المعاينةُ ونموذجُ القرار معاً) — أو الصفحةُ بقائمتها وهويتها
    // (قصٌّ من لقطة الصفحة كاملةً لا لقطةُ العنصر: هذه تُمرّر الصفحة فيعلو الشريطُ اللاصق القسم)
    if (element) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const box = await page.locator(element).first().boundingBox();
      if (!box) throw new Error(`لا عنصر ${element}`);
      await page.screenshot({ path: `${OUT}/${file}`, fullPage: true, clip: { x: Math.max(box.x - 8, 0), y: Math.max(box.y - 8, 0), width: box.width + 16, height: box.height + 16 } });
    }
    else await page.screenshot({ path: `${OUT}/${file}`, fullPage: full });
    manifest.push({ file, role, action, observe, path, captured: true });
    console.log("✓", file);
  } catch (e) {
    manifest.push({ file, role, action, observe, path, captured: false, reason: String(e.message ?? e) });
    console.log("✗", file, "—", e.message ?? e);
  }
}

const C = (id, tab) => `/marketing/campaigns/${id}${tab ? `?tab=${tab}` : ""}`;
const D = (d) => `/marketing/campaigns/${IDS.c1}/deliverables/${d}`;

// ── قائد التسويق
{
  const { ctx, page } = await login(ROLES.lead);
  await shot(page, "01-lead-dashboard.png", { path: "/marketing", role: "قائد التسويق", action: "يفتح لوحة وكيل التسويق", observe: "الخطط التي تنتظر قراره، وما ينتظره، ومهامّه، وعدّادات الحملات النشطة والمهام المتأخرة والمنشورات المسجّلة", expect: "حملة", full: true });
  await shot(page, "02-lead-campaigns-list.png", { path: "/marketing/campaigns", role: "قائد التسويق", action: "قائمة الحملات", observe: "كل حملة بحالتها وموعدها ومسؤولها", expect: "حملة الإطلاق" });
  await shot(page, "03-lead-new-campaign.png", { path: "/marketing/campaigns/new", role: "قائد التسويق", action: "إنشاء حملة جديدة", observe: "حقول الموجز: الهدف والجمهور والرسالة والقنوات والموعد" });
  await shot(page, "04-lead-brief-incomplete.png", { path: C(IDS.c5), role: "قائد التسويق", action: "حملة في مرحلة الموجز", observe: "النواقص تُذكر بأسمائها قبل زر الانتقال إلى التخطيط", expect: "حملة داخلية" });
  await shot(page, "05-lead-plan-submit.png", { path: C(IDS.c4), role: "قائد التسويق", action: "خطة رُدّت للتعديل", observe: "قرار مسؤول التشغيل بسببه وتاريخه، والنسخة باطلة، وزر تقديم نسخة جديدة", expect: "الموعد قريبٌ جداً", scrollTo: "text=الموعد قريبٌ جداً" });
  await shot(page, "06-lead-campaign-in-progress.png", { path: C(IDS.c1), role: "قائد التسويق", action: "حملة قيد التنفيذ", observe: "الخطة معتمدة بمراحلها الثلاث بأسماء أصحابها، وأزرار الحالة", expect: "حملة الإطلاق", full: true });
  await shot(page, "07-lead-tasks-suggestions.png", { path: C(IDS.c1, "tasks"), role: "قائد التسويق", action: "تبويب المهام", observe: "اقتراح الإسناد للمهام بلا مسنَد: الدور المطلوب وعبء كل مرشّح — ولا يُسنَد شيء دون ضغطة", expect: "اقتراح الإسناد", scrollTo: "[data-suggestion]" });
  await shot(page, "08-lead-assign-confirmed.png", {
    path: C(IDS.c1, "tasks"), role: "قائد التسويق", action: "يضغط «أسنِدها إلى…» على مهمة النشر", observe: "الإسناد وقع بفعل القائد ويُسجَّل باسمه في السجل",
    before: async (p) => {
      const box = p.locator("[data-suggestion]").filter({ hasText: "مسؤول النشر" }).first();
      await box.locator("button").first().click();
      await p.waitForTimeout(2500);
      await p.goto(BASE + C(IDS.c1, "tasks"), { waitUntil: "networkidle" });
    },
    expect: "جدولة نشر إعلان لينكدإن", scrollTo: "text=جدولة نشر إعلان لينكدإن",
  });
  await shot(page, "09-lead-team.png", { path: C(IDS.c1, "team"), role: "قائد التسويق", action: "فريق الحملة", observe: "كل شخص بمسؤوليته في هذه الحملة", expect: "كاتب المحتوى" });
  await shot(page, "10-lead-settings.png", { path: "/marketing/settings", role: "قائد التسويق", action: "إعدادات الوكيل", observe: "فريق التسويق ومسؤولياته، وسياسة فصل الاعتماد، وحالة المزوّد «غير مهيّأ»", full: true, redactOpts: { people: true } });
  await shot(page, "11-lead-audit.png", { path: C(IDS.c1, "audit"), role: "قائد التسويق", action: "سجل الحملة", observe: "كل حدث بصاحبه ووقته وتفاصيله (الإسناد، والاعتمادات، وفحص الجودة، والنشر، والنتائج)", expect: "اعتُمدت" });
  await ctx.close();
}

// ── مسؤول التشغيل ثم الرئيس التنفيذي
{
  const { ctx, page } = await login(ROLES.ops);
  await shot(page, "12-ops-dashboard.png", { path: "/marketing", role: "مسؤول التشغيل", action: "لوحة الوكيل", observe: "الخطط التي تنتظر قراره وحده", expect: "حملة المعرض", full: true });
  await shot(page, "13-ops-plan-decision.png", { path: C(IDS.c2), role: "مسؤول التشغيل", action: "يراجع خطة حملة المعرض", observe: "اطّلاع على الموجز والخطة وحدهما (بلا تبويبات عمل الفريق)، واعتماد مرحلة القسم، ونموذج قراره", expect: "حملة المعرض", full: true });
  await shot(page, "14-ops-no-team-work.png", { path: D(IDS.story), role: "مسؤول التشغيل", action: "يفتح رابط مخرجٍ مباشرةً", observe: "«غير موجودة» (404): موقعه في الهيكل لا يفتح مسودات الفريق ولا ملفاته. الصفحة هي صفحة Next.js الافتراضية بالإنجليزية — لا صفحة 404 مخصّصة في المنصة" });
  await ctx.close();
}
{
  const { ctx, page } = await login(ROLES.ceo);
  await shot(page, "15-ceo-final-approval.png", { path: C(IDS.c3), role: "الرئيس التنفيذي", action: "الاعتماد النهائي لخطة حملة التطوع", observe: "مرحلتا القسم والتشغيل معتمدتان بأسماء أصحابهما، ونموذج المرحلة الأخيرة", expect: "حملة التطوع", full: true });
  await ctx.close();
}

// ── كاتب المحتوى
{
  const { ctx, page } = await login(ROLES.writer);
  await shot(page, "16-writer-draft-checks.png", { path: D(IDS.tweet), role: "كاتب المحتوى", action: "يكتب مسودة التغريدة", observe: "تنبيهات آلية (رقم بلا مصدر، رابط غير آمن) لا تمنع، ولوحة الاقتراح الآلي «غير مهيّأ» بلا زر طلب — والحفظ لا يقدّم للمراجعة", expect: "تغريدة الإعلان", element: "#content" });
  await shot(page, "18-writer-own-version.png", { path: D(IDS.story), role: "كاتب المحتوى", action: "نسخته بانتظار المراجعة", observe: "لا يعتمد ما كتب — يعتمده زميل", expect: "ستوري الإطلاق", element: "#content" });
  await ctx.close();
}
{
  const { ctx, page } = await login(ROLES.writer2);
  await shot(page, "19-copy-approval.png", { path: D(IDS.story), role: "كاتب ثانٍ (معتمِد النص)", action: "يعتمد نسخة النص بعينها أو يطلب تعديلاً بسبب", observe: "رقم النسخة وكاتبها، ونموذج القرار", expect: "ستوري الإطلاق", element: "#content" });
  await shot(page, "20-reviews-queue.png", { path: "/marketing/reviews", role: "كاتب ثانٍ", action: "صفحة المراجعات", observe: "ما ينتظر قراره هو وحده" });
  await ctx.close();
}

// ── المصمّمان
{
  const { ctx, page } = await login(ROLES.designer);
  await shot(page, "21-designer-brand-upload.png", {
    path: D(IDS.square), role: "المصمّم", action: "ملفات الهوية الرسمية ورفع نسخة", observe: "روابط الملفات التي تستعملها المنصة، وفحص المقاس من الملف نفسه، ونسخه السابقة",
    before: async (p) => { await p.locator("[data-brand-assets] summary").click(); await p.waitForTimeout(200); },
    expect: "ملفّات الهوية الرسمية", element: "#design",
  });
  await ctx.close();
}
{
  const { ctx, page } = await login(ROLES.designer2);
  await shot(page, "22-design-review-safe-area.png", { path: D(IDS.square), role: "مصمّم ثانٍ (معتمِد التصميم)", action: "يراجع التصميم في معاينته", observe: "المعاينة بالمقاس الحقيقي ومنطقة الأمان، ونموذج اعتماد النسخة", expect: "منشور التعريف", element: "#design" });
  await ctx.close();
}

// ── مراجع الجودة
{
  const { ctx, page } = await login(ROLES.reviewer);
  await shot(page, "23-qa-checklist.png", { path: D(IDS.portrait), role: "مراجع الجودة", action: "يسجّل فحص الجودة", observe: "تسعة بنود على نسختي النص والتصميم بعينهما — والفشل يتطلب ملاحظة", expect: "منشور طولي", element: "#quality" });
  await ctx.close();
}

// ── مسؤول النشر
{
  const { ctx, page } = await login(ROLES.publisher);
  await shot(page, "24-publisher-form.png", { path: D(IDS.linkedin), role: "مسؤول النشر", action: "نموذج تسجيل النشر اليدوي", observe: "الرابط والوقت وتأكيد رؤيته حياً — والنشر نفسه يتم على المنصة يدوياً", expect: "إعلان لينكدإن", element: "#publish" });
  await shot(page, "25-publisher-url-mismatch.png", {
    path: D(IDS.linkedin), role: "مسؤول النشر", action: "يحاول تسجيل رابطٍ ليس على لينكدإن", observe: "رفض الخادم برسالة واضحة، وما كُتب في النموذج لم يُمحَ",
    before: async (p) => {
      const form = p.locator("#publish form").first();
      await form.locator('input[name="url"]').fill("https://www.instagram.com/p/not-linkedin/");
      await form.locator('input[type="checkbox"]').first().check();
      await form.locator('button[type="submit"]').first().click();
      await p.waitForTimeout(2500);
    },
    expect: "لينكدإن", element: "#publish",
  });
  await shot(page, "26-publisher-evidence-results.png", { path: D(IDS.week), role: "مسؤول النشر", action: "منشور مسجَّل بدليله ونتائجه", observe: "الرابط والوقت وصاحب التسجيل، والنتائج بمصدرها وتاريخها (بيانات فحص محلية)", expect: "منشور الأسبوع الأول", element: "#publish" });
  await ctx.close();
}

// ── المؤسس: لا يشارك
{
  manifest.push({ file: "27-founder-excluded.png", role: "المؤسس", action: "يفتح /marketing", observe: "غير متاح: لا بند في القائمة ولا صفحة", captured: false, reason: "يتطلب جلسة المؤسس الحقيقية — لم تُستخدم في الصور؛ المنع مثبتٌ بفحوص الخادم والمتصفح (check-marketing.mjs)" });
}

// ── الجوال
{
  const { ctx, page } = await login(ROLES.writer, { width: 390, height: 844 });
  await shot(page, "28-mobile-deliverable.png", { path: D(IDS.story), role: "كاتب المحتوى (جوال)", action: "صفحة المخرج على الجوال", observe: "بلا تمرير أفقي؛ الأقسام بالترتيب نفسه", expect: "ستوري الإطلاق" });
  await ctx.close();
}

await b.close();
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
const missing = manifest.filter((m) => !m.captured);
console.log(`\n${manifest.length - missing.length}/${manifest.length} captured`);
for (const m of missing) console.log("  outstanding:", m.file, "—", m.reason);
