/** **المؤسسُ والرئيسُ التنفيذيُّ للاطّلاع وحده — في كل المسارات** (قرار المؤسس ق١ والبند ١١، المراجعة الشاملة):
 *  - لا يحسمان مرشّحاً من أي نوع: عضوَ قسمٍ بقائد، أو بلا قائد، أو مرشّحاً قيادياً، أو للإدارة العليا.
 *  - ولا يعيدان فتحَ اختبار، ولا يُكملان ترقيةً قيادية (طريقُها `mayDecideCandidate` نفسُه).
 *  - ويطّلعان على الكل (`mayViewCandidate`).
 *  - **ولا ردَّ بطريقٍ آخر خفيّ:** الحذفُ النهائيُّ لمرشّحٍ ينتظر قرارَ جهة الاعتماد لا يقع إلا بإقرارٍ صريحٍ خاصّ
 *    (`acknowledgeUndecided`، 24 نوفمبر 2026) — لا يكفي `force` — ويُسجَّل في سجل التدقيق.
 *    ويبقى للحذف غرضُه الأصلي: مرشّحٌ عالقٌ لم يُكمل اختبارَه، أو مردودٌ حُسم أمرُه.
 *  تشغيل: DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-founder-view-only.ts */
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}
const TAG = `e2e-fvo-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const sess = (u: { id: string; role: string; fullName: string; email: string; departmentId?: string | null }) =>
  ({ user: { id: u.id, role: u.role, name: u.fullName, email: u.email, departmentId: u.departmentId ?? null } }) as unknown as Session;

(async () => {
  try {
    const CD = await import("@/lib/candidateDecision");
    const { purgeCandidate } = await import("@/lib/workflow");
    const { permanentlyDeleteAccount } = await import("@/lib/founderActions");
    const { createDepartment } = await import("@/lib/departments");
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const ceo = await prisma.user.findFirst({ where: { role: "executive", isActive: true } });
    const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
    const leadTrack = await prisma.testTrack.findFirst({ where: { scope: "department_admin" } });
    let senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
    if (!senior) {
      await createDepartment({ name: "الإدارة العليا", colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
      senior = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: true, parentId: null } });
    }
    const P = await prisma.department.create({ data: { name: `قسم ${TAG}`, slug: TAG, colorHex: "#3366CC" } });
    const V = await prisma.department.create({ data: { name: `قسم بلا قائد ${TAG}`, slug: `${TAG}-v`, colorHex: "#2F7D32" } });
    const lead = await prisma.user.create({ data: { fullName: `قائد ${TAG}`, email: `${TAG}-lead@example.test`, passwordHash: "!", role: "department_admin", departmentId: P.id, isActive: true } });
    let n = 0;
    const mk = async (key: string, departmentId: string, extra: Record<string, unknown> = {}, targetRole: "member" | "department_admin" = "member") => {
      const email = `${TAG}-${key}-${++n}@example.test`;
      const inv = await prisma.invite.create({ data: { fullName: key, email, targetRole, departmentId, testTrackId: targetRole === "member" ? track.id : (leadTrack ?? track).id, invitedById: founder.id, status: "used" } });
      return prisma.member.create({
        data: { fullName: `${key} ${TAG}`, email, departmentId, inviteId: inv.id, passwordHash: "!", approvalStatus: "pending_review", testStatus: "passed", testScore: 90, isActive: true, credentialsIssuedAt: new Date(), profileCompletedAt: new Date(), ...extra } as never,
      });
    };
    const cMember = await mk("member", P.id);
    const cVacant = await mk("vacant", V.id);
    const cSenior = await mk("senior", senior.id);
    const cLeader = leadTrack ? await mk("leader", P.id, {}, "department_admin") : null;

    const tops = [["المؤسس", sess(founder)] as const, ...(ceo ? [["الرئيس التنفيذي", sess(ceo)] as const] : [])];
    const cands = [["عضو قسمٍ بقائد", cMember], ["عضو قسمٍ بلا قائد", cVacant], ["مرشّح الإدارة العليا", cSenior], ...(cLeader ? [["مرشّح قيادي", cLeader] as const] : [])] as const;

    // ═══ الحسمُ والاطّلاع لكل نوع ═══
    for (const [who, s] of tops) {
      for (const [kind, c] of cands) {
        // عضوُ الإدارة العليا يحسمه قائدُها الرئيسُ التنفيذي (19 نوفمبر 2026) — والمؤسسُ يطّلع وحده
        if (c === cSenior && who === "الرئيس التنفيذي") chk(`${who} (قائدُ الإدارة العليا) يحسم ${kind}`, await CD.mayDecideCandidate(s, c.id));
        else chk(`${who} لا يحسم ${kind}`, !(await CD.mayDecideCandidate(s, c.id)));
        chk(`${who} يطّلع على ${kind}`, await CD.mayViewCandidate(s, c.id));
      }
    }
    if (!ceo) chk("الرئيسُ التنفيذي (لا حسابَ نشطاً في هذه القاعدة — يُخطّى)", true);
    // ضابطٌ إيجابي: جهةُ الحسم الصحيحة تملكه
    chk("وقائدُ القسم يحسم عضوَ قسمه (ضابط)", await CD.mayDecideCandidate(sess({ ...lead, departmentId: P.id }), cMember.id));

    // ═══ لا ردَّ بطريقٍ آخر: الحذفُ النهائيُّ لمن ينتظر القرار ═══
    const fS = sess(founder);
    let purgeErr = "";
    try {
      await purgeCandidate({ memberId: cMember.id, confirmEmail: cMember.email, reason: "اختبار", performedByName: founder.fullName });
    } catch (e) {
      purgeErr = e instanceof Error ? e.message : String(e);
    }
    chk("**المؤسسُ لا يحذف مرشّحاً اجتاز وينتظر القرار بلا إقرارٍ صريح** (حذفُ مرشّحٍ عالق)", purgeErr.includes("أحذفه قبل حسم أمره") && !!(await prisma.member.findUnique({ where: { id: cMember.id } })), purgeErr);
    const failed = await mk("failed", P.id, { testStatus: "failed", testScore: 40 });
    let purgeFailedErr = "";
    try {
      await purgeCandidate({ memberId: failed.id, confirmEmail: failed.email, reason: "اختبار", performedByName: founder.fullName });
    } catch (e) {
      purgeFailedErr = e instanceof Error ? e.message : String(e);
    }
    chk("ولا من لم يجتز وينتظر قرارَ جهة الاعتماد بلا إقرار (والرسالةُ تقول ما العمل)", purgeFailedErr.includes("أحذفه قبل حسم أمره") && !!(await prisma.member.findUnique({ where: { id: failed.id } })));
    const erase = await permanentlyDeleteAccount({ kind: "member", id: cVacant.id, confirmEmail: cVacant.email, reason: "اختبار", force: true, actorRole: "super_admin", actorName: founder.fullName } as never);
    chk("**ولا بالحذف النهائي بالإقرار المباشر (`force`) وحده** — الإقرارُ الخاصّ وحده يحذف", !erase.ok && JSON.stringify(erase).includes("أحذفه قبل حسم أمره") && !!(await prisma.member.findUnique({ where: { id: cVacant.id } })), JSON.stringify(erase));
    // ويبقى للحذف غرضُه الأصلي
    const stuck = await mk("stuck", P.id, { testStatus: "not_started", testScore: null });
    await purgeCandidate({ memberId: stuck.id, confirmEmail: stuck.email, reason: "عالق لم يبدأ", performedByName: founder.fullName });
    chk("ويُحذف المرشّحُ العالق الذي لم يُكمل اختبارَه (الغرضُ الأصلي)", !(await prisma.member.findUnique({ where: { id: stuck.id } })));
    const rejected = await mk("rejected", P.id, { approvalStatus: "rejected", decidedAt: new Date() });
    await purgeCandidate({ memberId: rejected.id, confirmEmail: rejected.email, reason: "مردود", performedByName: founder.fullName });
    chk("والمردودُ الذي حُسم أمرُه", !(await prisma.member.findUnique({ where: { id: rejected.id } })));
    void fS;
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
