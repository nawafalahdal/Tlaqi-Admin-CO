/** **استبيانُ الانضمام لكل من اعتُمد** (البند ٦ وق٥): العضو، وعضو الإدارة العليا، والقائد بسجلّ عضويته التوأم —
 *  بعد الاعتماد النهائي وحده، ومرّةً واحدة؛ ومن فاته بسبب الخلل يُعرض في لوحةٍ ويُطلَق له بإجراءٍ صريح.
 *  تشغيل: DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-survey-coverage.ts */
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}
const TAG = `e2e-svc-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const sess = (u: { id: string; role: string; fullName: string; email: string }) =>
  ({ user: { id: u.id, role: u.role, name: u.fullName, email: u.email, departmentId: null } } as unknown as Session);
const ANSWERS = { journeyRating: "4", roleClarityRating: "5", bannerReceived: "yes", gender: "male" };

(async () => {
  try {
    const W = await import("@/lib/workflow");
    const SV = await import("@/lib/onboardingSurvey");
    const { createDepartment } = await import("@/lib/departments");
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
    let senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
    if (!senior) {
      await createDepartment({ name: "الإدارة العليا", colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
      senior = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: true, parentId: null } });
    }
    const dept = await prisma.department.create({ data: { name: `قسم ${TAG}`, slug: TAG, colorHex: "#3366CC" } });
    const leadTrack = await prisma.testTrack.findFirst({ where: { scope: "department_admin" } });

    const mk = async (key: string, departmentId: string, targetRole: "member" | "department_admin" = "member", extra: object = {}) => {
      const email = `${TAG}-${key}@example.test`;
      const inv = await prisma.invite.create({ data: { fullName: `فحص ${key}`, email, targetRole, departmentId, testTrackId: targetRole === "member" ? track.id : leadTrack!.id, invitedById: founder.id, status: "used" } });
      return prisma.member.create({ data: { fullName: `فحص ${key}`, email, departmentId, inviteId: inv.id, passwordHash: "x", approvalStatus: "pending_review", testStatus: "passed", testScore: 90, isActive: true, credentialsIssuedAt: new Date(), profileCompletedAt: new Date(), ...extra } });
    };

    // ── لا استبيانَ قبل الاعتماد
    const cand = await mk("cand", dept.id);
    chk("**المرشّحُ قبل الاعتماد لا استبيانَ عليه**", !(await SV.surveyPending(cand.id)));

    // ── العضو: يُطلق باعتماده
    await W.approveMember(cand.id);
    chk("العضوُ المعتمد يُطلب منه الاستبيان", await SV.surveyPending(cand.id));

    // ── عضو الإدارة العليا (كان يُستثنى — البند ٦)
    const sen = await mk("sen", senior.id);
    await W.approveMember(sen.id);
    chk("**عضوُ الإدارة العليا يُطلب منه الاستبيانُ باعتماده**", await SV.surveyPending(sen.id));

    // ── القائد: على سجلّ عضويته التوأم، وجلستُه الإدارية تصل إليه
    if (leadTrack) {
      const lc = await mk("lead", dept.id, "department_admin");
      await W.approveMember(lc.id);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: lc.email } });
      const uS = sess(user);
      const twin = await SV.surveyMemberIdFor(uS);
      chk("**القائدُ المعتمد: سجلُّ عضويته التوأم هو سجلُّ استبيانه**", twin === lc.id, String(twin));
      chk("**ويُطلب منه الاستبيان**", await SV.surveyPending(lc.id));
      const r = await SV.submitOnboardingSurvey(lc.id, ANSWERS);
      chk("يُجيبه فيُحفظ", r.ok, JSON.stringify(r));
      chk("**ولا يُطلب منه ثانيةً**", !(await SV.surveyPending(lc.id)));
      const again = await SV.submitOnboardingSurvey(lc.id, ANSWERS);
      chk("ولا تُقبل إجابةٌ ثانية", !again.ok && again.code === "already");
      chk("ويظهر في لوحة الاستبيان", (await SV.onboardingRows()).some((x) => x.id === lc.id && x.status !== "not_completed"));
    } else {
      chk("القائد (لا بنكَ قيادة في هذه القاعدة — يُخطّى)", true);
    }
    chk("والمؤسسُ لا رحلةَ له", (await SV.surveyMemberIdFor(sess(founder))) === null);

    // ── من فاته بسبب الخلل: عضوُ إدارةٍ عليا اعتُمد بعد الإطلاق بلا ختم (كما في الخلل القديم)
    const missed = await mk("missed", senior.id, "member", { approvalStatus: "approved", decidedAt: new Date() });
    const oldOne = await mk("old", senior.id, "member", { approvalStatus: "approved", decidedAt: new Date("2026-10-01T00:00:00Z") });
    const regular = await mk("regular", dept.id, "member", { approvalStatus: "approved", decidedAt: new Date() });
    const answered = await mk("answered", senior.id, "member", { approvalStatus: "approved", decidedAt: new Date() });
    await prisma.onboardingSurveyResponse.create({ data: { memberId: answered.id, journeyRating: 4, roleClarityRating: 4, bannerReceived: true, gender: "male" } });
    const list = (await SV.missedSurveyRows()).map((m) => m.id);
    chk("**قائمةُ «فاتهم» تضمّ من فاته بسبب الخلل**", list.includes(missed.id));
    chk("ولا تضمّ من اعتُمد قبل إطلاق الاستبيان", !list.includes(oldOne.id));
    chk("ولا عضوَ قسمٍ عاديّ (طريقُه كان يُختم)", !list.includes(regular.id));
    chk("ولا من أجاب", !list.includes(answered.id));
    chk("**ولا يتغيّر شيءٌ قبل الإجراء الصريح**", (await prisma.member.findUniqueOrThrow({ where: { id: missed.id } })).onboardingSurveyRequiredAt === null);
    const lead = await prisma.user.findFirst({ where: { role: "department_admin", isActive: true } });
    if (lead) chk("وقائدُ القسم لا يُطلقه", !(await SV.stampMissedSurveys({ id: lead.id, name: lead.fullName, role: "department_admin" })).ok);
    const done = await SV.stampMissedSurveys({ id: founder.id, name: founder.fullName, role: "super_admin" });
    chk("**الإطلاقُ الصريح يشملهم**", done.ok && (done as { count: number }).count >= 1 && (await SV.surveyPending(missed.id)));
    chk("ولا يمسّ القديم", (await prisma.member.findUniqueOrThrow({ where: { id: oldOne.id } })).onboardingSurveyRequiredAt === null);
    chk("وفي سجلّ التدقيق", (await prisma.orgAuditEvent.count({ where: { action: "survey.missed.enabled", actorId: founder.id } })) >= 1);
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
