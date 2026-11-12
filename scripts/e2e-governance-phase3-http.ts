import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { issueLoginCode } from "@/lib/loginCodes";
import { hashPassword } from "@/lib/credentials";
import { terminateMembership } from "@/lib/org/membership";
import { changeDepartmentLeader } from "@/lib/org/departmentLeadership";

/** **المرحلة الثالثة على الخادم الحقيقي (HTTP):** ما لا تراه المكتبةُ وحدها.
 *  - صفحتا «تغيير قائد القسم» و«حالة العضوية» للمؤسس والرئيس: غيرُهما يُردّ بتحويلٍ حقيقي (307) — والطلبُ المباشر
 *    لا يتجاوزهما (والقاعدةُ تفحص الدورَ ثانيةً في `lib/org`، يثبته `e2e-governance-phase3`).
 *  - **الإبطالُ الفوري:** جلسةُ عضوٍ أُنهيت عضويتُه تسقط في طلبها التالي بعد حقبة الإبطال (ثوانٍ)، لا بعد خمس دقائق.
 *  - وجلسةُ قائد قسمٍ سُحبت قيادتُه تسقط كذلك.
 *  - **لا تجاوزَ بطلبٍ مباشر:** تُنادى إجراءاتُ الخادم (Server Actions) بمعرّفاتها من بيان البناء، بلا واجهة،
 *    بجلسة المؤسس: ما دام قائدُ اللجنة نشطاً يُرفض كلُّ إجراءٍ إداري، وبعد مغادرته يُقبل — والقاعدةُ هي الحَكَم.
 *  بياناتٌ اصطناعية موسومة (`e2e-g3h`) تُمحى في البداية والنهاية. */

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const MARK = "e2e-g3h";
const DOMAIN = "@e2e-g3h.test";
const PASS = "Governance#2026aa";
const EPOCH_WAIT = Number(process.env.REVOCATION_EPOCH_TTL_MS ?? 5000) + 1500;

const lines: string[] = [];
let failed = 0;
const chk = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  lines.push(`${ok ? "✓" : "✗ FAIL"} ${name}${extra && !ok ? " — " + extra : ""}`);
};
type Jar = { cookie: () => string };
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
  return { cookie };
}
async function page(j: Jar | null, path: string) {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual", headers: j ? { cookie: j.cookie() } : {} });
  const location = r.headers.get("location")?.replace(/^https?:\/\/[^/]+/, "") ?? null;
  return { status: r.status, location, html: r.status === 200 ? await r.text() : "" };
}
const toLogin = (p: { status: number; location: string | null }) => p.status === 307 && (p.location ?? "").startsWith("/login");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** **طلبٌ مباشرٌ إلى إجراء الخادم** — كما يرسله أيُّ عميلٍ يعرف المعرّف، لا كما ترسله الواجهة: معرّفُ الإجراء
 *  من بيان البناء الجاري، والنموذجُ بترميز React للردّ (`0` جذرُ الوسائط، و`_1_` حقولُ FormData).
 *  **والرفضُ يُقرأ بسببه لا بمجرّده:** «اللجنة غير موجودة» رفضٌ أيضاً لكنه عطبُ طلبٍ لا حكمُ صلاحية — فيُطلب نصُّ
 *  السبب المتوقَّع، ويثبت الضابطُ الإيجابي أن الطلبَ نفسَه يصل ويُنفَّذ لمن يملكه. */
const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
  node: Record<string, { exportedName: string; filename: string }>;
};
function actionId(name: string, file: string) {
  const hit = Object.entries(manifest.node).find(([, v]) => v.exportedName === name && v.filename === file);
  if (!hit) throw new Error(`لا إجراءَ ${name} في البناء`);
  return hit[0];
}
async function callAction(j: Jar, path: string, id: string, fields: Record<string, string | string[]>) {
  const fd = new FormData();
  // الترتيبُ كما يرسله React نفسُه: الحقولُ أولاً ثم الجذر — فالمحلّلُ المتدفّقُ يحلّ الجذرَ حين يصل
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(`_1_${k}`, x);
  fd.append("0", JSON.stringify(["$undefined", "$K1"]));
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: j.cookie(), "Next-Action": id, Accept: "text/x-component", Origin: BASE },
    body: fd,
  });
  const text = await r.text();
  const error = /"error":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? null;
  return { status: r.status, ok: /"success":true/.test(text), error, text };
}
/** رُفض بالسبب المتوقَّع — لا بأي سبب */
const refusedFor = (r: { ok: boolean; error: string | null }, why: string) => !r.ok && !!r.error && r.error.includes(why);
const COMMITTEE_ACTIONS = "src/app/committees/actions.ts";

async function cleanup() {
  const depts = (await prisma.department.findMany({ where: { slug: { startsWith: MARK } }, select: { id: true } })).map((d) => d.id);
  const mids = (await prisma.member.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((m) => m.id);
  const uids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  // سجلُّ الحوكمة لا يُحذف (قيدُ APPEND_ONLY في القاعدة) — تبقى أحداثُ الفحص سجلاً في القاعدة المؤقتة
  await prisma.accessRevocation.deleteMany({ where: { accountId: { in: [...mids, ...uids] } } });
  await prisma.planTask.deleteMany({ where: { departmentId: { in: depts } } });
  await prisma.committeeTask.deleteMany({ where: { committeeId: { in: depts } } });
  await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: depts } } });
  // اللجنةُ تُغلق أولاً ليرتفع قيدُ «لا لجنةَ عاملةً بلا قائد»، ثم تُفرَّغ مؤشّراتُ القيادة
  await prisma.department.updateMany({ where: { id: { in: depts }, parentId: { not: null } }, data: { committeeStatus: "closed" } });
  await prisma.department.updateMany({ where: { id: { in: depts } }, data: { leadMemberId: null, actingLeadUserId: null, deputyMemberId: null } });
  await prisma.passwordResetToken.deleteMany({ where: { email: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.member.deleteMany({ where: { id: { in: mids } } });
  await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.emailLog.deleteMany({ where: { recipient: { endsWith: DOMAIN } } });
  await prisma.loginCode.deleteMany({ where: { email: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.loginAttempt.deleteMany({ where: { identifier: { endsWith: DOMAIN } } }).catch(() => {});
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.testTrack.deleteMany({ where: { departmentId: { in: depts } } });
  await prisma.department.deleteMany({ where: { id: { in: depts }, parentId: { not: null } } });
  await prisma.department.deleteMany({ where: { id: { in: depts } } });
}

(async () => {
  await cleanup();
  const hash = await hashPassword(PASS);
  const P = await prisma.department.create({ data: { name: `${MARK} قسم`, slug: `${MARK}-p`, colorHex: "#2F7D32" } });
  const track = await prisma.testTrack.create({ data: { scope: "department_member", departmentId: P.id } });
  const FD = await prisma.user.create({ data: { fullName: `${MARK} مؤسس`, email: `fd${DOMAIN}`, passwordHash: hash, role: "super_admin" } });
  const RL = await prisma.user.create({ data: { fullName: `${MARK} قائد`, email: `rl${DOMAIN}`, passwordHash: hash, role: "department_admin", departmentId: P.id } });
  const mk = async (tag: string) => {
    const email = `${tag}${DOMAIN}`;
    const inv = await prisma.invite.create({ data: { fullName: tag, email, targetRole: "member", departmentId: P.id, testTrackId: track.id, invitedById: FD.id, status: "used" } });
    return prisma.member.create({ data: { fullName: `${MARK} ${tag}`, email, departmentId: P.id, inviteId: inv.id, passwordHash: hash, approvalStatus: "approved" } });
  };
  const M = await mk("m"), N = await mk("n");
  const A = await mk("a"), B = await mk("b"), X = await mk("x"), Y = await mk("y");
  const CM = await prisma.department.create({
    data: {
      name: `${MARK} لجنة`, slug: `${MARK}-c`, colorHex: "#2F7D32", parentId: P.id, committeeStatus: "approved",
      purpose: "غرض", committeeKind: "permanent", leadMemberId: A.id,
    },
  });
  for (const m of [A, B]) await prisma.committeeMembership.create({ data: { committeeId: CM.id, memberId: m.id, addedByName: MARK } });

  // ═══ الصفحتان للمؤسس والرئيس وحدهما ═══
  const jFD = await signIn(FD.email);
  const jRL = await signIn(RL.email);
  const jM = await signIn(M.email);
  chk("الزائرُ لا يصل صفحة تغيير القائد", toLogin(await page(null, `/admin/departments/${P.slug}/leader`)));
  const rlLeader = await page(jRL, `/admin/departments/${P.slug}/leader`);
  chk("قائدُ القسم: صفحةُ تغيير القائد تردّه بتحويلٍ حقيقي (307 لا 200)", rlLeader.status === 307 && rlLeader.location === "/admin", `${rlLeader.status} ${rlLeader.location}`);
  const rlMem = await page(jRL, `/admin/people/member/${M.id}/membership`);
  chk("وصفحةُ حالة العضوية كذلك", rlMem.status === 307 && rlMem.location === "/admin", `${rlMem.status} ${rlMem.location}`);
  chk("والعضوُ لا يصل أيّاً منهما", (await page(jM, `/admin/departments/${P.slug}/leader`)).status === 307 && (await page(jM, `/admin/people/member/${M.id}/membership`)).status === 307);
  const fdLeader = await page(jFD, `/admin/departments/${P.slug}/leader`);
  chk("المؤسسُ يرى القائدَ الحالي والبدلاء", fdLeader.status === 200 && fdLeader.html.includes(RL.fullName) && fdLeader.html.includes(M.fullName));
  const fdMem = await page(jFD, `/admin/people/member/${M.id}/membership`);
  chk("ويرى أثرَ الإنهاء وخيارَه", fdMem.status === 200 && fdMem.html.includes("إنهاء العضوية وإزالة الوصول"));
  // فهرسُ الأقسام صفحةُ حوكمة الهيكل للمؤسس والرئيس — ولوحةُ القسم نفسُها لقائده وحده
  chk("وفهرسُ الأقسام يقوده إلى تغيير القائد", (await page(jFD, "/admin/departments")).html.includes(`/admin/departments/${P.slug}/leader`));
  const rlDash = await page(jRL, `/admin/departments/${P.slug}`);
  chk("ولا يرى قائدُ القسم الرابطَ في لوحته", rlDash.status === 200 && !rlDash.html.includes(`/admin/departments/${P.slug}/leader`), String(rlDash.status));

  // ═══ المتطلبان الثاني والرابع: لا تجاوزَ بطلبٍ مباشر — والحالةُ الحقيقية للقائد هي الحَكَم ═══
  const cPath = `/committees/${CM.id}`;
  const add = actionId("addMembersAction", COMMITTEE_ACTIONS);
  const remove = actionId("removeMemberAction", COMMITTEE_ACTIONS);
  const status = actionId("changeCommitteeStatusAction", COMMITTEE_ACTIONS);
  const appoint = actionId("appointLeadAction", COMMITTEE_ACTIONS);
  const memberOf = async (memberId: string) =>
    !!(await prisma.committeeMembership.findFirst({ where: { committeeId: CM.id, memberId, active: true }, select: { id: true } }));
  const cRow = () => prisma.department.findUniqueOrThrow({ where: { id: CM.id }, select: { committeeStatus: true, leadMemberId: true, actingLeadUserId: true } });

  // كلُّ نموذجِ إجراءٍ في صفحة اللجنة يحمل حقلَ `committeeId` المخفي — فغيابُه غيابُ أدوات الإدارة كلِّها
  const hasForms = (html: string) => html.includes('name="committeeId"');
  const fdView = await page(jFD, `${cPath}?tab=members`);
  chk("٣ · المؤسسُ يطّلع على اللجنة وأعضائها وقائدُها نشط — بلا أداةِ إدارةٍ واحدة", fdView.status === 200 && fdView.html.includes(A.fullName) && !hasForms(fdView.html), String(fdView.status));
  const rlView = await page(jRL, `${cPath}?tab=members`);
  chk("ولقائد القسم أدواتُه، وتُعلَن له القيادةُ مقفلة", rlView.status === 200 && hasForms(rlView.html) && rlView.html.includes("للجنة قائدٌ نشطٌ معتمد"), String(rlView.status));
  const a1 = await callAction(jFD, cPath, add, { committeeId: CM.id, memberIds: [Y.id] });
  chk("٤/١٢ · طلبٌ مباشر: المؤسسُ لا يضيف عضواً والقائدُ نشط", refusedFor(a1, "إضافةُ الأعضاء لقائد القسم") && !(await memberOf(Y.id)), `${a1.status} ${a1.error}`);
  const r1 = await callAction(jFD, cPath, remove, { committeeId: CM.id, memberId: B.id });
  chk("٤/١٢ · ولا يُخرج عضواً", refusedFor(r1, "إزالةُ الأعضاء لقائد القسم") && (await memberOf(B.id)), `${r1.status} ${r1.error}`);
  const s1 = await callAction(jFD, cPath, status, { committeeId: CM.id, to: "suspended", note: "طلبٌ مباشر" });
  chk("٤/١٢ · ولا يعلّق اللجنة", refusedFor(s1, "تغييرُ حالة اللجنة") && (await cRow()).committeeStatus === "approved", `${s1.status} ${s1.error}`);
  const s2 = await callAction(jFD, cPath, status, { committeeId: CM.id, to: "closed", note: "طلبٌ مباشر" });
  chk("٤/١٢ · ولا يغلقها", refusedFor(s2, "تغييرُ حالة اللجنة") && (await cRow()).committeeStatus === "approved", `${s2.status} ${s2.error}`);
  const p1 = await callAction(jFD, cPath, appoint, { committeeId: CM.id, memberId: B.id });
  chk("٤/١٢ · ولا يغيّر قائدَها", refusedFor(p1, "قائدٌ نشطٌ معتمد") && (await cRow()).leadMemberId === A.id, `${p1.status} ${p1.error}`);
  // ضابطٌ إيجابي: الطلبُ نفسُه يمرّ لمن يملكه — فالرفضُ أعلاه رفضُ صلاحيةٍ لا عطبُ طلب
  const ctl = await callAction(jRL, cPath, add, { committeeId: CM.id, memberIds: [X.id] });
  chk("ضابط · الطلبُ المباشرُ نفسُه يمرّ لقائد القسم (صلاحيتُه باقية)", ctl.ok && (await memberOf(X.id)), `${ctl.status} ${ctl.error}`);
  const p2 = await callAction(jRL, cPath, appoint, { committeeId: CM.id, memberId: B.id });
  chk("٤/١٢ · ولا يغيّر قائدُ القسم نفسُه قائداً نشطاً", refusedFor(p2, "قائدٌ نشطٌ معتمد") && (await cRow()).leadMemberId === A.id, `${p2.status} ${p2.error}`);

  // القائدُ يغادر — تنتقل القيادةُ آلياً، وتنفتح صلاحياتُ الإدارة للمؤسس
  const ta = await terminateMembership(FD.id, A.id, { reason: "اختبار HTTP — مغادرة قائد اللجنة", confirm: true });
  chk("قائدُ اللجنة غادر", ta.ok, ta.ok ? "" : ta.reason);
  const afterLead = await cRow();
  chk("٦ · خلافةٌ آلية: قائمٌ بالخلافة واحد، ولا قائدَ عضوٌ معه", afterLead.leadMemberId === null && !!afterLead.actingLeadUserId);
  const fdView2 = await page(jFD, `${cPath}?tab=members`);
  chk("٥ · وتُعلَن للمؤسس انتهاءُ القيادة، وتظهر له أدواتُ الإدارة", fdView2.status === 200 && fdView2.html.includes("انتهت قيادةُ قائد اللجنة") && hasForms(fdView2.html));
  const a2 = await callAction(jFD, cPath, add, { committeeId: CM.id, memberIds: [Y.id] });
  chk("٥ · طلبٌ مباشر: المؤسسُ يضيف عضواً بعد المغادرة", a2.ok && (await memberOf(Y.id)), `${a2.status} ${a2.error}`);
  const r2 = await callAction(jFD, cPath, remove, { committeeId: CM.id, memberId: B.id });
  chk("٥ · ويُنهي عضوية", r2.ok && !(await memberOf(B.id)), `${r2.status} ${r2.error}`);
  const s3 = await callAction(jFD, cPath, status, { committeeId: CM.id, to: "suspended", note: "تعليقٌ بعد مغادرة القائد" });
  const afterSusp = await cRow();
  chk("٥ · ويعلّق اللجنة — وتبقى بقائدٍ واحد", s3.ok && afterSusp.committeeStatus === "suspended" && !!afterSusp.actingLeadUserId, `${s3.status} ${s3.error}`);

  // ═══ الإبطالُ الفوري: إنهاءُ العضوية ═══
  chk("العضوُ داخلٌ قبل الإنهاء", (await page(jM, "/committees")).status === 200);
  const tr = await terminateMembership(FD.id, M.id, { reason: "اختبار HTTP", confirm: true });
  chk("أُنهيت عضويتُه", tr.ok, tr.ok ? "" : tr.reason);
  await sleep(EPOCH_WAIT);
  chk("فسقطت جلستُه في طلبها التالي (لا بعد خمس دقائق)", toLogin(await page(jM, "/committees")));
  const again = await signIn(M.email);
  chk("ولا يدخل من جديد", toLogin(await page(again, "/committees")));

  // ═══ الإبطالُ الفوري: سحبُ القيادة ═══
  chk("قائدُ القسم داخلٌ لوحتَه قبل التغيير", (await page(jRL, "/admin")).status === 200);
  const ch = await changeDepartmentLeader(FD.id, P.id, N.id, "اختبار HTTP", true);
  chk("غُيِّر القائد", ch.ok, ch.ok ? "" : ch.reason);
  await sleep(EPOCH_WAIT);
  chk("فسقطت جلستُه القيادية", toLogin(await page(jRL, "/admin")));
  const asMember = await signIn(RL.email);
  const back = await page(asMember, "/committees");
  chk("ويدخل بكلمته نفسها عضواً (تُسحب القيادةُ لا الشخص)", back.status === 200, String(back.status));
  chk("ولا يصل لوحةَ الإدارة بعد الآن", (await page(asMember, "/admin")).status === 307);
  const nUser = await signIn(N.email);
  chk("والبديلُ يدخل لوحةَ قائد القسم", (await page(nUser, "/admin")).status === 200);

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
