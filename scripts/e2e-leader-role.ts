import type { Session } from "next-auth";
import { encode, decode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";
import {
  createCandidateAccount,
  approveMember,
  completeLeadershipPromotion,
  halfApprovedLeaders,
  findRoleSeatHolder,
} from "@/lib/workflow";
import { getTrackForTarget } from "@/lib/testTracks";
import { resolveSessionAccount } from "@/lib/sessionAccount";
import { canDecideCandidate, canInviteMemberTo } from "@/lib/permissions";
import { canPlanDepartment } from "@/lib/execution";
import { requestCommittee, withdrawCommittee } from "@/lib/committees";
import { buildOrgChart } from "@/lib/orgChart";
import { marketingActor, canEnterMarketing, type MkActor } from "@/lib/marketing/access";
import { assistantView } from "@/lib/marketing/ai/chat";
import { addTeamMember } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { submitPlan, decidePlan } from "@/lib/marketing/plan";
import { workCounts } from "@/lib/marketing/workQueue";
import { completePlanForTest } from "./marketing-plan-fixture";

/** **قائدةُ قسمٍ دُعيت واعتُمدت تُعامَل قائدةً — لا «عضواً».** عبر الخادم المحلي، بدخولٍ حقيقي.
 *
 *  الحادثة (الإنتاج): قائدةُ قسم التسويق دُعيت قائدةً، قبلت الدعوة واختبرت ودخلت، فظهرت «عضو»
 *  بلا أدوات قيادتها — والهيكلُ يُريها قائدةً. سببان في الشيفرة، كلاهما يُعاد إنتاجه هنا:
 *
 *  - **الجلسة:** المرشّحُ القياديُّ يدخل بسجلّ ترشّحه ليختبر، وكانت الجلسةُ تحمل دورَ لحظة الدخول.
 *    من بقي داخلاً حتى اعتُمد بقي «عضواً» — وحسابُه الإداريُّ قائمٌ لا يصل إليه.
 *  - **الاعتماد:** كان يُكتب «معتمَد» قبل إنشاء الحساب الإداري، فإن تعثّر ما بعده بقي المرشّحُ
 *    معتمَداً بلا حساب، يدخل عضواً، وخارج قائمة الاعتماد فلا يعيده أحد.
 *
 *  والفحصُ بنود الطلب الثلاثة عشر، بأرقامها في عناوين الأقسام. وبياناتُه تجريبية (`@e2e-lr.test`)
 *  تُمسح قبله وبعده — لا بيانات أعضاءٍ حقيقيين.
 *
 *    (الخادم يعمل على CHECK_BASE_URL أو localhost:3000 بالقاعدة نفسها، وقسمُ التسويق بلا قائدٍ نشط)
 *    npx tsx --env-file=.env scripts/e2e-leader-role.ts */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const DOMAIN = "@e2e-lr.test";
const MARK = "e2e-lr";
const PASS = "LeadRole#2026aa";
const OTHER_PASS = "Stale#2026bbcc";
const SESSION_COOKIE = "authjs.session-token";

const lines: string[] = [];
let failed = 0;
const section = (t: string) => lines.push(`\n── ${t}`);
const chk = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  lines.push(`${ok ? "✓" : "✗ FAIL"} ${name}${extra && !ok ? " — " + extra : ""}`);
};
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code ?? "?");

type Jar = { cookie: () => string; jar: Map<string, string> };
type SessionJson = { user?: { id?: string; email?: string; role?: string; departmentId?: string | null; departmentSlug?: string | null } } | null;

/** دخولٌ حقيقي: رمزُ CSRF، ثم بيانات الاعتماد مع رمز البريد */
async function signIn(email: string, password = PASS): Promise<Jar> {
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
    body: new URLSearchParams({ csrfToken, email, password, loginCode: String(loginCode), callbackUrl: "/" }),
  });
  keep(res);
  return { cookie, jar };
}
async function sessionOf(j: Jar): Promise<SessionJson> {
  const r = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: j.cookie() } });
  return (await r.json()) as SessionJson;
}
async function page(j: Jar, path: string): Promise<{ status: number; location: string | null; html: string }> {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual", headers: { cookie: j.cookie() } });
  // الوجهةُ نسبيّةً — سواءٌ أعادها الخادم بأصلها أو بدونه
  const location = r.headers.get("location")?.replace(/^https?:\/\/[^/]+/, "") ?? null;
  return { status: r.status, location, html: r.status === 200 ? await r.text() : "" };
}
/** الجلسةُ كما يقرؤها الخادم — كائنُ `Session` الذي تتلقاه إجراءاتُه */
function asSession(s: SessionJson, name: string): Session {
  const u = s?.user;
  if (!u?.id || !u.role) throw new Error("no session");
  return {
    user: { id: u.id, email: u.email ?? "", name, role: u.role, departmentId: u.departmentId ?? null, departmentSlug: u.departmentSlug ?? null, mustChangePassword: false },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  } as Session;
}
/** «بعد خمس دقائق»: يُعاد ختمُ آخر مراجعةٍ في التوكن نفسه (بسرّ الخادم المحلي) — فلا يُنتظر */
async function ageAccountCheck(j: Jar) {
  const secret = process.env.AUTH_SECRET ?? "";
  const raw = j.jar.get(SESSION_COOKIE);
  if (!secret || !raw) throw new Error("no session cookie / secret");
  const token = await decode({ token: raw, secret, salt: SESSION_COOKIE });
  if (!token) throw new Error("undecodable token");
  token.accountCheckedAt = 0;
  j.jar.set(SESSION_COOKIE, await encode({ token, secret, salt: SESSION_COOKIE }));
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const members = await prisma.member.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true, inviteId: true } });
  const cs = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  for (const c of cs) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingPlanningCycle.deleteMany({ where: { campaignName: { startsWith: MARK } } });
  await prisma.marketingEvent.deleteMany({ where: { OR: [{ campaignId: { in: cs.map((c) => c.id) } }, { actorName: { startsWith: MARK } }] } });
  await prisma.marketingMember.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { memberId: { in: members.map((m) => m.id) } }] } });
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.request.deleteMany({ where: { linkedMemberId: { in: members.map((m) => m.id) } } });
  await prisma.department.deleteMany({ where: { slug: { startsWith: MARK }, parentId: { not: null } } });
  await prisma.department.deleteMany({ where: { name: { startsWith: MARK }, parentId: { not: null } } });
  for (const m of members) {
    await prisma.member.delete({ where: { id: m.id } });
    await prisma.invite.deleteMany({ where: { id: m.inviteId } });
  }
  await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.department.deleteMany({ where: { slug: { startsWith: MARK } } });
  await prisma.loginCode.deleteMany({ where: { email: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.loginAttempt.deleteMany({ where: { identifier: { endsWith: DOMAIN } } }).catch(() => {});
}

(async () => {
  await cleanup();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const seat = await findRoleSeatHolder("department_admin", marketing.id);
  if (seat) {
    console.error(`قسم التسويق له قائدٌ نشط محلياً (${seat.fullName}) — يُشغَّل الفحص على قاعدةٍ قسمُ التسويق فيها شاغر`);
    process.exit(1);
  }
  const mkDept = (key: string) =>
    prisma.department.create({ data: { name: `${MARK} قسم ${key}`, slug: `${MARK}-${key}`, colorHex: "#67C090" } });
  const other = await mkDept("other");
  const crowded = await mkDept("crowded");
  const spare = await mkDept("spare");
  const pwHash = await hashPassword(PASS);
  const mkUser = (key: string, role: "department_admin" | "operations_officer" | "executive", departmentId?: string) =>
    prisma.user.create({ data: { fullName: `${MARK} ${key}`, email: `${key}${DOMAIN}`, passwordHash: pwHash, role, departmentId, isActive: true } });
  // التشغيلُ والتنفيذيُّ لفحص سلسلة الاعتماد — من القاعدة إن وُجدا، وإلا حسابا فحص
  const ops = (await prisma.user.findFirst({ where: { role: "operations_officer", isActive: true } })) ?? (await mkUser("ops", "operations_officer"));
  const ceo = (await prisma.user.findFirst({ where: { role: "executive", isActive: true } })) ?? (await mkUser("ceo", "executive"));
  const sessionFor = (u: { id: string; email: string; role: string; departmentId: string | null }, name: string) =>
    asSession({ user: { id: u.id, email: u.email, role: u.role, departmentId: u.departmentId } }, name);
  const founderS = sessionFor(founder, "founder");
  const opsS = sessionFor(ops, "ops");
  const ceoS = sessionFor(ceo, "ceo");
  const leaderTrack = await getTrackForTarget("department_admin", null);

  // ───────────────────────── ١، ٢: الدعوة ثم القبول ثم الاعتماد — المسار الذي سلكته قائدة التسويق
  section("١) دعوةُ قائدة قسم التسويق تُقبل، فيُحفظ دورُها وقسمُها — حساباً واحداً لا اثنين");
  const leadEmail = `lead${DOMAIN}`;
  const inv = await createCandidateAccount({
    fullName: `${MARK} قائدة التسويق`,
    email: leadEmail,
    jobTitle: "قائدة قسم التسويق",
    targetRole: "department_admin",
    departmentId: marketing.id,
    testTrackId: leaderTrack.id,
    invitedById: founder.id,
  });
  chk("الدعوةُ لمنصب قائد قسم في التسويق", inv.invite.targetRole === "department_admin" && inv.invite.departmentId === marketing.id);
  const first = await signIn(leadEmail, inv.tempPassword);
  const s0 = await sessionOf(first);
  chk("تدخل بالرمز المؤقت مرشّحةً لتغيّره وتختبر", s0?.user?.role === "member", JSON.stringify(s0?.user));
  // تغيير الكلمة يُخرجها (`changePasswordAction`) — فتدخل من جديد بكلمتها، وتختار مخاطبتها، وتجتاز اختبارها
  await prisma.member.update({ where: { id: inv.member.id }, data: { passwordHash: pwHash, mustChangePassword: false, gender: "female", testStatus: "passed", testScore: 96 } });
  const candidate = await signIn(leadEmail);
  chk("ثم تدخل بكلمتها مرشّحةً (قبل الاعتماد)", (await sessionOf(candidate))?.user?.role === "member");
  chk("ولا يعتمدها إلا المؤسس أو التنفيذي — لا التشغيلُ ولا قائدُ قسم",
    canDecideCandidate(founderS.user, { targetRole: "department_admin", departmentId: marketing.id }) &&
    canDecideCandidate(ceoS.user, { targetRole: "department_admin", departmentId: marketing.id }) &&
    !canDecideCandidate(opsS.user, { targetRole: "department_admin", departmentId: marketing.id }));
  await approveMember(inv.member.id);
  const leaderUsers = await prisma.user.findMany({ where: { email: leadEmail } });
  const leader = leaderUsers[0];
  chk("بعد الاعتماد: حسابٌ إداريٌّ واحد — قائد قسم، في التسويق، نشط",
    leaderUsers.length === 1 && leader.role === "department_admin" && leader.departmentId === marketing.id && leader.isActive && leader.gender === "female");
  const rec = await prisma.member.findUniqueOrThrow({ where: { id: inv.member.id } });
  chk("وسجلُّ الترشّح معتمَد، كلمتُه نُقلت إلى الحساب (لا مدخلان لشخصٍ واحد)", rec.approvalStatus === "approved" && rec.passwordHash === null);
  chk("ولا ترشّحَ ولا دعوةَ مكرّرة بالبريد", (await prisma.member.count({ where: { email: leadEmail } })) === 1 && (await prisma.invite.count({ where: { email: leadEmail } })) === 1);
  const chart = await buildOrgChart("ar");
  const mkSeat = chart.departments.find((d) => d.id === marketing.id);
  chk("والهيكل يُريها قائدةَ التسويق — لا عضواً فيه",
    mkSeat?.lead.kind === "filled" && mkSeat.lead.person.fullName === leader.fullName && !mkSeat.members.some((m) => m.fullName === leader.fullName));

  section("٢) لا تُصنَّف عضواً — لا في جلستها القديمة ولا في الجديدة");
  const stale = await sessionOf(candidate);
  chk("**جلسةُ المرشّحة المفتوحة لحظةَ اعتمادها تُبطَل فوراً** (كانت تبقى «عضواً»)", !stale?.user, JSON.stringify(stale?.user));
  const staleAdmin = await page(candidate, "/admin");
  chk("وفتحُ لوحة الإدارة بها يُعيد إلى الدخول — لا إلى بوابة الأعضاء", staleAdmin.status === 307 && (staleAdmin.location ?? "").startsWith("/login"), String(staleAdmin.location));
  const lj = await signIn(leadEmail);
  const ls = await sessionOf(lj);
  chk("وتدخل بالكلمة نفسها فتصل حسابَها القيادي: department_admin في التسويق",
    ls?.user?.role === "department_admin" && ls.user.id === leader.id && ls.user.departmentId === marketing.id && ls.user.departmentSlug === "marketing", JSON.stringify(ls?.user));
  const leadS = asSession(ls, leader.fullName);
  chk("والخادمُ يحسم هويتَها من القاعدة: سجلُّ الترشّح «حلّ محلَّه حسابٌ إداري»، والحسابُ حيٌّ بدوره وقسمه",
    (await resolveSessionAccount(inv.member.id, "member")).status === "superseded" &&
    JSON.stringify(await resolveSessionAccount(leader.id, "department_admin")) === JSON.stringify({ status: "live", role: "department_admin", departmentId: marketing.id, departmentSlug: "marketing", leadershipCandidate: false }));

  // ───────────────────────── ٣: الهوية في الواجهة
  section("٣) الملفُّ والقائمة يعرّفانها قائدةً لقسم التسويق");
  const home = await page(lj, "/admin");
  chk("لوحتُها /admin تُفتح", home.status === 200, String(home.status));
  chk("والقائمة تُسمّيها «قائدة قسم التسويق»", home.html.includes("قائدة قسم التسويق"));
  chk("وفي القائمة وكيلُ التسويق وأعضاءُ قسمها", home.html.includes('href="/marketing"') && home.html.includes('href="/admin/departments/marketing"'));
  const profile = await page(lj, "/admin/profile");
  chk("وبياناتُها تقول «قائدة قسم التسويق»", profile.status === 200 && profile.html.includes("قائدة قسم التسويق"));
  const memberPortal = await page(lj, "/member");
  chk("وبوابةُ الأعضاء ليست لها — تُعاد إلى لوحتها", memberPortal.status === 307 && (memberPortal.location ?? "").endsWith("/admin"));

  // ───────────────────────── ٤: دعوة الأعضاء
  section("٤) دعوةُ الأعضاء إلى قسمها");
  const deptPage = await page(lj, "/admin/departments/marketing");
  chk("صفحةُ إدارة قسمها تُفتح", deptPage.status === 200, String(deptPage.status));
  chk("والقاعدةُ التي يفرضها إجراءُ الدعوة تُجيزها في قسمها — ولا تُجيزها في غيره",
    canInviteMemberTo(leadS.user, marketing.id) && !canInviteMemberTo(leadS.user, other.id));
  const memberInv = await createCandidateAccount({
    fullName: `${MARK} عضوة التسويق`,
    email: `member${DOMAIN}`,
    jobTitle: "كاتبة محتوى",
    targetRole: "member",
    departmentId: marketing.id,
    testTrackId: (await getTrackForTarget("member", marketing.id)).id,
    invitedById: leader.id,
  });
  chk("ودعوتُها تُصدر حسابَ مرشّحٍ في قسمها", memberInv.invite.departmentId === marketing.id && memberInv.invite.invitedById === leader.id);
  chk("وتعتمد عضوَ قسمها (لا قائداً ولا من قسمٍ آخر)",
    canDecideCandidate(leadS.user, { targetRole: "member", departmentId: marketing.id }) &&
    !canDecideCandidate(leadS.user, { targetRole: "member", departmentId: other.id }) &&
    !canDecideCandidate(leadS.user, { targetRole: "department_admin", departmentId: marketing.id }));
  await prisma.member.update({ where: { id: memberInv.member.id }, data: { passwordHash: pwHash, mustChangePassword: false, testStatus: "passed", testScore: 90 } });
  await approveMember(memberInv.member.id);

  // ───────────────────────── ٥: التكليف
  section("٥) تكليفُ أعضاء قسمها");
  chk("تبني خطةَ قسمها وتُسند مهامَّه (`canPlanDepartment`) — في قسمها وحده",
    canPlanDepartment(leadS, marketing.id) && !canPlanDepartment(leadS, other.id));
  const exec = await page(lj, "/admin/execution");
  chk("وصفحةُ التنفيذ والأهداف تُفتح لها", exec.status === 200, String(exec.status));

  // ───────────────────────── ٦: اللجان
  section("٦) رفعُ طلب لجنة");
  const committee = await requestCommittee({ parentId: marketing.id, name: `${MARK} لجنة المحتوى`, session: leadS });
  chk("تقترح لجنةً داخل قسمها", committee.ok, committee.ok ? "" : committee.reason);
  if (committee.ok) {
    const c = await prisma.department.findUniqueOrThrow({ where: { id: committee.id } });
    chk("والطلبُ ينتظر قرارَ الإدارة — لا يُفتح بقرارها", c.parentId === marketing.id && c.committeeStatus === "pending_review");
    chk("وتسحبه إن شاءت", (await withdrawCommittee({ committeeId: committee.id, session: leadS })).ok);
  }
  chk("ولا تقترح في قسمٍ غير قسمها", !(await requestCommittee({ parentId: other.id, name: `${MARK} لجنة دخيلة`, session: leadS })).ok);

  // ───────────────────────── ٧، ٨: وكيل التسويق ومساعده
  section("٧) مساعدُ القسم (Claude) متاحٌ لها");
  const lead: MkActor = (await marketingActor(leadS))!;
  chk("قائدةُ التسويق من الهيكل: تدخل الوكيل، وتعتمد في مرحلة القسم", lead.isMarketingLead && canEnterMarketing(lead) && lead.planStage === "department" && !lead.isFounder);
  const assistant = await assistantView(lead, null, null, { status: () => ({ state: "ready", provider: "simulated", model: null, simulated: true, reason: null }) });
  chk("ومساعدُ القسم يُفتح لها", assistant !== null);
  const mkHome = await page(lj, "/marketing");
  chk("وصفحةُ الوكيل تعرضه", mkHome.status === 200 && mkHome.html.includes("مساعد قسم التسويق"), String(mkHome.status));

  section("٨) صفحاتُ إدارة سير العمل التسويقي");
  for (const p of ["/marketing/campaigns", "/marketing/content", "/marketing/design", "/marketing/publishing", "/marketing/reviews", "/marketing/settings", "/marketing/archive"]) {
    const r = await page(lj, p);
    chk(`${p} تُفتح لها`, r.status === 200, String(r.status));
  }

  // ───────────────────────── ١٢ (والسابع ضمناً): الاعتماد باثنين — ولا يتغيّر بالإصلاح
  section("١٢) اعتمادُ الحملة ما يزال يتطلّب قائدةَ القسم ومسؤولَ التشغيل معاً — والتنفيذيُّ لا يعتمد");
  const opsA = (await marketingActor(opsS))!;
  const ceoA = (await marketingActor(ceoS))!;
  const team = await addTeamMember(lead, { kind: "member", id: memberInv.member.id, capabilities: ["writer", "designer"] });
  const c = await createCampaign(lead, { name: `${MARK} حملة الإطلاق`, channels: ["instagram"] });
  if (!team.ok || !c.ok) throw new Error(`stop campaign ${code(team)} ${code(c)}`);
  await transitionCampaign(lead, c.campaignId, "briefing");
  await updateBrief(lead, c.campaignId, { name: `${MARK} حملة الإطلاق`, objective: "هدف", audience: "جمهور", keyMessage: "رسالة", channels: ["instagram"], deadline: new Date(Date.now() + 20 * 86400_000) });
  const d = await createDeliverable(lead, c.campaignId, { title: "منشور 1", platform: "instagram", formatKey: "square" });
  if (!d.ok) throw new Error("stop deliverable " + code(d));
  await transitionCampaign(lead, c.campaignId, "ready_for_planning");
  await addCampaignMember(lead, c.campaignId, { marketingMemberId: team.memberId, role: "writer" });
  await addCampaignMember(lead, c.campaignId, { marketingMemberId: team.memberId, role: "designer" });
  await completePlanForTest(lead, c.campaignId);
  const plan = await submitPlan(lead, c.campaignId);
  if (!plan.ok) throw new Error("stop plan " + code(plan));
  const dec = (a: MkActor, stage: string) => decidePlan(a, c.campaignId, { planVersionId: plan.planVersionId, stage, decision: "approved" });
  chk("التنفيذيُّ لا يعتمد بأيّ مرحلة", ceoA.planStage === null && code(await dec(ceoA, "department")) === "forbidden" && code(await dec(ceoA, "operations")) === "forbidden");
  chk("ومسؤولُ التشغيل لا يسبق القائدة", code(await dec(opsA, "operations")) === "invalid_state");
  chk("والقائدةُ تعتمد مرحلتها", (await dec(lead, "department")).ok);
  chk("واعتمادُها وحده لا يبدأ التنفيذ", code(await transitionCampaign(lead, c.campaignId, "in_progress")) === "plan_not_approved");
  chk("ومسؤولُ التشغيل يعتمد الأخيرة، فيبدأ التنفيذ", (await dec(opsA, "operations")).ok && (await transitionCampaign(lead, c.campaignId, "in_progress")).ok);

  // ───────────────────────── المتابعة
  section("٧ب) متابعةُ الفريق والمهام: ما ينتظر ومن عليه الخطوة");
  const counts = await workCounts(lead);
  chk("ترى أعمالَ الفريق في صفحات العمل (المحتوى/التصميم/النشر)", counts.content >= 1, JSON.stringify(counts));
  chk("وترى عضوَ قسمها في صفحة قسمها", (await page(lj, "/admin/departments/marketing")).html.includes(`${MARK} عضوة التسويق`));

  // ───────────────────────── ٩: العضو العادي
  section("٩) العضوُ العادي لا ينال شيئاً من أدوات القيادة");
  const mj = await signIn(`member${DOMAIN}`);
  const ms = await sessionOf(mj);
  chk("يدخل عضواً", ms?.user?.role === "member", JSON.stringify(ms?.user));
  const memberS = asSession(ms, "member");
  chk("لا يدعو، ولا يكلّف، ولا يعتمد مرشّحاً",
    !canInviteMemberTo(memberS.user, marketing.id) && !canPlanDepartment(memberS, marketing.id) &&
    !canDecideCandidate(memberS.user, { targetRole: "member", departmentId: marketing.id }));
  chk("ولا يقترح لجنة", !(await requestCommittee({ parentId: marketing.id, name: `${MARK} لجنة عضو`, session: memberS })).ok);
  const memberA = (await marketingActor(memberS))!;
  chk("وفي الوكيل: ما مُنح له فقط — لا قيادةَ ولا مرحلةَ اعتماد", !memberA.isMarketingLead && memberA.planStage === null);
  const deptAsMember = await page(mj, "/admin/departments/marketing");
  chk("وصفحةُ إدارة القسم تردّه إلى بوابته", deptAsMember.status === 307 && (deptAsMember.location ?? "").endsWith("/member"));

  // ───────────────────────── ١٠: الخادم يفرض — لا الواجهة
  section("١٠) الصلاحيةُ في الخادم ولو عُبث بالواجهة");
  const forged: Jar = { jar: new Map(mj.jar), cookie: () => "" };
  const raw = forged.jar.get(SESSION_COOKIE) ?? "";
  forged.jar.set(SESSION_COOKIE, raw.slice(0, -6) + (raw.endsWith("AAAAAA") ? "BBBBBB" : "AAAAAA"));
  forged.cookie = () => [...forged.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  chk("توكنٌ معدَّل لا يُقبل جلسةً", !(await sessionOf(forged))?.user);
  const forgedAdmin = await page(forged, "/admin/departments/marketing");
  chk("ولا يفتح صفحةَ الإدارة", forgedAdmin.status === 307 && (forgedAdmin.location ?? "").startsWith("/login"));
  chk("والقائدةُ لا تملك ما فوق قسمها: لا اعتمادَ قادة، ولا لجانَ غيرها، ولا تخطيطَ قسمٍ آخر",
    !canDecideCandidate(leadS.user, { targetRole: "executive", departmentId: null }) &&
    !canDecideCandidate(leadS.user, { targetRole: "operations_officer", departmentId: null }) &&
    !canPlanDepartment(leadS, other.id) && leadS.user.role === "department_admin");

  // ───────────────────────── ١١: تغيّر الحساب بعد الدخول
  section("١١) تغيّرُ الدور أو الحساب يسري على الجلسة — بالمراجعة الدورية أو بدخولٍ جديد");
  await prisma.user.update({ where: { id: leader.id }, data: { departmentId: other.id } });
  await ageAccountCheck(lj);
  const moved = await sessionOf(lj);
  chk("نقلُها إلى قسمٍ آخر يظهر في جلستها عند المراجعة — من القاعدة لا من التوكن", moved?.user?.departmentId === other.id && moved.user.departmentSlug === other.slug, JSON.stringify(moved?.user));
  await prisma.user.update({ where: { id: leader.id }, data: { departmentId: marketing.id } });
  await ageAccountCheck(lj);
  chk("وإعادتُها تعيده", (await sessionOf(lj))?.user?.departmentId === marketing.id);
  await prisma.member.update({ where: { id: inv.member.id }, data: { passwordHash: await hashPassword(OTHER_PASS) } });
  const viaOld = await sessionOf(await signIn(leadEmail, OTHER_PASS));
  chk("**وكلمةٌ على سجلّ ترشّحها لا تُدخلها «عضواً»** — حسابُها الإداريُّ صاحبُ البريد", !viaOld?.user, JSON.stringify(viaOld?.user));
  chk("وتدخل بكلمة حسابها كما هي", (await sessionOf(await signIn(leadEmail)))?.user?.role === "department_admin");
  await prisma.member.update({ where: { id: inv.member.id }, data: { passwordHash: null } });
  await prisma.user.update({ where: { id: leader.id }, data: { isActive: false } });
  await ageAccountCheck(lj);
  chk("وتعطيلُ الحساب يُبطل جلستَه", !(await sessionOf(lj))?.user);
  await prisma.user.update({ where: { id: leader.id }, data: { isActive: true } });

  // ───────────────────────── الاعتماد معاملةٌ واحدة، وإصلاحُ ما تعثّر قبله
  section("١ب) الاعتمادُ وإنشاءُ الحساب معاً أو لا شيء");
  const blocked = await createCandidateAccount({ fullName: `${MARK} مرشّح مزدحم`, email: `crowded-cand${DOMAIN}`, jobTitle: "قائد", targetRole: "department_admin", departmentId: crowded.id, testTrackId: leaderTrack.id, invitedById: founder.id });
  await prisma.member.update({ where: { id: blocked.member.id }, data: { passwordHash: pwHash, mustChangePassword: false, testStatus: "passed", testScore: 90 } });
  await mkUser("crowded-holder", "department_admin", crowded.id);
  const err = await approveMember(blocked.member.id).then(() => "", (e: Error) => e.message);
  const after = await prisma.member.findUniqueOrThrow({ where: { id: blocked.member.id } });
  chk("منصبٌ شُغل قبل الاعتماد: يُرفض الاعتماد بسببه", err.includes("مشغول"), err);
  chk("**ويبقى المرشّحُ في قائمته كما كان** — لا «معتمَداً بلا حساب»", after.approvalStatus === "pending_review" && after.passwordHash !== null && !(await prisma.user.findUnique({ where: { email: blocked.member.email } })));
  chk("واعتمادُه مرّتين لا يُنشئ حسابين", (await approveMember(inv.member.id).then(() => "ok", (e: Error) => e.message)).length > 0 && (await prisma.user.count({ where: { email: leadEmail } })) === 1);

  section("١ج) اعتمادٌ تعثّر قبل الإصلاح (كما قد يكون في الإنتاج) يُكمَل — بلا تكرار");
  const halfInvite = await prisma.invite.create({ data: { fullName: `${MARK} قائد نصف معتمد`, email: `half${DOMAIN}`, targetRole: "department_admin", departmentId: spare.id, testTrackId: leaderTrack.id, invitedById: founder.id, status: "used" } });
  const half = await prisma.member.create({ data: { fullName: `${MARK} قائد نصف معتمد`, email: `half${DOMAIN}`, inviteId: halfInvite.id, departmentId: spare.id, approvalStatus: "approved", testStatus: "passed", decidedAt: new Date(), isActive: true, passwordHash: pwHash } });
  chk("يظهر في قائمة «اعتماداتٌ قيادية لم تكتمل»", (await halfApprovedLeaders()).some((m) => m.id === half.id));
  const hj = await signIn(half.email);
  chk("وقبل إكماله يدخل عضواً (هذا هو العَرَض)", (await sessionOf(hj))?.user?.role === "member");
  chk("ولا يُكمله إلا من يملك اعتمادَ منصبه", !canDecideCandidate(leadS.user, { targetRole: "department_admin", departmentId: spare.id }) && canDecideCandidate(founderS.user, { targetRole: "department_admin", departmentId: spare.id }));
  const done = await completeLeadershipPromotion(half.id, "فحص");
  const halfUsers = await prisma.user.findMany({ where: { email: half.email } });
  chk("الإكمالُ يُنشئ حسابَه القيادي في قسمه، وينقل كلمتَه", done.created && halfUsers.length === 1 && halfUsers[0].role === "department_admin" && halfUsers[0].departmentId === spare.id && (await prisma.member.findUniqueOrThrow({ where: { id: half.id } })).passwordHash === null);
  chk("وإعادتُه لا تُنشئ ثانياً", !(await completeLeadershipPromotion(half.id)).created && (await prisma.user.count({ where: { email: half.email } })) === 1);
  chk("ويخرج من القائمة", !(await halfApprovedLeaders()).some((m) => m.id === half.id));
  chk("وجلستُه العضوية القديمة تُبطَل فوراً", !(await sessionOf(hj))?.user);
  chk("ويدخل بكلمته نفسها قائداً", (await sessionOf(await signIn(half.email)))?.user?.role === "department_admin");
  const halfInvite2 = await prisma.invite.create({ data: { fullName: `${MARK} نصف معتمد مزدحم`, email: `half2${DOMAIN}`, targetRole: "department_admin", departmentId: crowded.id, testTrackId: leaderTrack.id, invitedById: founder.id, status: "used" } });
  const half2 = await prisma.member.create({ data: { fullName: `${MARK} نصف معتمد مزدحم`, email: `half2${DOMAIN}`, inviteId: halfInvite2.id, departmentId: crowded.id, approvalStatus: "approved", testStatus: "passed", decidedAt: new Date(), isActive: true, passwordHash: pwHash } });
  const e2 = await completeLeadershipPromotion(half2.id).then(() => "", (e: Error) => e.message);
  chk("ومنصبٌ مشغولٌ يمنع الإكمال بسببٍ مسمّى، ولا يُنشئ شيئاً", e2.includes("مشغول") && !(await prisma.user.findUnique({ where: { email: half2.email } })), e2);

  // ───────────────────────── ١٣ يُثبته تشغيلُ الحِزَم الموجودة بعد هذا الفحص
  await cleanup();
  console.log(lines.join("\n"));
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${lines.filter((l) => l.startsWith("✓")).length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.log(lines.join("\n"));
  console.error(e);
  await cleanup().catch((x) => console.error("cleanup", x));
  await prisma.$disconnect();
  process.exit(1);
});
