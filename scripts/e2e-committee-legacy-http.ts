import { prisma } from "@/lib/prisma";
import { issueLoginCode } from "@/lib/loginCodes";
import { hashPassword } from "@/lib/credentials";
import { applyLegacyCase } from "@/lib/org/legacyConversion";

/** **فصلُ قيادة اللجنة — على الخادم الحقيقي (HTTP).**
 *
 *  ما لا تراه دوالُّ المكتبة وحدها: الدخولُ الفعليُّ والجلسةُ وحارسُ المسارات.
 *  - الحسابُ القياديُّ القديم على لجنة لا يدخل (ولا يصل لوحةً ولا صفحة لجان).
 *  - صفحةُ الترحيل للمؤسس وحده: الزائرُ يُحوَّل، وقائدُ القسم «غير موجودة».
 *  - بعد التحويل يدخل **بالكلمة نفسها** عضواً، يقود لجنتَه، ولا يصل شيئاً من لوحات القيادة.
 *  بياناتٌ اصطناعية موسومة (`e2e-lgh`) تُمحى في البداية والنهاية. */

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const MARK = "e2e-lgh";
const DOMAIN = "@e2e-lgh.test";
const PASS = "Separation#2026aa";

const lines: string[] = [];
let failed = 0;
const chk = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  lines.push(`${ok ? "✓" : "✗ FAIL"} ${name}${extra && !ok ? " — " + extra : ""}`);
};

type Jar = { cookie: () => string; jar: Map<string, string> };
/** `LEGACY_SHOTS=<مجلد>`: لقطاتُ الصفحات الجديدة (الترحيل، التسليم، التفويض) على الجوال وسطح المكتب */
const SHOTS = process.env.LEGACY_SHOTS ?? "";
type Shot = { goto(u: string, o?: object): Promise<unknown>; screenshot(o: object): Promise<unknown> };
async function shoot(jar: Jar, path: string, name: string) {
  if (!SHOTS) return;
  const { createRequire } = await import("node:module");
  type B = { newContext(o: object): Promise<{ addCookies(c: object[]): Promise<void>; newPage(): Promise<Shot> }>; close(): Promise<void> };
  const { chromium } = createRequire(`${process.cwd()}/`)("playwright") as { chromium: { launch(): Promise<B> } };
  const browser = await chromium.launch();
  for (const [w, h, tag] of [[390, 844, "390"], [1440, 900, "1440"]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "ar-SA" });
    await ctx.addCookies([...jar.jar].map(([n, v]) => ({ name: n, value: v, domain: new URL(BASE).hostname, path: "/" })));
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await pg.screenshot({ path: `${SHOTS}/${name}-${tag}.png`, fullPage: true });
  }
  await browser.close();
}
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
const toLogin = (p: { status: number; location: string | null }) => p.status === 307 && (p.location ?? "").startsWith("/login");

async function cleanup() {
  const depts = (await prisma.department.findMany({ where: { slug: { startsWith: MARK } }, select: { id: true } })).map((d) => d.id);
  await prisma.orgAuditEvent.deleteMany({ where: { OR: [{ entityId: { in: depts } }, { departmentId: { in: depts } }] } });
  await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: depts } } });
  await prisma.department.updateMany({ where: { id: { in: depts } }, data: { leadMemberId: null } });
  await prisma.member.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.emailLog.deleteMany({ where: { recipient: { endsWith: DOMAIN } } });
  await prisma.loginCode.deleteMany({ where: { email: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.loginAttempt.deleteMany({ where: { identifier: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.leaderSignature.deleteMany({ where: { user: { email: { endsWith: DOMAIN } } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.testTrack.deleteMany({ where: { departmentId: { in: depts } } });
  await prisma.department.deleteMany({ where: { id: { in: depts }, parentId: { not: null } } });
  await prisma.department.deleteMany({ where: { id: { in: depts } } });
}

(async () => {
  await cleanup();
  const hash = await hashPassword(PASS);
  const P = await prisma.department.create({ data: { name: `${MARK} قسم`, slug: `${MARK}-p`, colorHex: "#2F7D32" } });
  const C = await prisma.department.create({
    data: { name: `${MARK} لجنة قديمة`, slug: `${MARK}-c`, colorHex: "#2F7D32", parentId: P.id, committeeStatus: "approved", purpose: "غرض" },
  });
  const track = await prisma.testTrack.create({ data: { scope: "department_member", departmentId: P.id } });
  // مؤسسٌ اختباريٌّ بكلمةٍ معلومة — المؤسسُ الحقيقيُّ في القاعدة المحلية لا تُعرف كلمتُه ولا تُمسّ
  const FD = await prisma.user.create({ data: { fullName: `${MARK} مؤسس`, email: `fd${DOMAIN}`, passwordHash: hash, role: "super_admin" } });
  const RL = await prisma.user.create({ data: { fullName: `${MARK} قائد القسم`, email: `rl${DOMAIN}`, passwordHash: hash, role: "department_admin", departmentId: P.id } });
  const LU = await prisma.user.create({ data: { fullName: `${MARK} قائد لجنة قديم`, email: `lu${DOMAIN}`, passwordHash: hash, role: "department_admin", departmentId: C.id } });
  const inv = await prisma.invite.create({
    data: { fullName: LU.fullName, email: LU.email, targetRole: "department_admin", departmentId: C.id, testTrackId: track.id, invitedById: FD.id, status: "used" },
  });
  await prisma.member.create({
    data: { fullName: LU.fullName, email: LU.email, departmentId: C.id, inviteId: inv.id, passwordHash: null, approvalStatus: "approved" },
  });

  // ═══ قبل التحويل ═══
  chk("الزائرُ لا يصل صفحة الترحيل", toLogin(await page(null, "/admin/org-migration")));
  const jLU = await signIn(LU.email);
  chk("الحسابُ القياديُّ القديم على لجنة لا يدخل: لوحةُ الإدارة تردّه للدخول", toLogin(await page(jLU, "/admin")));
  chk("ولا صفحةُ قسمٍ ولا لجان", toLogin(await page(jLU, `/admin/departments/${P.slug}`)) && toLogin(await page(jLU, "/committees")));
  const jRL = await signIn(RL.email);
  chk("قائدُ القسم الفعليُّ يدخل لوحتَه كما كان", (await page(jRL, "/admin")).status === 200);
  const rlMig = await page(jRL, "/admin/org-migration");
  chk("وصفحةُ الترحيل تردّه بتحويلٍ حقيقي إلى لوحته (لا 200)", rlMig.status === 307 && rlMig.location === "/admin" && !rlMig.html, `${rlMig.status} ${rlMig.location}`);
  const jFD = await signIn(FD.email);
  const mig = await page(jFD, "/admin/org-migration");
  chk("المؤسسُ يرى الجردَ قبل أي تطبيق", mig.status === 200 && mig.html.includes(LU.fullName) && mig.html.includes(">L1<"), String(mig.status));
  chk("وفي صفحة اللجان يُنبَّه إلى ما بقي", (await page(jFD, "/committees")).html.includes('href="/admin/org-migration"'));
  await shoot(jFD, "/admin/org-migration", "org-migration");

  // ═══ التحويل (الدالةُ نفسُها التي يستدعيها زرُّ الصفحة) ═══
  const r = await applyLegacyCase({ kind: "user", id: FD.id, name: FD.fullName }, `L1:${LU.id}`);
  chk("التحويلُ يُطبَّق", r.ok && r.done === "applied", JSON.stringify(r));

  // ═══ بعد التحويل ═══
  const jM = await signIn(LU.email);
  const home = await page(jM, "/committees");
  chk("يدخل بالكلمة نفسها عضواً ويرى لجنتَه", home.status === 200 && home.html.includes(C.name), String(home.status));
  const cd = await page(jM, `/committees/${C.id}`);
  chk("ويقودها", cd.status === 200 && cd.html.includes(LU.fullName));
  chk("ولا تبويبَ إعداداتٍ له (هيكلُها لقائد القسم)", !cd.html.includes("?tab=settings"));
  const adm = await page(jM, "/admin");
  chk("ولا يصل لوحةَ الإدارة", adm.status === 307 && !(adm.location ?? "").startsWith("/admin"), `${adm.status} ${adm.location}`);
  const dept = await page(jM, `/admin/departments/${P.slug}`);
  chk("ولا لوحةَ القسم", dept.status === 307 && !(dept.location ?? "").startsWith("/admin"), `${dept.status} ${dept.location}`);
  const nw = await page(jM, "/committees/new");
  chk("ولا يُنشئ لجنة", nw.status === 307 && nw.location === "/committees", `${nw.status} ${nw.location}`);
  chk("ولا يصل صفحةَ الترحيل", (await page(jM, "/admin/org-migration")).status !== 200);
  // قائدُ القسم: نائبٌ بصلاحيةٍ واحدة (أزرارُ المنح والسحب) وصفحةُ أعضاء اللجنة (التسليم)
  if (SHOTS) {
    const dm = await prisma.member.findUniqueOrThrow({ where: { email: LU.email } });
    const other = await prisma.member.create({
      data: {
        fullName: `${MARK} عضو`, email: `m${DOMAIN}`, departmentId: P.id, approvalStatus: "approved", passwordHash: null,
        inviteId: (await prisma.invite.create({ data: { fullName: "m", email: `m${DOMAIN}`, targetRole: "member", departmentId: P.id, testTrackId: track.id, invitedById: FD.id, status: "used" } })).id,
      },
    });
    await prisma.department.update({ where: { id: P.id }, data: { deputyMemberId: other.id, deputyPermissions: ["members_view"], deputyAppointedAt: new Date(), deputyAppointedByName: RL.fullName } });
    await prisma.member.update({ where: { id: dm.id }, data: { isActive: false, terminatedAt: new Date() } });
    await shoot(jRL, "/committees", "deputy-toggles");
    await shoot(jRL, `/committees/${C.id}?tab=members`, "handover");
    await prisma.department.update({ where: { id: P.id }, data: { deputyMemberId: null, deputyPermissions: [] } });
  }
  const after = await page(jFD, "/admin/org-migration");
  chk("والجردُ بعده لا يُظهر الحساب", after.status === 200 && !after.html.includes(`>L1<`));

  await cleanup();
  for (const l of lines) console.log(l);
  console.log(failed ? `\nFAILURES PRESENT (${failed})` : `\nALL PASS (${lines.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.log(`✗ FAIL crashed: ${(e as Error).stack ?? e}`);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
