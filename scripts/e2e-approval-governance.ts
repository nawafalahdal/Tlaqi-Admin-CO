/** **حوكمةُ الاعتماد** (قرار المؤسس، نوفمبر 2026 — ق١ وق٢ وق٧ وتوضيحُ قبول المنصب من صاحب حسابٍ قائم):
 *  المؤسسُ والرئيسُ يطّلعان ولا يحسمان؛ قائدُ القسم لأعضاء قسمه؛ وجهةُ الاعتماد المستقلة («اعتماد العضوية») للمناصب
 *  القيادية وأعضاء الإدارة العليا وأعضاء قسمٍ لا قائدَ له؛ ودعوةُ الإدارة العليا لا تعتمد أحداً بلا اختبار.
 *
 *  تشغيل (قاعدةُ فحصٍ محلية مؤقتة): DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-approval-governance.ts */
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}

const TAG = `e2e-apg-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const sess = (u: { id: string; role: string; fullName: string; email: string; departmentId?: string | null }, candidate = false) =>
  ({ user: { id: u.id, role: u.role, name: u.fullName, email: u.email, departmentId: u.departmentId ?? null, candidate } } as unknown as Session);

(async () => {
  try {
    const W = await import("@/lib/workflow");
    const CD = await import("@/lib/candidateDecision");
    const S = await import("@/lib/governance/senior");
    const AS = await import("@/lib/assessments");
    const { createDepartment } = await import("@/lib/departments");
    const { resolveSessionAccount } = await import("@/lib/sessionAccount");

    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const ceo = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });
    const fS = sess(founder);
    const cS = sess(ceo);

    // ── أقسام: قسمٌ له قائد، وقسمٌ شاغر، والإدارةُ العليا
    const ledDept = await prisma.department.create({ data: { name: `قسم بقائد ${TAG}`, slug: `${TAG}-led`, colorHex: "#2266AA" } });
    const vacantDept = await prisma.department.create({ data: { name: `قسم شاغر ${TAG}`, slug: `${TAG}-vac`, colorHex: "#22AA66" } });
    let senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
    if (!senior) {
      await createDepartment({ name: "الإدارة العليا", colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
      senior = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: true, parentId: null } });
    }
    const lead = await prisma.user.create({ data: { fullName: "قائد اختبار", email: `${TAG}-lead@example.test`, passwordHash: "x", role: "department_admin", departmentId: ledDept.id, isActive: true } });
    const otherLead = await prisma.user.findFirst({ where: { role: "department_admin", isActive: true, departmentId: { notIn: [ledDept.id, vacantDept.id] } } });
    const lS = sess(lead);
    const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });

    const mkCandidate = async (key: string, departmentId: string | null, targetRole: "member" | "department_admin" = "member", testStatus: "passed" | "not_started" = "passed") => {
      const email = `${TAG}-${key}@example.test`;
      const inv = await prisma.invite.create({ data: { fullName: `مرشّح ${key}`, email, targetRole, departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
      return prisma.member.create({ data: { fullName: `مرشّح ${key}`, email, departmentId, inviteId: inv.id, passwordHash: "x", approvalStatus: "pending_review", testStatus, testScore: testStatus === "passed" ? 90 : null, isActive: true, credentialsIssuedAt: new Date() } });
    };
    const cLed = await mkCandidate("led", ledDept.id);
    const cVac = await mkCandidate("vac", vacantDept.id);
    const cSen = await mkCandidate("sen", senior.id);
    const cLeadRole = await mkCandidate("leadrole", ledDept.id, "department_admin");

    // ══ ١) المؤسسُ والرئيسُ يطّلعان ولا يحسمان — في كل حال
    for (const [label, c] of [["عضو قسمٍ له قائد", cLed], ["عضو قسمٍ شاغر", cVac], ["عضو الإدارة العليا", cSen], ["مرشّح قائد قسم", cLeadRole]] as const) {
      chk(`**المؤسسُ لا يحسم ${label}**`, !(await CD.mayDecideCandidate(fS, c.id)));
      chk(`**ولا الرئيسُ التنفيذيُّ (${label})**`, !(await CD.mayDecideCandidate(cS, c.id)));
      chk(`ويطّلعان على نتيجته (${label})`, (await CD.mayViewCandidate(fS, c.id)) && (await CD.mayViewCandidate(cS, c.id)));
    }

    // ══ ٢) قائدُ القسم لأعضاء قسمه وحده
    chk("قائدُ القسم يحسم عضوَ قسمه", await CD.mayDecideCandidate(lS, cLed.id));
    chk("ولا يحسم عضوَ قسمٍ شاغر غيرِ قسمه", !(await CD.mayDecideCandidate(lS, cVac.id)));
    chk("ولا مرشّحاً لقيادة قسمه", !(await CD.mayDecideCandidate(lS, cLeadRole.id)));
    chk("ولا عضوَ الإدارة العليا", !(await CD.mayDecideCandidate(lS, cSen.id)));
    if (otherLead) chk("وقائدُ قسمٍ آخر لا يحسم عضوَ هذا القسم", !(await CD.mayDecideCandidate(sess(otherLead), cLed.id)));

    // ══ ٣) لا جهةَ معيّنة بعد ⇐ لا يحسمه أحد، ولا يُحال إلى المؤسس ولا الرئيس
    await prisma.seniorPosition.updateMany({ where: { capabilities: { has: "membership_decide" } }, data: { status: "suspended" } });
    const none = await CD.candidateDecidersFor({ id: cVac.id, departmentId: vacantDept.id, invite: { targetRole: "member" } });
    chk("**بلا جهةِ اعتماد معيّنة: لا رسالةَ لأحد — لا للمؤسس ولا للرئيس**", none.to.length === 0 && !none.to.includes(founder.email) && !none.to.includes(ceo.email), JSON.stringify(none));

    // ══ ٤) جهةُ الاعتماد المستقلة: عضوٌ يحمل «اعتماد العضوية» في تكليفٍ نشط
    const apEmail = `${TAG}-approver@example.test`;
    const apInv = await prisma.invite.create({ data: { fullName: "معتمِد مستقل", email: apEmail, targetRole: "member", departmentId: senior.id, testTrackId: track.id, invitedById: founder.id, status: "used" } });
    const approver = await prisma.member.create({ data: { fullName: "معتمِد مستقل", email: apEmail, departmentId: senior.id, inviteId: apInv.id, passwordHash: "x", approvalStatus: "approved", testStatus: "passed", isActive: true, decidedAt: new Date() } });
    const apPos = await prisma.seniorPosition.create({
      data: { departmentId: senior.id, titleAr: "مسؤول الاعتماد", capabilities: ["board_view", "membership_decide"], status: "active", holderMemberId: approver.id, inviteName: "معتمِد مستقل", inviteEmail: apEmail, inviteState: "accepted", invitedById: ceo.id, invitedByName: ceo.fullName },
    });
    const aS = sess({ id: approver.id, role: "member", fullName: approver.fullName, email: apEmail, departmentId: senior.id });
    chk("حاملُ «اعتماد العضوية» جهةُ اعتماد", await CD.isDesignatedApprover(aS));
    chk("**يحسم عضوَ القسم الشاغر**", await CD.mayDecideCandidate(aS, cVac.id));
    chk("**ويحسم عضوَ الإدارة العليا**", await CD.mayDecideCandidate(aS, cSen.id));
    chk("**ويحسم المرشّحَ لقيادة قسم**", await CD.mayDecideCandidate(aS, cLeadRole.id));
    chk("ولا يحسم عضوَ قسمٍ له قائد (لقائده)", !(await CD.mayDecideCandidate(aS, cLed.id)));
    const deciders = await CD.candidateDecidersFor({ id: cVac.id, departmentId: vacantDept.id, invite: { targetRole: "member" } });
    chk("ورسالةُ «ينتظر الاعتماد» تصله هو وحده", deciders.to.length === 1 && deciders.to[0] === apEmail && deciders.path === "/senior/approvals", JSON.stringify(deciders));

    // ── ولا تسري لمؤسسٍ ولا لرئيس ولو كُتبت لهما
    const fakeFounderPos = await prisma.seniorPosition.create({
      data: { departmentId: senior.id, titleAr: "تجربة", capabilities: ["membership_decide"], status: "active", holderUserId: founder.id, inviteName: founder.fullName, inviteEmail: `${TAG}-f@example.test`, inviteState: "accepted", invitedById: ceo.id, invitedByName: ceo.fullName },
    });
    chk("**«اعتماد العضوية» لا تسري للمؤسس ولو كُتبت في تكليف**", !(await CD.isDesignatedApprover(fS)) && !(await CD.mayDecideCandidate(fS, cVac.id)));
    await prisma.seniorPosition.delete({ where: { id: fakeFounderPos.id } });
    const fCtx = await S.seniorContext(fS);
    chk("ولا تُمنح للمؤسس تلقائياً في سياق الإدارة العليا", !fCtx.capabilities.has("membership_decide") && fCtx.capabilities.has("board_view"));
    chk("ولا للرئيس في القائمة الجانبية", !(await S.seniorNavCapabilities(cS)).has("membership_decide"));
    await prisma.seniorPosition.update({ where: { id: apPos.id }, data: { status: "suspended" } });
    chk("والتكليفُ الموقوف لا يحسم", !(await CD.mayDecideCandidate(aS, cVac.id)));
    await prisma.seniorPosition.update({ where: { id: apPos.id }, data: { status: "active" } });

    // ══ ٥) القرارُ يُسجَّل بحاسمه في السجلّ وفي سجلّ التدقيق
    await W.approveMember(cVac.id, { id: approver.id, name: approver.fullName, role: "member" });
    const decided = await prisma.member.findUniqueOrThrow({ where: { id: cVac.id } });
    chk("**الاعتمادُ يحفظ من حسمه**", decided.approvalStatus === "approved" && decided.decidedByName === approver.fullName && decided.decidedById === approver.id);
    chk("وفي سجلّ التدقيق الثابت", (await prisma.orgAuditEvent.count({ where: { entityId: cVac.id, action: "member.approved", actorId: approver.id } })) === 1);
    await W.rejectMember(cLed.id, { id: lead.id, name: lead.fullName, role: "department_admin" });
    chk("والرفضُ كذلك", (await prisma.member.findUniqueOrThrow({ where: { id: cLed.id } })).decidedByName === lead.fullName &&
      (await prisma.orgAuditEvent.count({ where: { entityId: cLed.id, action: "member.rejected" } })) === 1);

    // ══ ٦) دعوةُ الإدارة العليا لمدعوٍّ جديد: لا اعتمادَ بالقبول
    const mkPosition = async (key: string, email: string) => {
      const token = `${TAG}-${key}-token-xxxxxxxxxxxxxxxx`;
      const p = await prisma.seniorPosition.create({
        data: { departmentId: senior!.id, titleAr: `منصب ${key}`, capabilities: ["board_view"], status: "pending", inviteName: `مدعو ${key}`, inviteEmail: email, inviteState: "sent", inviteTokenHash: S.tokenHash(token), inviteExpiresAt: new Date(Date.now() + 86400000), invitedById: ceo.id, invitedByName: ceo.fullName },
      });
      return { p, token };
    };
    // بلا بنكٍ فيه أسئلة: لا قبول
    const seniorBank = await prisma.testTrack.findFirst({ where: { scope: "department_member", departmentId: senior.id } });
    const hadQuestions = seniorBank ? (await prisma.testQuestion.count({ where: { trackId: seniorBank.id } })) > 0 : false;
    if (!hadQuestions) {
      const early = await mkPosition("early", `${TAG}-early@example.test`);
      const r = await S.acceptSeniorInvitation(early.token, { session: null, password: "Abcdef12345" });
      chk("**بنكُ الإدارة العليا بلا أسئلة: لا يُقبل منصبٌ بلا اختبار**", !r.ok && r.reason.includes("بنكُ أسئلة الإدارة العليا"), JSON.stringify(r));
    }
    const bank = seniorBank ?? (await prisma.testTrack.create({ data: { scope: "department_member", departmentId: senior.id } }));
    if (!hadQuestions) await prisma.testQuestion.create({ data: { trackId: bank.id, prompt: `سؤال ${TAG}`, options: ["أ", "ب", "ج", "د"], correctIndex: 2, order: 1 } });
    const answers = Object.fromEntries((await prisma.testQuestion.findMany({ where: { trackId: bank.id } })).map((q) => [q.id, q.correctIndex]));

    const newEmail = `${TAG}-new@example.test`;
    const pNew = await mkPosition("new", newEmail);
    const acc = await S.acceptSeniorInvitation(pNew.token, { session: null, password: "Abcdef12345" });
    chk("القبولُ ينجح لمدعوٍّ جديد", acc.ok && acc.mode === "created", JSON.stringify(acc));
    const newM = await prisma.member.findUniqueOrThrow({ where: { email: newEmail } });
    const pAfter = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: pNew.p.id } });
    chk("**لكنه مرشّحٌ لا عضو: لم يُعتمد ولم يختبر**", newM.approvalStatus === "pending_review" && newM.testStatus === "not_started" && newM.decidedAt === null);
    chk("**ومنصبُه «بانتظار» لا نشط**", pAfter.status === "pending" && pAfter.inviteState === "accepted" && pAfter.holderMemberId === newM.id);
    chk("ولا رقمَ وظيفيَّ قبل الاعتماد", newM.employeeNo === null);
    const acct = await resolveSessionAccount(newM.id, "member");
    chk("**وجلستُه مرشّحةٌ محصورة (البوابة المركزية)**", acct.status === "live" && acct.candidate === true);
    // يختبر فيجتاز — ثم لا يحسمه المؤسس ولا الرئيس، بل جهةُ الاعتماد
    await prisma.member.update({ where: { id: newM.id }, data: { profileCompletedAt: new Date() } });
    const sub = await W.submitTestAttempt({ memberId: newM.id, answers });
    chk("يجتاز اختبارَ الإدارة العليا", sub?.passed === true, String(sub?.score));
    chk("**ولا يحسمه المؤسس ولا الرئيس**", !(await CD.mayDecideCandidate(fS, newM.id)) && !(await CD.mayDecideCandidate(cS, newM.id)));
    chk("بل جهةُ الاعتماد", await CD.mayDecideCandidate(aS, newM.id));
    await W.approveMember(newM.id, { id: approver.id, name: approver.fullName, role: "member" });
    const pActive = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: pNew.p.id } });
    const newM2 = await prisma.member.findUniqueOrThrow({ where: { id: newM.id } });
    chk("**وباعتماده يُفعَّل منصبُه**", pActive.status === "active" && !!pActive.startDate);
    chk("ويأخذ رقمَه الوظيفيّ عند الاعتماد", newM2.employeeNo != null);

    // ══ ٧) صاحبُ حسابٍ قائم يقبل منصباً: اختبارٌ على حسابه، وعضويتُه كما هي
    const exEmail = `${TAG}-existing@example.test`;
    const exInv = await prisma.invite.create({ data: { fullName: "عضو قائم", email: exEmail, targetRole: "member", departmentId: ledDept.id, testTrackId: track.id, invitedById: lead.id, status: "used" } });
    const existing = await prisma.member.create({ data: { fullName: "عضو قائم", email: exEmail, departmentId: ledDept.id, inviteId: exInv.id, passwordHash: "x", approvalStatus: "approved", testStatus: "passed", isActive: true, decidedAt: new Date() } });
    const eS = sess({ id: existing.id, role: "member", fullName: existing.fullName, email: exEmail, departmentId: ledDept.id });
    const pEx = await mkPosition("ex", exEmail);
    const accEx = await S.acceptSeniorInvitation(pEx.token, { session: eS });
    chk("صاحبُ الحساب القائم يقبل بجلسته", accEx.ok && accEx.mode === "linked", JSON.stringify(accEx));
    const exAfter = await prisma.member.findUniqueOrThrow({ where: { id: existing.id } });
    const pExAfter = await prisma.seniorPosition.findUniqueOrThrow({ where: { id: pEx.p.id } });
    chk("**وعضويتُه القائمة كما هي**", exAfter.approvalStatus === "approved" && exAfter.isActive && exAfter.departmentId === ledDept.id);
    chk("**ومنصبُه «بانتظار» لا نشط**", pExAfter.status === "pending" && pExAfter.holderMemberId === existing.id);
    const open = await AS.myOpenAssessments(eS);
    chk("**واختبارُ الإدارة العليا ينتظره في صفحته — بلا حسابٍ ولا دعوةٍ جديدة**", open.length === 1 && open[0].purpose === "senior_position" &&
      (await prisma.member.count({ where: { email: exEmail } })) === 1);
    const subEx = await AS.submitAssessment({ session: eS, assignmentId: open[0].id, answers });
    chk("يُسلّمه فيجتاز", subEx.ok && subEx.passed);
    const again = await AS.submitAssessment({ session: eS, assignmentId: open[0].id, answers });
    chk("ولا يُسلَّم مرّتين", !again.ok);
    chk("**ولا يفعّله المؤسس**", !(await AS.decideSeniorPositionAssessment({ session: fS, assignmentId: open[0].id, decision: "approved" })).ok);
    chk("**ولا الرئيس**", !(await AS.decideSeniorPositionAssessment({ session: cS, assignmentId: open[0].id, decision: "approved" })).ok);
    chk("ولا يحسم أحدٌ منصبَ نفسه", !(await AS.decideSeniorPositionAssessment({ session: eS, assignmentId: open[0].id, decision: "approved" })).ok);
    const dec = await AS.decideSeniorPositionAssessment({ session: aS, assignmentId: open[0].id, decision: "approved" });
    chk("**بل جهةُ الاعتماد — فيُفعَّل**", dec.ok && (await prisma.seniorPosition.findUniqueOrThrow({ where: { id: pEx.p.id } })).status === "active", JSON.stringify(dec));

    // ══ ٨) اختبارُ التقييم لعضوٍ قائم (١.٢ وق٧) — يكلّف به قائدُ الإدارة العليا وحده
    const ev = await AS.assignAssessment({ session: cS, owner: { kind: "member", id: existing.id }, trackId: bank.id, reason: "تقييمٌ دوريٌّ للاطّلاع" });
    chk("**الرئيسُ (قائد الإدارة العليا) يكلّف عضواً قائماً بتقييم**", ev.ok, JSON.stringify(ev));
    chk("والمؤسسُ لا يكلّف وللإدارة العليا قائدٌ تنفيذيّ", !(await AS.assignAssessment({ session: fS, owner: { kind: "member", id: existing.id }, trackId: bank.id, reason: "تقييم آخر" })).ok);
    chk("ولا العضو", !(await AS.assignAssessment({ session: eS, owner: { kind: "member", id: approver.id }, trackId: bank.id, reason: "تقييم" })).ok);
    chk("ولا تكليفان قائمان معاً", !(await AS.assignAssessment({ session: cS, owner: { kind: "member", id: existing.id }, trackId: bank.id, reason: "ثانٍ" })).ok);
    chk("ولا تكليفٌ بلا سبب", !(await AS.assignAssessment({ session: cS, owner: { kind: "member", id: approver.id }, trackId: bank.id, reason: "  " })).ok);
    chk("ولا لمرشّحٍ لم يُعتمد", !(await AS.assignAssessment({ session: cS, owner: { kind: "member", id: cSen.id }, trackId: bank.id, reason: "تقييم مرشّح" })).ok);
    const evOpen = (await AS.myOpenAssessments(eS)).find((a) => a.purpose === "evaluation");
    const wrong = Object.fromEntries(Object.keys(answers).map((k) => [k, (answers[k] + 1) % 4]));
    const evSub = await AS.submitAssessment({ session: eS, assignmentId: evOpen!.id, answers: wrong });
    chk("يُسلّمه فتُسجَّل نتيجتُه", evSub.ok && evSub.passed === false);
    const exFinal = await prisma.member.findUniqueOrThrow({ where: { id: existing.id } });
    chk("**ونتيجتُه لا تمسّ عضويتَه ولا صلاحياته (ق٧)**", exFinal.approvalStatus === "approved" && exFinal.isActive && !exFinal.terminatedAt && exFinal.testStatus === "passed");
    chk("ومحاولتُه محفوظة", (await prisma.assessmentAttempt.count({ where: { assignmentId: evOpen!.id } })) === 1);
    const ev2 = await AS.assignAssessment({ session: cS, owner: { kind: "member", id: existing.id }, trackId: bank.id, reason: "تقييمٌ ثانٍ يُلغى" });
    chk("والإلغاءُ بسببٍ مكتوب", ev2.ok && (await AS.cancelAssessment({ session: cS, assignmentId: (ev2 as { id: string }).id, reason: "أُلغي بالخطأ" })).ok);
    chk("وكلُّ ذلك في سجلّ التدقيق",
      (await prisma.orgAuditEvent.count({ where: { action: { in: ["assessment.assigned", "assessment.completed", "assessment.cancelled"] }, createdAt: { gte: new Date(Date.now() - 600000) } } })) >= 5);
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
  } finally {
    for (const c of checks) console.log(c);
    const failedN = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failedN}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failedN ? 1 : 0);
  }
})();
