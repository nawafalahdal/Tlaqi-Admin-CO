/** الرئيسُ التنفيذيُّ يدعو مسؤولَ المتابعة والتشغيل — الطريقُ كلُّه.
 *
 *  ## الحادثة
 *
 *  «الرئيس التنفيذي لا يستطيع دعوة مسؤول المتابعة والتشغيل — الدور لا
 *  يعمل كما ينبغي.» والسببُ الجذري: ترحيلُ الدور أضاف القيمة إلى التعداد
 *  ولم يُنشئ صفَّ بنك أسئلته؛ والصفُّ يُنشئه البذرُ وحده. فكانت الدعوة
 *  تقع على `findFirstOrThrow`، وخطؤه ليس `Error` عادياً، فتُخفيه
 *  `safeErrorMessage` خلف «حدث خطأ غير متوقع».
 *
 *  ## ما يُثبته هذا الفحص
 *
 *  ١. البنكُ الغائب والبنكُ الفارغ يُسمَّيان باسمهما (لا خطأ عامّ ولا رسوبٌ آلي).
 *  ٢. الطريق كلّه: دعوةٌ ← اختبار ← اعتماد ← حسابٌ بدور `operations_officer`
 *     بلا قسم، ولا مدخلَ ثانٍ بصفّ المرشّح، ولا يظهر في قائمة الأعضاء.
 *  ٣. مصفوفةُ الحسم: من يعتمد أيَّ منصب — والرئيسُ لا يعتمد خَلَفَه.
 *
 *  تجهيزاتٌ مُعلَّمة تُنشأ وتُحذف على قاعدةٍ محلية.
 */
import { PrismaClient } from "@prisma/client";
import { getTrackForTarget } from "../src/lib/testTracks";
import { createCandidateAccount, submitTestAttempt, approveMember, findRoleSeatHolder } from "../src/lib/workflow";
import { canDecideCandidate } from "../src/lib/permissions";
import { ROSTER_MEMBER_WHERE } from "../src/lib/roster";
import { safeErrorMessage } from "../src/lib/safeError";

const prisma = new PrismaClient();
const log: string[] = [];
const chk = (name: string, ok: boolean, detail = "") =>
  log.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);

const TAG = `ops-e2e-${Date.now()}`;

async function refusal(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return safeErrorMessage(e);
  }
}

async function main() {
  // ══ ١) البنكُ الغائب والفارغ يُسمَّيان ══
  const slug = `e2e-${TAG}`;
  const dept = await prisma.department.create({
    data: { name: `قسم ${TAG}`, slug, colorHex: "#69B88A" },
  });
  try {
    const missing = await refusal(() => getTrackForTarget("member", dept.id));
    chk("**البنكُ الغائب يُسمّى باسمه — لا «حدث خطأ غير متوقع»**",
        !!missing && missing.includes("لا يوجد بنكُ أسئلة") && !missing.includes("غير متوقع"), missing ?? "");

    await prisma.testTrack.create({ data: { scope: "department_member", departmentId: dept.id } });
    const empty = await refusal(() => getTrackForTarget("member", dept.id));
    chk("**والبنكُ الفارغ يُرفض قبل الدعوة — لا رسوبَ آلياً بـ٠٪**",
        !!empty && empty.includes("فارغ"), empty ?? "");
  } finally {
    await prisma.testTrack.deleteMany({ where: { departmentId: dept.id } });
    await prisma.department.delete({ where: { id: dept.id } });
  }

  // ══ ٢) الطريق كلّه ══
  const ceo = await prisma.user.findFirst({ where: { role: "executive", isActive: true } });
  const seat = await findRoleSeatHolder("operations_officer", null);
  const opsTrack = await prisma.testTrack.findFirst({
    where: { scope: "operations_officer" },
    include: { questions: true },
  });
  chk("الترحيلُ يضمن صفَّ بنك مسؤول التشغيل", !!opsTrack);

  if (!ceo) {
    chk("BLOCKED: لا رئيسَ تنفيذيٌّ نشطٌ في القاعدة المحلية", false);
  } else if (seat) {
    log.push(`⚠ BLOCKED: منصب مسؤول التشغيل مشغولٌ محلياً (${seat.kind}) — تُتخطّى الرحلة، لا تُعدَّل البيانات`);
  } else if (!opsTrack || opsTrack.questions.length === 0) {
    log.push("⚠ BLOCKED: بنكُ أسئلة مسؤول التشغيل فارغٌ محلياً");
  } else {
    const email = `ops.${TAG}@example.test`;
    let memberId: string | null = null;
    try {
      const track = await getTrackForTarget("operations_officer", null);
      const { member } = await createCandidateAccount({
        fullName: `مسؤول ${TAG}`,
        email,
        jobTitle: "مسؤول المتابعة والتشغيل",
        targetRole: "operations_officer",
        departmentId: null,
        testTrackId: track.id,
        invitedById: ceo.id,
      });
      memberId = member.id;
      const invite = await prisma.invite.findUniqueOrThrow({ where: { id: member.inviteId } });
      chk("الدعوةُ تُحفَظ بالدور الصحيح", invite.targetRole === "operations_officer", invite.targetRole);
      chk("وبلا قسم", invite.departmentId === null);
      chk("والداعي هو الرئيس التنفيذي", invite.invitedById === ceo.id);

      // الدعوةُ الثانية للمنصب نفسه تُرفض: مرشّحٌ قائم
      const second = await refusal(() =>
        createCandidateAccount({
          fullName: "ثانٍ", email: `ops2.${TAG}@example.test`, jobTitle: "x",
          targetRole: "operations_officer", departmentId: null,
          testTrackId: track.id, invitedById: ceo.id,
        })
      );
      chk("ودعوةٌ ثانيةٌ للمنصب نفسه تُرفض باسم المرشّح القائم",
          !!second && second.includes("مرشّح"), second ?? "");

      const answers = Object.fromEntries(opsTrack.questions.map((q) => [q.id, q.correctIndex]));
      const result = await submitTestAttempt({ memberId: member.id, answers });
      chk("المرشّحُ يجتاز اختباره", result?.passed === true, `${result?.score}%`);

      // مصفوفةُ الحسم على هذا المرشّح بعينه
      const cand = { targetRole: "operations_officer" as const, departmentId: null };
      chk("الرئيسُ التنفيذيُّ يَحسمه", canDecideCandidate({ role: "executive" }, cand));
      chk("وقائدُ قسمٍ لا يَحسمه", !canDecideCandidate({ role: "department_admin", departmentId: "x" }, cand));
      chk("ومسؤولُ التشغيل لا يَحسم منصبه", !canDecideCandidate({ role: "operations_officer" }, cand));

      await approveMember(member.id);
      const user = await prisma.user.findUnique({ where: { email } });
      chk("**بعد الاعتماد: حسابٌ إداريٌّ بدور مسؤول التشغيل**", user?.role === "operations_officer", user?.role ?? "لا حساب");
      chk("وبلا قسم", user?.departmentId === null);
      const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
      chk("وصفُّ المرشّح لا يبقى مَدخلاً ثانياً (كلمته نُقلت)", after.passwordHash === null);
      const inRoster = await prisma.member.count({ where: { id: member.id, ...ROSTER_MEMBER_WHERE } });
      chk("**ولا يظهر عضواً في قائمة الأعضاء**", inRoster === 0);
      const nowSeat = await findRoleSeatHolder("operations_officer", null);
      chk("والمنصبُ صار مشغولاً به", nowSeat?.kind === "active" && nowSeat.email === email);
    } finally {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.leaderSignature.deleteMany({ where: { userId: u.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: u.id } }).catch((e) => log.push(`⚠ تنظيف: ${e.message.split("\n")[0]}`));
      }
      if (memberId) {
        await prisma.testAttempt.deleteMany({ where: { memberId } });
        await prisma.member.delete({ where: { id: memberId } }).catch((e) => log.push(`⚠ تنظيف: ${e.message.split("\n")[0]}`));
      }
      await prisma.invite.deleteMany({ where: { email: { contains: TAG } } });
    }
  }

  // ══ ٣) مصفوفةُ الحسم ══
  const exec = { targetRole: "executive" as const, departmentId: null };
  chk("**الرئيسُ التنفيذيُّ لا يَعتمد مرشّحاً تنفيذياً — خَلَفَه**", !canDecideCandidate({ role: "executive" }, exec));
  chk("والمؤسسُ يَعتمده", canDecideCandidate({ role: "super_admin" }, exec));
  const lead = { targetRole: "department_admin" as const, departmentId: "d1" };
  chk("قائدُ القسم لا يَعتمد قائداً لقسمه", !canDecideCandidate({ role: "department_admin", departmentId: "d1" }, lead));
  const mem = { targetRole: "member" as const, departmentId: "d1" };
  chk("قائدُ القسم يَعتمد عضواً في قسمه", canDecideCandidate({ role: "department_admin", departmentId: "d1" }, mem));
  chk("**ولا يَعتمد عضواً في قسمٍ غيره**", !canDecideCandidate({ role: "department_admin", departmentId: "d2" }, mem));
  chk("والعضوُ لا يَعتمد أحداً", !canDecideCandidate({ role: "member" }, mem));
  chk("ولا قائدٌ بلا قسمٍ يَعتمد عضواً بلا قسم",
      !canDecideCandidate({ role: "department_admin", departmentId: null }, { targetRole: "member", departmentId: null }));

  console.log(log.join("\n"));
  const failed = log.filter((l) => l.startsWith("✗")).length;
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  if (failed) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
