/** الرقمُ الوظيفي: المؤسسُ 001، ولكل موظفٍ رقمٌ واحدٌ فريدٌ من تسلسلٍ واحد — يُسنَد عند الاعتماد لا عند الدعوة،
 *  ويرثه الحسابُ القياديُّ من سجلّ عضويته، ويظهر في البطاقة الرسمية.
 *
 *  تشغيل (قاعدةٌ محلية بعد ترحيل `20261113180000_employee_numbers`):
 *    DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-employee-id.ts
 *  تُكتب السجلّاتُ في قاعدة الفحص المؤقتة وحدها (تُحذف القاعدةُ بعد التشغيل). */
import { prisma } from "@/lib/prisma";

const TAG = `e2e-eid-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

async function maxNo(): Promise<number> {
  const [u, m] = await Promise.all([
    prisma.user.aggregate({ _max: { employeeNo: true } }),
    prisma.member.aggregate({ _max: { employeeNo: true } }),
  ]);
  return Math.max(u._max.employeeNo ?? 0, m._max.employeeNo ?? 0);
}

(async () => {
  try {
    const W = await import("@/lib/workflow");
    const { employeeIdLabel } = await import("@/lib/employeeId");
    const { businessCardData } = await import("@/lib/businessCardData");

    // ── المؤسسُ 001، وصيغةُ الرقم
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } });
    chk("**المؤسسُ رقمُه 001**", founder.employeeNo === 1, String(founder.employeeNo));
    chk("والصيغةُ TLAQI - 001 (ثلاثُ خاناتٍ على الأقل)", employeeIdLabel(1) === "TLAQI - 001" && employeeIdLabel(42) === "TLAQI - 042" && employeeIdLabel(1234) === "TLAQI - 1234" && employeeIdLabel(null) === null);
    chk("وبطاقةُ المؤسس تحمل رقمه", (await businessCardData({ kind: "user", id: founder.id }))?.data.employeeId === "TLAQI - 001");

    // ── كلُّ حسابٍ إداريٍّ نشط له رقمٌ فريد
    const users = await prisma.user.findMany({ where: { isActive: true }, select: { employeeNo: true } });
    const nums = users.map((u) => u.employeeNo);
    chk("كلُّ حسابٍ إداريٍّ نشط له رقم", nums.every((n) => n != null), JSON.stringify(nums));
    chk("ولا يتكرّر رقمٌ بين الحسابات", new Set(nums).size === nums.length);

    // ── حسابٌ إداريٌّ جديد يأخذ التاليَ تلقائياً
    const before = await maxNo();
    const u = await prisma.user.create({ data: { fullName: "حساب اختبار", email: `${TAG}-u@example.test`, passwordHash: "x", role: "operations_officer", isActive: false } });
    chk("الحسابُ الإداريُّ الجديد يأخذ الرقمَ التالي تلقائياً", (u.employeeNo ?? 0) > before, `${u.employeeNo} بعد ${before}`);

    // ── العضو: لا رقمَ وهو مرشّح، ورقمُه عند الاعتماد
    const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false, committeeStatus: null } });
    const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
    await prisma.testQuestion.create({ data: { trackId: track.id, prompt: `سؤال ${TAG}`, options: ["أ", "ب", "ج", "د"], correctIndex: 1, order: 998 } });
    const answersFor = async (trackId: string) =>
      Object.fromEntries((await prisma.testQuestion.findMany({ where: { trackId } })).map((q) => [q.id, q.correctIndex]));

    const { member } = await W.createCandidateAccount({
      fullName: "مرشّح الرقم", email: `${TAG}-m@example.test`, jobTitle: "مصمّم", targetRole: "member",
      departmentId: dept.id, testTrackId: track.id, invitedById: founder.id,
    });
    chk("المرشّحُ لا رقمَ له (ليس موظفاً بعد)", (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).employeeNo === null);
    await W.submitTestAttempt({ memberId: member.id, answers: await answersFor(track.id) });
    const beforeApprove = await maxNo();
    await W.approveMember(member.id);
    const approved = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    chk("**وعند اعتماده يأخذ الرقمَ التالي**", (approved.employeeNo ?? 0) > beforeApprove, `${approved.employeeNo} بعد ${beforeApprove}`);
    chk("وبطاقتُه تحمل رقمَه", (await businessCardData({ kind: "member", id: member.id }))?.data.employeeId === employeeIdLabel(approved.employeeNo));

    // ── من غادر رقمُه محفوظ («حتى إذا طلع واحد يكون رقمه محفوظ»): يبقى على سجلّه، ولا يُعطى لغيره
    const { stepDownMember } = await import("@/lib/offboarding");
    const sd = await stepDownMember({ memberId: member.id, byName: "فحص الرقم", reason: "مغادرةٌ اختبارية", endDate: new Date() });
    await prisma.member.update({ where: { id: member.id }, data: { isActive: false, terminatedAt: new Date() } });
    const left = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    chk("**من غادر يبقى رقمُه على سجلّه**", sd.ok && left.employeeNo === approved.employeeNo, `${JSON.stringify(sd)} ${left.employeeNo}`);
    const after = await prisma.user.create({ data: { fullName: "حساب بعد المغادرة", email: `${TAG}-u2@example.test`, passwordHash: "x", role: "operations_officer", isActive: false } });
    chk("**ولا يُعطى رقمُه لغيره** — من بعده يأخذ التالي", after.employeeNo !== left.employeeNo && (after.employeeNo ?? 0) > (left.employeeNo ?? 0), `${after.employeeNo} / ${left.employeeNo}`);

    // ── جدولُ الإدارة العليا (Excel والسجل الحي) يحمل الرقمَ بعد الاسم
    const { governanceTables } = await import("@/lib/governance/sheets");
    const founderRow = (await governanceTables()).senior.find((r) => r[0] === founder.id);
    chk("جدولُ الإدارة العليا في Excel والسجل الحي يحمل الرقم", founderRow?.[2] === "TLAQI - 001", JSON.stringify(founderRow?.slice(0, 4)));

    // ── المرشّحُ القياديّ: حسابُه وسجلُّ عضويته برقمٍ واحد
    const leadDept = await prisma.department.create({
      data: { name: `قسم ${TAG}`, slug: TAG, colorHex: `#${(Date.now() % 0xffffff).toString(16).padStart(6, "0")}` },
    });
    const leadTrack = await prisma.testTrack.findFirst({ where: { scope: "department_admin" } });
    if (!leadTrack) {
      chk("المرشّحُ القياديّ (لا بنكَ قيادة في هذه القاعدة — يُخطّى)", true);
    } else {
      const { member: cand } = await W.createCandidateAccount({
        fullName: "مرشّح قيادة", email: `${TAG}-l@example.test`, jobTitle: null, targetRole: "department_admin",
        departmentId: leadDept.id, testTrackId: leadTrack.id, invitedById: founder.id,
      });
      await W.submitTestAttempt({ memberId: cand.id, answers: await answersFor(leadTrack.id) });
      await W.approveMember(cand.id);
      const leadUser = await prisma.user.findUniqueOrThrow({ where: { email: `${TAG}-l@example.test` } });
      const twin = await prisma.member.findUniqueOrThrow({ where: { id: cand.id } });
      chk("**القائدُ المعتمد له رقم**", leadUser.employeeNo != null);
      chk("**وسجلُّ عضويته يحمل الرقمَ نفسَه — لكل شخصٍ رقمٌ واحد**", twin.employeeNo === leadUser.employeeNo, `${twin.employeeNo} / ${leadUser.employeeNo}`);
    }

    // ── لا رقمَ مكرّرٌ بين شخصين: الأرقامُ في السجلّين لا تتكرّر إلا للتوأم نفسِه (البريدُ نفسُه)
    const people = [
      ...(await prisma.user.findMany({ where: { employeeNo: { not: null } }, select: { email: true, employeeNo: true } })),
      ...(await prisma.member.findMany({ where: { employeeNo: { not: null } }, select: { email: true, employeeNo: true } })),
    ];
    const owner = new Map<number, string>();
    let clash = "";
    for (const p of people) {
      const prev = owner.get(p.employeeNo!);
      if (prev && prev.toLowerCase() !== p.email.toLowerCase()) clash = `${p.employeeNo}: ${prev} / ${p.email}`;
      owner.set(p.employeeNo!, p.email);
    }
    chk("**لا يتشارك شخصان رقماً واحداً**", clash === "", clash);
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.message.split("\n").slice(-2).join(" ") : String(e));
  } finally {
    for (const c of checks) console.log(c);
    const failedN = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failedN}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failedN ? 1 : 0);
  }
})();
