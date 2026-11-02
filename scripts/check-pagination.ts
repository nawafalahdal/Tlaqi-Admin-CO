import { issueLoginCode } from "@/lib/loginCodes";
import { prisma } from "@/lib/prisma";

/** **التقسيمُ إلى صفحات** — سجلُّ الأعضاء (`/admin/people`) وقائمةُ أعضاء القسم.
 *
 *  كانت الصفحتان ترسمان الجميع دفعةً واحدة (٣ و٢٫٤ ميغابايت عند ٣٠٠ عضو)، وقائمةُ القسم مقصوصةً
 *  عند ٢٠٠ بلا تنبيه وعنوانُها يَعدّ المقصوص. يتحقّق هذا الفحص — بدخولٍ حقيقيٍّ عبر HTTP — من أن
 *  الصفحاتِ معاً تساوي الكلَّ بلا تكرارٍ ولا سقوط، وأن العدّادات والبحث على السجلّ كلّه، وأن الرقمَ
 *  الشاذَّ يُقيَّد، وأن «رجوع» يحفظ الصفحة.
 *
 *    npx tsx --env-file=<بيئة محلية> scripts/perf-platform.ts seed 300   (أولاً)
 *    npx tsx --env-file=<بيئة محلية> scripts/check-pagination.ts          (والخادم على :3000) */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
async function signIn(email: string) {
  const jar = new Map<string, string>();
  const keep = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${BASE}/api/auth/csrf`); keep(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const code = await issueLoginCode(email);
  keep(await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() }, body: new URLSearchParams({ csrfToken, email, password: "PerfOrg#2026aa", loginCode: String(code), callbackUrl: "/" }) }));
  return cookie();
}
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const plain = (html: string) => html.replaceAll("<!-- -->", "");
const names = (html: string) => new Set([...html.matchAll(/perf-org عضو (\d+)/g)].map((m) => m[1]));
(async () => {
  const ceo = await signIn("ceo@perf-org.test");
  const get = async (p: string) => (await fetch(`${BASE}${p}`, { headers: { cookie: ceo } })).text();
  const p1 = await get("/admin/people?tab=members&dept=" + (await prisma.department.findUniqueOrThrow({ where: { slug: "perf-org-dept" } })).id);
  const deptId = (await prisma.department.findUniqueOrThrow({ where: { slug: "perf-org-dept" } })).id;
  const pages: Set<string>[] = [];
  let pageCount = 0;
  const m = p1.match(/صفحة 1 من (\d+)/);
  pageCount = m ? Number(m[1]) : 0;
  chk("السجلّ يُقسَّم: «صفحة 1 من 6» لـ300 عضو بخمسين", pageCount === 6, String(pageCount));
  for (let i = 1; i <= pageCount; i++) pages.push(names(await get(`/admin/people?tab=members&dept=${deptId}&p=${i}`)));
  const all = new Set(pages.flatMap((s) => [...s]));
  const sum = pages.reduce((n, s) => n + s.size, 0);
  chk("كلُّ صفحةٍ ≤ 50 عضواً", pages.every((s) => s.size <= 50), pages.map((s) => s.size).join(","));
  chk("الصفحاتُ معاً = 300 عضو، بلا تكرارٍ ولا سقوط", all.size === 300 && sum === 300, `${all.size}/${sum}`);
  const tabN = [...plain(p1).matchAll(/roster-tab__n">(\d+)</g)].map((x) => x[1]);
  chk("العدّادُ في التبويب يبقى للسجلّ كلّه لا للصفحة (أعضاء ≥ 300، لا 50)", Number(tabN[2]) >= 300, tabN.join(","));
  const far = await get(`/admin/people?tab=members&dept=${deptId}&p=999`);
  chk("صفحةٌ بعد الأخيرة تُقيَّد بالأخيرة", far.includes(`صفحة ${pageCount} من ${pageCount}`));
  const junk = await get(`/admin/people?tab=members&dept=${deptId}&p=abc`);
  chk("رقمٌ لا يُقرأ = الصفحة الأولى", junk.includes(`صفحة 1 من ${pageCount}`));
  const p2 = await get(`/admin/people?tab=members&dept=${deptId}&p=2`);
  chk("رابطُ التبويب يعود إلى الصفحة الأولى", !/href="\/admin\/people\?tab=leaders[^"]*p=2/.test(p2) && /href="\/admin\/people\?tab=leaders&amp;dept=/.test(p2));
  chk("و«رجوع» من ملفّ الشخص يحفظ الصفحة", /from=%2Fadmin%2Fpeople%3Ftab%3Dmembers%26dept%3D[^"&]*%26p%3D2/.test(p2));
  const q = await get(`/admin/people?tab=members&q=${encodeURIComponent("perf-org عضو 29")}`);
  chk("البحثُ على السجلّ كلّه لا على الصفحة", names(q).has("29") && names(q).has("299") && !q.includes("صفحة 1 من"));

  const lead = await signIn("lead@perf-org.test");
  const d1 = await (await fetch(`${BASE}/admin/departments/perf-org-dept`, { headers: { cookie: lead } })).text();
  chk("قائمةُ القسم: العنوانُ يَعدّ الأعضاء كلّهم (300) لا المقصوص", /\(300\)/.test(plain(d1)));
  chk("وتُقسَّم: «صفحة 1 من 8» بأربعين", d1.includes("صفحة 1 من 8"));
  const dpages: Set<string>[] = [];
  for (let i = 1; i <= 8; i++) {
    const h = await (await fetch(`${BASE}/admin/departments/perf-org-dept?rp=${i}`, { headers: { cookie: lead } })).text();
    const sec = h.slice(h.indexOf('id="roster"'), h.indexOf("</section>", h.indexOf('id="roster"')));
    dpages.push(names(sec));
  }
  const dall = new Set(dpages.flatMap((s) => [...s]));
  chk("صفحاتُ القسم معاً = 300، بلا تكرار", dall.size === 300 && dpages.reduce((n, s) => n + s.size, 0) === 300, `${dall.size}`);
  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})();
