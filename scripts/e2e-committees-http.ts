import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";
import { decideCommittee } from "@/lib/committees";
import { orgActor } from "@/lib/org/actor";
import { createCommittee, appointDeputy, submitCommittee } from "@/lib/org/committeeService";
import { createCommitteeTask, scheduleCommitteeMeeting, addCommitteeDecision, submitCommitteeReport } from "@/lib/org/committeeWork";

/** **صفحاتُ اللجان عبر الخادم المحلي — بدخولٍ حقيقي لكل دور.**
 *
 *  ما يراه كلُّ دورٍ وما لا يصل إليه: القائمة، والإنشاء، وصفحةُ اللجنة وتبويباتها،
 *  والإعدادات لمن يدير وحده، و«غير موجودة» لمن لا صلةَ له. والزائرُ بلا جلسة يُحوَّل.
 *
 *  ومع `COMMITTEES_SHOTS=<مجلد>`: لقطاتٌ بالمتصفّح (٣٩٠ و١٤٤٠، عربي وإنجليزي، فاتح وداكن)
 *  مع فحص التمرير الأفقي وأخطاء الطرفية.
 *
 *  القاعدةُ المحلية وحدها، وبياناتٌ تجريبيةٌ موسومة تُمحى قبله وبعده.
 *    npx tsx --env-file=<ملف البيئة المحلية> scripts/e2e-committees-http.ts */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const MARK = "e2e-cmh";
const DOMAIN = "@e2e-cmh.test";
const PASS = "Committee#2026aa";
const SHOTS = process.env.COMMITTEES_SHOTS ?? "";
/** `COMMITTEES_BROWSER=1`: إجراءاتٌ حقيقية بالمتصفّح — نماذج تُرسَل بنقرة، ونافذةُ تأكيد */
const BROWSER = process.env.COMMITTEES_BROWSER === "1" || !!SHOTS;

const lines: string[] = [];
let failed = 0;
const chk = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  lines.push(`${ok ? "✓" : "✗ FAIL"} ${name}${extra && !ok ? " — " + extra : ""}`);
};

type Jar = { cookie: () => string; jar: Map<string, string> };
async function signIn(email: string): Promise<Jar> {
  const jar = new Map<string, string>();
  const keep = (r: Response) => {
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const loginCode = await issueLoginCode(email);
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: PASS, loginCode: String(loginCode), callbackUrl: "/" }),
  });
  keep(res);
  return { cookie, jar };
}
async function page(j: Jar | null, path: string) {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual", headers: j ? { cookie: j.cookie() } : {} });
  const location = r.headers.get("location")?.replace(/^https?:\/\/[^/]+/, "") ?? null;
  return { status: r.status, location, html: r.status === 200 || r.status === 404 ? await r.text() : "" };
}

async function cleanup() {
  const depts = (await prisma.department.findMany({ where: { slug: { startsWith: MARK } }, select: { id: true } })).map((d) => d.id);
  const cids = (await prisma.department.findMany({ where: { parentId: { in: depts } }, select: { id: true } })).map((c) => c.id);
  await prisma.orgAuditEvent.deleteMany({ where: { OR: [{ entityId: { in: [...cids, ...depts] } }, { departmentId: { in: depts } }] } });
  await prisma.committeeTask.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.committeeDecision.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.committeeAttendance.deleteMany({ where: { meeting: { committeeId: { in: cids } } } });
  await prisma.committeeMeeting.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.committeeReport.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.committeeProposal.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.department.updateMany({ where: { id: { in: depts } }, data: { deputyMemberId: null, deputyPermissions: [] } });
  await prisma.testTrack.deleteMany({ where: { departmentId: { in: [...cids, ...depts] } } });
  await prisma.department.deleteMany({ where: { id: { in: cids } } });
  await prisma.member.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.emailLog.deleteMany({ where: { recipient: { endsWith: DOMAIN } } });
  await prisma.loginCode.deleteMany({ where: { email: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.loginAttempt.deleteMany({ where: { identifier: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.leaderSignature.deleteMany({ where: { user: { email: { endsWith: DOMAIN } } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.department.deleteMany({ where: { id: { in: depts } } });
}

(async () => {
  await cleanup();
  const pw = await hashPassword(PASS);
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const mkDept = (k: string, color: string) => prisma.department.create({ data: { name: `${MARK} قسم ${k}`, slug: `${MARK}-${k}`, colorHex: color } });
  const A = await mkDept("a", "#C34900");
  const B = await mkDept("b", "#3F7D20");
  const mkUser = (tag: string, role: "department_admin" | "operations_officer", departmentId: string | null) =>
    prisma.user.create({ data: { fullName: `${MARK} ${tag}`, email: `${tag}${DOMAIN}`, passwordHash: pw, role, departmentId, mustChangePassword: false } });
  const leadA = await mkUser("leada", "department_admin", A.id);
  const leadB = await mkUser("leadb", "department_admin", B.id);
  const ops = await mkUser("ops", "operations_officer", null);
  const mkMember = async (tag: string, deptId: string) => {
    const email = `${tag}${DOMAIN}`;
    const invite = await prisma.invite.create({ data: { fullName: tag, email, targetRole: "member", departmentId: deptId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
    return prisma.member.create({
      data: { fullName: `${MARK} ${tag}`, email, departmentId: deptId, inviteId: invite.id, passwordHash: pw, approvalStatus: "approved", testStatus: "passed", isActive: true, mustChangePassword: false, jobTitle: "منسّق" },
    });
  };
  const [lead, m1, m2, m3] = [await mkMember("lead", A.id), await mkMember("m1", A.id), await mkMember("m2", A.id), await mkMember("m3", A.id)];
  const outsider = await mkMember("out", B.id);

  const sess = (role: string, id: string, departmentId: string | null, name: string) => ({ user: { id, role, departmentId, name } }) as unknown as Session;
  const LA = (await orgActor(sess("department_admin", leadA.id, A.id, leadA.fullName)))!;
  const made = await createCommittee(LA, A.id, {
    name: `${MARK} لجنة الفعاليات`, purpose: "تنظيم فعاليات القسم", description: "لجنةٌ لتنظيم الفعاليات", scope: "فعاليات القسم",
    kind: "temporary", startDate: "2026-11-01", endDate: "2027-01-31", leadMemberId: lead.id, memberIds: [m1.id, m2.id], submit: true,
  });
  if (!made.ok) throw new Error(made.reason);
  await decideCommittee({ committeeId: made.id, decision: "approved", session: sess("executive", exec.id, null, exec.fullName) });
  const draft = await createCommittee(LA, A.id, { name: `${MARK} لجنة مسودّة`, purpose: "غرض", kind: "permanent", leadMemberId: m3.id, memberIds: [m1.id], submit: false });
  if (!draft.ok) throw new Error(draft.reason);
  await appointDeputy(LA, A.id, m3.id, ["members_view"]);
  const CL = (await orgActor(sess("member", lead.id, A.id, lead.fullName)))!;
  await createCommitteeTask(CL, made.id, { title: "حجز القاعة", assigneeMemberId: m1.id, dueAt: "2026-10-01T23:59:00+03:00", priority: "urgent" });
  await createCommitteeTask(CL, made.id, { title: "قائمة الضيوف", assigneeMemberId: m2.id, dueAt: "2026-12-01T23:59:00+03:00" });
  await scheduleCommitteeMeeting(CL, made.id, { title: "اجتماع التخطيط", startsAt: "2026-11-20T18:00:00+03:00", meetingUrl: "https://meet.google.com/abc-defg-hij", agenda: "١. الميزانية\n٢. التواريخ" });
  await addCommitteeDecision(CL, made.id, { kind: "decision", text: "اعتماد موعد الفعالية الأولى" });
  await submitCommitteeReport(CL, made.id, { periodLabel: "نوفمبر ٢٠٢٦", summary: "بدأ العمل" });
  void submitCommittee;

  const cid = made.id;
  const name = `${MARK} لجنة الفعاليات`;

  // ── الزائرُ بلا جلسة
  const anon = await page(null, "/committees");
  chk("الزائرُ بلا جلسة يُحوَّل إلى الدخول", anon.status === 307 && (anon.location ?? "").startsWith("/login"), `${anon.status} ${anon.location}`);
  const anonC = await page(null, `/committees/${cid}`);
  chk("ولا يصل إلى صفحة لجنة", anonC.status === 307 && (anonC.location ?? "").startsWith("/login"), `${anonC.status}`);

  // ── قائدُ القسم
  const jA = await signIn(leadA.email);
  const la = await page(jA, "/committees");
  chk("قائدُ القسم: القائمةُ تُفتح وفيها لجنتُه", la.status === 200 && la.html.includes(name), String(la.status));
  chk("ونظرةُ قسمه ونائبُه", la.html.includes(`${MARK} m3`) && la.html.includes("نائب قائد القسم"));
  chk("وزرُّ الإنشاء", la.html.includes('href="/committees/new"'));
  chk("وترى المسودّةَ في قسمه", la.html.includes(`${MARK} لجنة مسودّة`));
  chk("صفحةُ الإنشاء تُفتح له", (await page(jA, "/committees/new")).status === 200);
  const ld = await page(jA, `/committees/${cid}`);
  chk("وصفحةُ اللجنة", ld.status === 200 && ld.html.includes("تنظيم فعاليات القسم"));
  chk("وتبويبُ الإعدادات له", ld.html.includes(`/committees/${cid}?tab=settings`));
  for (const tab of ["members", "tasks", "meetings", "decisions", "reports", "log", "settings"]) {
    const r = await page(jA, `/committees/${cid}?tab=${tab}`);
    chk(`تبويبُ «${tab}» يُفتح لقائد القسم`, r.status === 200, String(r.status));
  }
  chk("والمتأخّرُ ظاهرٌ في المهامّ", (await page(jA, `/committees/${cid}?tab=tasks`)).html.includes("متأخرة"));
  chk("ولوحتُه تقود إلى صفحة اللجان", (await page(jA, `/admin/departments/${A.slug}`)).html.includes('href="/committees"'));

  // ── قائدُ قسمٍ آخر
  const jB = await signIn(leadB.email);
  const lb = await page(jB, "/committees");
  chk("قائدُ قسمٍ آخر: لا يرى لجنةَ غيره في قائمته", lb.status === 200 && !lb.html.includes(name));
  const lbd = await page(jB, `/committees/${cid}`);
  chk("ولا تُفتح له صفحتُها — «غير موجودة» لا «ممنوع»", lbd.status === 404, String(lbd.status));
  chk("ولا يصله شيءٌ من بياناتها", !lbd.html.includes("تنظيم فعاليات القسم") && !lbd.html.includes("حجز القاعة"));
  chk("ولا مسودّةُ القسم الآخر", (await page(jB, `/committees/${draft.id}`)).status === 404);

  // ── قائدُ اللجنة (عضو)
  const jL = await signIn(lead.email);
  const cl = await page(jL, `/committees/${cid}`);
  chk("قائدُ اللجنة: صفحتُها تُفتح", cl.status === 200 && cl.html.includes("قائد اللجنة"));
  chk("ولا تبويبَ إعداداتٍ له", !cl.html.includes(`?tab=settings`));
  const cls = await page(jL, `/committees/${cid}?tab=settings`);
  chk("والإعداداتُ بالرابط المباشر تعود للنظرة العامة", cls.status === 200 && !cls.html.includes('name="purpose"'));
  chk("ويرى نموذجَ المهمّة الجديدة", (await page(jL, `/committees/${cid}?tab=tasks`)).html.includes('name="assigneeMemberId"'));
  const cln = await page(jL, "/committees/new");
  chk("ولا يُنشئ لجنة — صفحةُ الإنشاء تردّه", cln.status === 307 && cln.location === "/committees", `${cln.status} ${cln.location}`);

  // ── العضو
  const jM = await signIn(m1.email);
  const ml = await page(jM, "/committees");
  chk("العضو: يرى لجنتَه", ml.status === 200 && ml.html.includes(name));
  chk("ولا يرى المسودّةَ ولو كان فيها", !ml.html.includes(`${MARK} لجنة مسودّة`));
  chk("ولا زرَّ إنشاء", !ml.html.includes('href="/committees/new"'));
  const md = await page(jM, `/committees/${cid}?tab=tasks`);
  chk("ويرى مهمّتَه ويحدّث حالتها", md.status === 200 && md.html.includes("حجز القاعة") && md.html.includes('name="status"'));
  chk("ولا نموذجَ مهمّةٍ جديدة له", !md.html.includes('name="assigneeMemberId"'));
  chk("ولا سجلَّ تغييرات", !(await page(jM, `/committees/${cid}`)).html.includes(`?tab=log`));
  chk("و«لجاني» في بوابته", (await page(jM, "/member")).html.includes('id="committees"'));
  chk("والمسودّةُ لا تُفتح له", (await page(jM, `/committees/${draft.id}`)).status === 404);

  // ── العضو من قسمٍ آخر
  const jO = await signIn(outsider.email);
  const od0 = await page(jO, `/committees/${cid}`);
  chk("عضوُ قسمٍ آخر: لا تُفتح له", od0.status === 404 && !od0.html.includes("تنظيم فعاليات القسم"), String(od0.status));

  // ── مسؤولُ التشغيل
  const jOps = await signIn(ops.email);
  const od = await page(jOps, `/committees/${cid}`);
  chk("مسؤولُ التشغيل: يطّلع", od.status === 200);
  chk("ولا يدير — لا إعدادات", !od.html.includes(`?tab=settings`));
  chk("ولا يُنشئ", (await page(jOps, "/committees/new")).status === 307);
  const rep = await page(jOps, "/admin/reports");
  chk("وتقريرُ اللجان في التقارير", rep.status === 200 && rep.html.includes("اللجان في الأقسام") && rep.html.includes(`${MARK} قسم a`));

  // ── التكامل: التقويم والهيكل
  const calL = await page(jA, "/calendar?m=2026-11");
  chk("التقويم: اجتماعُ اللجنة لقائد القسم", calL.status === 200 && calL.html.includes("اجتماع التخطيط"));
  const calM = await page(jM, "/calendar?m=2026-11");
  chk("والتقويم: ولعضوها", calM.status === 200 && calM.html.includes("اجتماع التخطيط"));
  const calO = await page(jO, "/calendar?m=2026-11");
  chk("ولا يظهر لعضوٍ من قسمٍ آخر", calO.status === 200 && !calO.html.includes("اجتماع التخطيط"));
  const chart = await page(jM, "/structure");
  chk("الهيكل: اللجنةُ بقائدها العضو داخل قسمها", chart.status === 200 && chart.html.includes(`${MARK} lead`) && chart.html.includes(`${MARK} لجنة الفعاليات`));
  chk("والنائبُ موسومٌ في قسمه", chart.html.includes(`نائب قائد ${MARK} قسم a`));

  // ── النائب (بلا تفويض إدارة اللجان)
  const jD = await signIn(m3.email);
  chk("النائبُ بلا تفويض الإدارة: لا يُنشئ", (await page(jD, "/committees/new")).status === 307);

  // ── اللقطات (اختيارية)
  if (BROWSER) await browserFlows(jA, jM, cid, { m1: m1.id, m2: m2.id, deptA: A.id });
  if (SHOTS) await screenshots(jA, jM, cid);

  await cleanup();
  console.log(lines.join("\n"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

/** المتصفّحُ المثبَّت في بيئة الفحص (ليس من اعتماديات المشروع — فلا يدخل البناء) */
type PwLocator = {
  fill(v: string): Promise<void>;
  click(): Promise<void>;
  check(): Promise<void>;
  selectOption(v: string | { label: string }): Promise<unknown>;
  first(): PwLocator;
  filter(o: { hasText: string }): PwLocator;
  locator(sel: string): PwLocator;
  getByRole(role: string, o: { name: string; exact?: boolean }): PwLocator;
  count(): Promise<number>;
};
type PwPage = {
  locator(sel: string): PwLocator;
  getByRole(role: string, o: { name: string; exact?: boolean }): PwLocator;
  waitForURL(re: RegExp, o?: { timeout: number }): Promise<void>;
  waitForLoadState(s: "networkidle"): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
  on(e: "console", f: (m: { type(): string; text(): string }) => void): void;
  on(e: "pageerror", f: (e: Error) => void): void;
  goto(url: string, o: { waitUntil: "networkidle" }): Promise<{ status(): number } | null>;
  evaluate<T>(f: () => T): Promise<T>;
  screenshot(o: { path: string; fullPage: boolean }): Promise<unknown>;
};
type PwContext = {
  addCookies(c: { name: string; value: string; domain: string; path: string }[]): Promise<void>;
  addInitScript(f: (t: string) => void, arg: string): Promise<void>;
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
};
type PwBrowser = { newContext(o: { viewport: { width: number; height: number }; locale: string }): Promise<PwContext>; close(): Promise<void> };

async function launch(): Promise<PwBrowser> {
  // المتصفّحُ مثبَّتٌ خارج المشروع — يُحمَّل بـ`require` (يتبع مسارات البيئة) لا بـ`import`
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(`${process.cwd()}/`)("playwright") as { chromium: { launch(): Promise<PwBrowser> } };
  return chromium.launch();
}

async function pageAs(browser: PwBrowser, jar: Jar): Promise<{ p: PwPage; ctx: PwContext; errors: string[] }> {
  const host = new URL(BASE).hostname;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA" });
  await ctx.addCookies([...jar.jar].map(([n, v]) => ({ name: n, value: v, domain: host, path: "/" })));
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  return { p, ctx, errors };
}

/** إجراءاتٌ بنقرةٍ حقيقية على الجوال: النموذجُ يُرسَل، والإجراءُ يمرّ بالخادم، والقاعدةُ تشهد */
async function browserFlows(leader: Jar, member: Jar, cid: string, ids: { m1: string; m2: string; deptA: string }) {
  const browser = await launch();
  // ١) قائدُ القسم ينشئ لجنةً من النموذج
  {
    const { p, ctx, errors } = await pageAs(browser, leader);
    await p.goto(`${BASE}/committees/new`, { waitUntil: "networkidle" });
    await p.locator('input[name="name"]').fill(`${MARK} لجنة من المتصفّح`);
    await p.locator('textarea[name="purpose"]').fill("غرضٌ مكتوب من النموذج");
    await p.locator('select[name="leadMemberId"]').selectOption(ids.m1);
    await p.locator(`input[name="memberIds"][value="${ids.m2}"]`).check();
    await p.getByRole("button", { name: "حفظ مسودّة" }).click();
    await p.waitForURL(/\/committees\/(?!new)[a-z0-9]+$/, { timeout: 20000 }).catch(() => {});
    const made = await prisma.department.findFirst({ where: { name: `${MARK} لجنة من المتصفّح` }, select: { id: true, committeeStatus: true, leadMemberId: true } });
    chk("المتصفّح: إنشاءُ لجنةٍ من النموذج يُحفظ مسودّةً ويفتح صفحتها", !!made && made.committeeStatus === "draft" && made.leadMemberId === ids.m1 && p.url().endsWith(`/committees/${made.id}`), p.url());
    chk("المتصفّح: بلا أخطاء صفحة", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  // ٢) العضو يحدّث حالة مهمّته
  {
    const { p, ctx, errors } = await pageAs(browser, member);
    await p.goto(`${BASE}/committees/${cid}?tab=tasks`, { waitUntil: "networkidle" });
    const card = p.locator("li").filter({ hasText: "حجز القاعة" }).first();
    await card.locator('select[name="status"]').selectOption("done");
    await card.locator('button[type="submit"]').click();
    await p.waitForTimeout(2500);
    const t = await prisma.committeeTask.findFirst({ where: { committeeId: cid, title: "حجز القاعة" }, select: { status: true, completedAt: true } });
    chk("المتصفّح: العضوُ يحدّث حالة مهمّته فتُحفظ منجزةً بتاريخها", t?.status === "done" && !!t.completedAt, String(t?.status));
    chk("المتصفّح: بلا أخطاء صفحة (العضو)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  // ٣) إخراجُ عضوٍ يمرّ بنافذة التأكيد
  {
    const { p, ctx, errors } = await pageAs(browser, leader);
    await p.goto(`${BASE}/committees/${cid}?tab=members`, { waitUntil: "networkidle" });
    const row = p.locator("li").filter({ hasText: `${MARK} m2` }).first();
    await row.getByRole("button", { name: "إخراج", exact: true }).click();
    await p.waitForTimeout(400);
    const stillActive = await prisma.committeeMembership.findUnique({ where: { committeeId_memberId: { committeeId: cid, memberId: ids.m2 } }, select: { active: true } });
    chk("المتصفّح: الإخراجُ لا يقع قبل التأكيد", stillActive?.active === true);
    await p.locator("dialog[open]").getByRole("button", { name: "إخراج", exact: true }).click();
    await p.waitForTimeout(2500);
    const after = await prisma.committeeMembership.findUnique({ where: { committeeId_memberId: { committeeId: cid, memberId: ids.m2 } }, select: { active: true, removedByName: true } });
    chk("المتصفّح: وبعد التأكيد يُخرَج ويُنسب لفاعله", after?.active === false && !!after.removedByName, JSON.stringify(after));
    chk("المتصفّح: بلا أخطاء صفحة (الإخراج)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  // ٤) تفويضُ النائب من نظرة القسم
  {
    const { p, ctx, errors } = await pageAs(browser, leader);
    await p.goto(`${BASE}/committees`, { waitUntil: "networkidle" });
    const form = p.locator("form").filter({ hasText: "تحديث التفويض" }).first();
    await form.locator('input[name="permissions"][value="tasks_view"]').check();
    await form.getByRole("button", { name: "تحديث التفويض" }).click();
    await p.waitForTimeout(2500);
    const d = await prisma.department.findUnique({ where: { id: ids.deptA }, select: { deputyPermissions: true } });
    chk("المتصفّح: تفويضُ النائب يُحفظ بما اختير", !!d && d.deputyPermissions.includes("tasks_view") && d.deputyPermissions.includes("members_view"), JSON.stringify(d?.deputyPermissions));
    chk("المتصفّح: بلا أخطاء صفحة (التفويض)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  await browser.close();
}

async function screenshots(leader: Jar, member: Jar, cid: string) {
  const browser = await launch();
  const host = new URL(BASE).hostname;
  const pages: [string, Jar, string][] = [
    ["list-leader", leader, "/committees"],
    ["new", leader, "/committees/new"],
    ["detail-overview", leader, `/committees/${cid}`],
    ["detail-members", leader, `/committees/${cid}?tab=members`],
    ["detail-tasks", leader, `/committees/${cid}?tab=tasks`],
    ["detail-meetings", leader, `/committees/${cid}?tab=meetings`],
    ["detail-log", leader, `/committees/${cid}?tab=log`],
    ["detail-settings", leader, `/committees/${cid}?tab=settings`],
    ["member-portal", member, "/member"],
    ["list-member", member, "/committees"],
  ];
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const locale of ["ar", "en"]) {
      for (const theme of ["light", "dark"]) {
        if (theme === "dark" && w === 1440 && locale === "en") continue;
        for (const [label, jar, path] of pages) {
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: locale === "ar" ? "ar-SA" : "en-US" });
          await ctx.addCookies([
            ...[...jar.jar].map(([n, v]) => ({ name: n, value: v, domain: host, path: "/" })),
            { name: "locale", value: locale, domain: host, path: "/" },
          ]);
          await ctx.addInitScript((t) => localStorage.setItem("tlaqi-theme", t), theme);
          const p = await ctx.newPage();
          const errors: string[] = [];
          p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
          p.on("pageerror", (e) => errors.push(e.message));
          const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          const file = `${SHOTS}/${label}-${w}-${locale}-${theme}.png`;
          await p.screenshot({ path: file, fullPage: true });
          const tag = `لقطة ${label} ${w} ${locale} ${theme}`;
          chk(`${tag}: تُفتح`, res?.status() === 200, String(res?.status()));
          chk(`${tag}: بلا تمريرٍ أفقي`, overflow <= 1, `${overflow}px`);
          chk(`${tag}: بلا أخطاء في الطرفية`, errors.length === 0, errors.join(" | ").slice(0, 160));
          await ctx.close();
        }
      }
    }
  }
  await browser.close();
}
