import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";
import { marketingActor, type MkActor } from "@/lib/marketing/access";
import { addTeamMember } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { saveDraft } from "@/lib/marketing/content";
import { submitPlan, decidePlan } from "@/lib/marketing/plan";
import { ar } from "@/i18n/dictionaries/ar";
import type { Session } from "next-auth";
import { completePlanForTest } from "./marketing-plan-fixture";

/** صفحاتُ مسار العمل في الخادم المحلي — بجلساتٍ حقيقية (كلمةُ مرورٍ ورمزُ دخولٍ يصدره الفحص).
 *
 *  يثبت أن الواجهة تطابق الخادم: صفحاتُ المحتوى والتصميم والاعتماد والنشر تُرسم لمن يعمل في الحملة
 *  بأعمدتها، وللتنفيذيّ «تطّلع على الخطط وحدها» بلا نموذج اعتماد، ومساعدُ القسم في صفحة التسويق والحملة
 *  والمنشور، والإشعارُ يظهر مرّةً واحدة في المتصفح ثم لا يعود، والجوالُ بلا تمريرٍ أفقي.
 *
 *  يتطلّب خادماً محلياً على قاعدة الفحص نفسها: `AUTH_TRUST_HOST=true next start -p 3000`.
 *    npx tsx --env-file=<env محلي> scripts/check-marketing-workflow-ui.ts */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("على الخادم المحلي وحده");
  process.exit(1);
}

// المتصفحُ المثبّتُ في البيئة (كفحوص المتصفح الأخرى في `scripts/`)
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "/opt/node-tools/node_modules/playwright/index.js";
const MARK = `ui-wf-${Date.now()}`;
const DOMAIN = "@uiwf.example.test";
const PASS = `${MARK}-Pass!9`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);
const must = <R extends { ok: boolean }>(r: R, what: string) => { if (!r.ok) throw new Error(`${what}: ${(r as { code?: string }).code}`); return r as Extract<R, { ok: true }>; };
const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);

async function cleanup() {
  const cs = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: "ui-wf-" } }, select: { id: true } });
  for (const c of cs) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingPlanningCycle.deleteMany({ where: { campaignName: { startsWith: "ui-wf-" } } });
  await prisma.marketingEvent.deleteMany({ where: { OR: [{ actorName: { startsWith: "ui-wf" } }, { campaignId: { in: cs.map((c) => c.id) } }] } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true, email: true } });
  await prisma.marketingMember.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.loginCode.deleteMany({ where: { email: { endsWith: DOMAIN } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

/** دخولٌ حقيقي: رمزُ CSRF، ثم كلمةُ المرور ورمزُ الدخول، ثم كعكاتُ الجلسة */
async function signIn(email: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const keep = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const code = await issueLoginCode(email);
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: PASS, loginCode: String(code), callbackUrl: "/" }),
  });
  keep(res);
  return jar;
}
const page = async (jar: Map<string, string>, path: string) => {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, redirect: "manual" });
  return { status: r.status, html: await r.text() };
};

(async () => {
  await cleanup();
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const tech = await prisma.department.findFirstOrThrow({ where: { slug: "tech" } });
  const passwordHash = await hashPassword(PASS);
  const mk = (k: string, role: "department_admin" | "operations_officer" | "executive", departmentId?: string) =>
    prisma.user.create({ data: { fullName: `ui-wf ${k}`, email: `${k}${DOMAIN}`, passwordHash, role, departmentId, isActive: true, mustChangePassword: false } });
  const U = { lead: await mk("lead", "department_admin", marketing.id), ops: await mk("ops", "operations_officer"), ceo: await mk("ceo", "executive"), w1: await mk("w1", "department_admin", tech.id), d1: await mk("d1", "department_admin", tech.id) };
  const A = async (k: keyof typeof U): Promise<MkActor> => (await marketingActor(asRole(U[k].id, k === "ops" ? "operations_officer" : k === "ceo" ? "executive" : "department_admin", `ui-wf ${k}`)))!;
  const lead = await A("lead");
  const w1m = must(await addTeamMember(lead, { kind: "user", id: U.w1.id, capabilities: ["writer"] }), "w1");
  const d1m = must(await addTeamMember(lead, { kind: "user", id: U.d1.id, capabilities: ["designer"] }), "d1");
  const [w1, ops] = [await A("w1"), await A("ops")];
  const NAME = `${MARK} حملة الواجهة`;
  const C = must(await createCampaign(lead, { name: NAME, channels: ["instagram"] }), "campaign").campaignId;
  await transitionCampaign(lead, C, "briefing");
  await updateBrief(lead, C, { name: NAME, objective: "فحص الواجهة", audience: "طلاب", keyMessage: "نلتقي", channels: ["instagram"], deadline: new Date(Date.now() + 14 * 86400_000) });
  const P1 = must(await createDeliverable(lead, C, { title: "منشور الواجهة الأول", platform: "instagram", formatKey: "square" }), "p1").deliverableId;
  await transitionCampaign(lead, C, "ready_for_planning");
  await addCampaignMember(lead, C, { marketingMemberId: w1m.memberId, role: "writer" });
  await addCampaignMember(lead, C, { marketingMemberId: d1m.memberId, role: "designer" });
  await completePlanForTest(lead, C);
  const plan = must(await submitPlan(lead, C), "plan");

  const jar = { lead: await signIn(U.lead.email), ops: await signIn(U.ops.email), ceo: await signIn(U.ceo.email), w1: await signIn(U.w1.email) };
  // قبل اعتماد القسم: لا نموذجَ لمسؤول التشغيل ولا للتنفيذي؛ والقائدةُ ترى نموذجَ مرحلتها
  const planPath = `/marketing/campaigns/${C}`;
  const opsBefore = await page(jar.ops, planPath);
  const ceoBefore = await page(jar.ceo, planPath);
  const leadBefore = await page(jar.lead, planPath);
  const stageInput = (html: string, stage: string) => new RegExp(`name="stage"[^>]*value="${stage}"|value="${stage}"[^>]*name="stage"`).test(html);
  chk("قائدةُ القسم ترى نموذجَ اعتماد مرحلتها", leadBefore.status === 200 && stageInput(leadBefore.html, "department"));
  chk("ومسؤولُ التشغيل يرى الخطة ولا نموذجَ له قبلها", opsBefore.status === 200 && opsBefore.html.includes(NAME) && !stageInput(opsBefore.html, "operations") && !stageInput(opsBefore.html, "department"));
  chk("والتنفيذيُّ يرى الخطة بلا أي نموذج اعتماد", ceoBefore.status === 200 && ceoBefore.html.includes(NAME) && !stageInput(ceoBefore.html, "executive") && !stageInput(ceoBefore.html, "operations") && !stageInput(ceoBefore.html, "department"));
  must(await decidePlan(lead, C, { planVersionId: plan.planVersionId, stage: "department", decision: "approved" }), "dept");
  const opsAfter = await page(jar.ops, planPath);
  chk("بعد اعتماد القسم: نموذجُ مسؤول التشغيل يظهر", opsAfter.status === 200 && stageInput(opsAfter.html, "operations"));
  must(await decidePlan(ops, C, { planVersionId: plan.planVersionId, stage: "operations", decision: "approved" }), "ops");
  must(await transitionCampaign(lead, C, "in_progress"), "in_progress");
  await saveDraft(w1, P1, "مسودةٌ من الفحص");

  // صفحاتُ العمل
  const content = await page(jar.w1, "/marketing/content");
  chk("«المحتوى» للكاتب: المنشورُ بحملته ورقمه وحالته وخطوته", content.status === 200 && content.html.includes("منشور الواجهة الأول") && content.html.includes(NAME) && content.html.includes("منشور 1") && content.html.includes(ar.mk.work.contentState.writing) && content.html.includes(ar.mk.work.next.write) && content.html.includes(ar.mk.work.mine), String(content.status));
  const design = await page(jar.w1, "/marketing/design");
  const publishing = await page(jar.w1, "/marketing/publishing");
  chk("و«التصميم» و«الاعتماد والنشر» تُرسمان (فارغتين الآن)", design.status === 200 && publishing.status === 200 && design.html.includes(ar.mk.work.empty) && publishing.html.includes(ar.mk.work.empty));
  const ceoWork = await page(jar.ceo, "/marketing/content");
  chk("والتنفيذيُّ: «تطّلع على الخطط وحدها» — لا منشورات", ceoWork.status === 200 && ceoWork.html.includes(ar.mk.work.noAccess) && !ceoWork.html.includes("منشور الواجهة الأول"));
  // مساعدُ القسم
  const home = await page(jar.lead, "/marketing");
  const camp = await page(jar.lead, `/marketing/campaigns/${C}`);
  const post = await page(jar.w1, `/marketing/campaigns/${C}/deliverables/${P1}`);
  chk("مساعدُ القسم في صفحة التسويق والحملة والمنشور", home.status === 200 && home.html.includes(ar.mk.chat.titles.assistant) && camp.html.includes(ar.mk.chat.titles.assistant) && post.status === 200 && post.html.includes(ar.mk.chat.titles.assistant), `${home.status}/${camp.status}/${post.status}`);
  chk("والمساعدُ محلياً يقول الحقيقة: «غير مهيّأ في هذه البيئة» — بلا خانة كتابة مضلِّلة", home.html.includes(ar.mk.chat.notConfigured.split("{0}")[0].trim()) && !/<textarea[^>]*name="body"/.test(home.html));

  // الإشعارُ مرّةً واحدة — في المتصفح
  await prisma.marketingNotice.create({ data: { memberId: w1m.memberId, kind: "post_archived", campaignId: C, deliverableId: P1, params: { campaign: NAME, seq: 1, title: "منشور الواجهة الأول", url: "https://www.instagram.com/p/uiwf/" } } });
  const pw = ((m) => m.default ?? m)(await import(PLAYWRIGHT)) as { chromium: { launch: (o?: object) => Promise<{ newContext: (o?: object) => Promise<{ addCookies: (c: object[]) => Promise<void>; newPage: () => Promise<{ goto: (u: string, o?: object) => Promise<unknown>; content: () => Promise<string>; waitForTimeout: (ms: number) => Promise<void>; evaluate: <T>(fn: () => T) => Promise<T>; setViewportSize: (v: object) => Promise<void> }>; close: () => Promise<void> }>; close: () => Promise<void> }> } };
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar" });
  await ctx.addCookies([...jar.w1].map(([name, value]) => ({ name, value, url: BASE })));
  const tab = await ctx.newPage();
  await tab.goto(`${BASE}/marketing`, { waitUntil: "networkidle" });
  const first = await tab.content();
  await tab.waitForTimeout(800);
  const seen = await prisma.marketingNotice.findFirst({ where: { memberId: w1m.memberId, deliverableId: P1 }, select: { seenAt: true } });
  await tab.goto(`${BASE}/marketing/content`, { waitUntil: "networkidle" });
  const second = await tab.content();
  chk("الإشعارُ يظهر: «تم نشر المنشور الأول في الحملة…»", first.includes("تم نشر المنشور الأول في الحملة"));
  chk("ويُعلَّم مقروءاً لحظةَ ظهوره — من المتصفح لا من رسم الصفحة", !!seen?.seenAt);
  chk("ولا يعود في الصفحة التالية", !second.includes("تم نشر المنشور الأول في الحملة"));
  await tab.setViewportSize({ width: 390, height: 844 });
  await tab.goto(`${BASE}/marketing/content`, { waitUntil: "networkidle" });
  const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  chk("وعلى الجوال (390): «المحتوى» بلا تمريرٍ أفقي", overflow <= 1, `${overflow}px`);
  await ctx.close();
  await browser.close();

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.filter((x) => x.startsWith("✓")).length})`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.log(checks.join("\n"));
  console.error(e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
