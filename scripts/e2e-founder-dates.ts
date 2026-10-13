import { prisma } from "@/lib/prisma";
import { correctMemberDate, sendWelcomeToMember } from "@/lib/founderActions";
import { issueAppreciation } from "@/lib/appreciation";

/** تصحيح التواريخ وإرسال البطاقة — على بياناتٍ اختباريةٍ تُنشأ وتُحذف. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const EMAIL = `e2e-dates-${Date.now()}@example.test`;

async function cleanup() {
  const m = await prisma.member.findUnique({ where: { email: EMAIL } });
  if (m) {
    await prisma.memberDateEdit.deleteMany({ where: { memberId: m.id } });
    await prisma.member.delete({ where: { id: m.id } });
    await prisma.invite.delete({ where: { id: m.inviteId } });
  }
}

(async () => {
  await cleanup();
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { departmentId: dept.id } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  const invite = await prisma.invite.create({
    data: { fullName: "عضو اختبار التواريخ", email: EMAIL, targetRole: "member",
            departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  // كُلِّف اليوم، لكنه انضمّ للمنظمة قبل سنتين (سبق المنصة)
  const assignmentStart = new Date();
  const member = await prisma.member.create({
    data: { fullName: "عضو اختبار التواريخ", email: EMAIL, departmentId: dept.id,
            inviteId: invite.id, decidedAt: assignmentStart, approvalStatus: "approved", isActive: true },
  });

  const F = { actorRole: "super_admin", actorId: founder.id, actorName: founder.fullName };

  // ١ — غير المؤسس يُرفض في الخادم
  let denied = false;
  try {
    await correctMemberDate({ memberId: member.id, field: "orgJoinDate", value: new Date("2024-03-01"),
                              actorRole: "department_admin", actorId: founder.id, actorName: "قائد" });
  } catch { denied = true; }
  chk("غير المؤسس يُرفض في الخادم لا بإخفاء زرّ", denied);

  // ٢ — تصحيح تاريخ الانضمام التنظيمي
  const orgDate = new Date("2024-03-01T00:00:00Z");
  const r1 = await correctMemberDate({ memberId: member.id, field: "orgJoinDate", value: orgDate,
                                       note: "انضمّ قبل المنصة", ...F });
  chk("التصحيح نجح", r1.ok);
  const after1 = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("تاريخ الانضمام التنظيمي سُجِّل", after1.orgJoinDate?.toISOString() === orgDate.toISOString());

  // ٣ — ولم يُحرّك بداية التكليف
  chk("بداية التكليف لم تتحرّك",
      after1.decidedAt?.getTime() === assignmentStart.getTime(),
      after1.decidedAt?.toISOString().slice(0,10) ?? "—");
  chk("وتاريخ إنشاء الحساب لم يتحرّك", after1.createdAt.getTime() === member.createdAt.getTime());

  // ٤ — السجلّ: القيمة السابقة والجديدة ومن عدّل
  const edits = await prisma.memberDateEdit.findMany({ where: { memberId: member.id } });
  chk("التعديل مُسجَّل", edits.length === 1, String(edits.length));
  chk("القيمة السابقة محفوظة (كانت فارغة)", edits[0]?.previous === null);
  chk("القيمة الجديدة محفوظة", edits[0]?.next?.toISOString() === orgDate.toISOString());
  chk("من عدّل محفوظ", edits[0]?.editedByName === founder.fullName);

  // ٥ — استحقاق الثلاثة أشهر يُقاس بالتكليف لا بالانضمام
  const appr = await issueAppreciation(member.id);
  chk("لم يستحقّ شهادة التقدير بتصحيح تاريخ انضمامه",
      appr.ok === false && appr.reason.includes("لم يُكمل"),
      appr.ok === false ? appr.reason : "استحقّها!");
  const after2 = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("ولم تُصدَر له شهادة", after2.appreciationIssuedAt === null);

  // ٦ — تاريخ في المستقبل مرفوض
  const r2 = await correctMemberDate({ memberId: member.id, field: "orgJoinDate",
                                       value: new Date(Date.now() + 86400_000), ...F });
  chk("تاريخ في المستقبل مرفوض", r2.ok === false, r2.ok === false ? r2.reason : "قُبل!");

  // ٧ — تصحيحٌ بنفس القيمة لا يُسجَّل تعديلاً
  await correctMemberDate({ memberId: member.id, field: "orgJoinDate", value: orgDate, ...F });
  const edits2 = await prisma.memberDateEdit.findMany({ where: { memberId: member.id } });
  chk("تصحيحٌ بنفس القيمة لا يُضيف سجلاً", edits2.length === 1, String(edits2.length));

  // ٨ — البطاقة اليدوية: غير المؤسس يُرفض
  let denied2 = false;
  try {
    await sendWelcomeToMember({ memberId: member.id, actorRole: "executive", actorName: "تنفيذي" });
  } catch { denied2 = true; }
  chk("إرسال البطاقة يدوياً للمؤسس وحده", denied2);

  // ٩ — ولا تُرسَل لحسابٍ مُعطَّل
  await prisma.member.update({ where: { id: member.id }, data: { isActive: false } });
  const w1 = await sendWelcomeToMember({ memberId: member.id, actorRole: "super_admin", actorName: founder.fullName });
  chk("لا تُرسَل لحسابٍ مُعطَّل", w1.ok === false, w1.ok === false ? w1.reason : "أُرسلت!");

  // ١٠ — ولا لمن أُغلقت تجربته
  await prisma.member.update({ where: { id: member.id }, data: { isActive: true, noFurtherEmail: true } });
  const w2 = await sendWelcomeToMember({ memberId: member.id, actorRole: "super_admin", actorName: founder.fullName });
  chk("ولا لمن أُغلقت تجربته", w2.ok === false, w2.ok === false ? w2.reason : "أُرسلت!");

  // ١١ — ولا لمن لم يُعتمد
  await prisma.member.update({ where: { id: member.id }, data: { noFurtherEmail: false, decidedAt: null } });
  const w3 = await sendWelcomeToMember({ memberId: member.id, actorRole: "super_admin", actorName: founder.fullName });
  chk("ولا لمن لم يُعتمد بعد", w3.ok === false, w3.ok === false ? w3.reason : "أُرسلت!");

  // ١٢ — والإرسال لا يُغيّر حالة العضوية
  await prisma.member.update({ where: { id: member.id }, data: { decidedAt: assignmentStart } });
  const before = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  await sendWelcomeToMember({ memberId: member.id, actorRole: "super_admin", actorName: founder.fullName });
  const afterSend = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("الإرسال لا يُغيّر حالة العضوية", afterSend.approvalStatus === before.approvalStatus && afterSend.isActive === before.isActive);
  chk("ولا يُصفّر بداية التكليف", afterSend.decidedAt?.getTime() === assignmentStart.getTime());
  chk("ولا يُغيّر تاريخ الانضمام التنظيمي", afterSend.orgJoinDate?.toISOString() === orgDate.toISOString());

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
