import { prisma } from "@/lib/prisma";
import {
  permanentlyDeleteAccount,
  changeLeadershipEmail,
  sendWelcomeToUser,
} from "@/lib/founderActions";
import { removeLeadershipUser } from "@/lib/workflow";
import { memberForSession } from "@/lib/termination";
import type { Session } from "next-auth";

/** الحذف النهائي وتغيير بريد القيادة — على حساباتٍ تُنشأ وتُحذف. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const MARK = `e2e-fa-${Date.now()}`;
const OLD = `old-${MARK}@example.test`;
const NEW = `new-${MARK}@example.test`;

async function cleanup() {
  for (const e of [OLD, NEW]) {
    const m = await prisma.member.findUnique({ where: { email: e } });
    if (m) {
      await prisma.terminationRequest.deleteMany({ where: { memberId: m.id } });
      await prisma.memberDateEdit.deleteMany({ where: { memberId: m.id } });
      await prisma.member.delete({ where: { id: m.id } });
    }
    await prisma.invite.deleteMany({ where: { email: e } });
    const u = await prisma.user.findUnique({ where: { email: e } });
    if (u) {
      await prisma.leaderSignature.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  }
}

(async () => {
  await cleanup();
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { departmentId: dept.id } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const F = { actorRole: "super_admin", actorId: founder.id, actorName: founder.fullName };

  // قائدٌ له سجلّان: حسابٌ إداري وسجلّ ترشّحه — موصولان بالبريد
  const invite = await prisma.invite.create({
    data: { fullName: "قائد اختبار", email: OLD, targetRole: "department_admin",
            departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  const twin = await prisma.member.create({
    data: { fullName: "قائد اختبار", email: OLD, departmentId: dept.id, inviteId: invite.id,
            approvalStatus: "approved", isActive: true, decidedAt: new Date("2026-01-01") },
  });
  const lead = await prisma.user.create({
    data: { fullName: "قائد اختبار", email: OLD, passwordHash: "x",
            role: "department_admin", departmentId: dept.id, isActive: true },
  });

  const sess = (id: string): Session =>
    ({ user: { id, role: "department_admin", departmentId: dept.id, name: "قائد", email: OLD },
       expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);

  // ١ — الوصل بالبريد يعمل قبل التغيير
  chk("سجلّ العضوية يُوصَل بالبريد", (await memberForSession(sess(lead.id)))?.id === twin.id);

  // ٢ — غير المؤسس يُرفض
  let denied = false;
  try {
    await changeLeadershipEmail({ userId: lead.id, newEmail: NEW,
      actorRole: "executive", actorId: founder.id, actorName: "تنفيذي" });
  } catch { denied = true; }
  chk("تغيير البريد للمؤسس وحده", denied);

  // ٣ — صيغةٌ خاطئة مرفوضة
  const badFmt = await changeLeadershipEmail({ userId: lead.id, newEmail: "لا-بريد", ...F });
  chk("صيغةٌ خاطئة مرفوضة", badFmt.ok === false, badFmt.ok === false ? badFmt.reason : "قُبلت!");

  // ٤ — بريدٌ مستخدَم مرفوض
  const clash = await changeLeadershipEmail({ userId: lead.id, newEmail: founder.email, ...F });
  chk("بريدٌ مستخدَم مرفوض", clash.ok === false, clash.ok === false ? clash.reason : "قُبل!");

  // ٥ — التغيير وانتشاره
  const ch = await changeLeadershipEmail({ userId: lead.id, newEmail: NEW, ...F });
  chk("تغيّر البريد", ch.ok);
  const u2 = await prisma.user.findUniqueOrThrow({ where: { id: lead.id } });
  const t2 = await prisma.member.findUniqueOrThrow({ where: { id: twin.id } });
  chk("حساب الدخول صار على الجديد", u2.email === NEW);
  chk("**وانتشر إلى سجلّ العضوية**", t2.email === NEW, t2.email);
  chk("والوصل بالبريد ما يزال يعمل", (await memberForSession(sess(lead.id)))?.id === twin.id);

  // ٦ — الحذف النهائي: الحسابُ النشط يُرفض بلا إقرارٍ ثانٍ
  const activeDel = await permanentlyDeleteAccount({
    kind: "user", id: lead.id, confirmEmail: NEW, reason: "اختبار", ...F });
  chk("لا يُحذف حسابٌ قياديٌّ نشط بلا إقرار", activeDel.ok === false,
      activeDel.ok === false ? activeDel.reason : "حُذف!");

  // ٦أ — وبالإقرار الصريح يُحذف مباشرةً: الحساب المكرّر الذي أُنشئ خطأً
  //      لا معنى لإلزام المؤسس بتنحيته قبل محوه
  const spare = await prisma.user.create({
    data: { fullName: "مكرّر اختبار", email: "dup-ceo@example.test",
            passwordHash: "x", role: "executive", isActive: true },
  });
  const forced = await permanentlyDeleteAccount({
    kind: "user", id: spare.id, confirmEmail: "dup-ceo@example.test",
    reason: "حساب مكرّر أُنشئ خطأً", force: true, ...F });
  chk("وبالإقرار يُحذف الحساب النشط مباشرةً", forced.ok,
      forced.ok ? "" : (forced as { reason: string }).reason);
  chk("ولم يبقَ له صفّ",
      (await prisma.user.findUnique({ where: { email: "dup-ceo@example.test" } })) === null);

  // ٧ — بريدُ تأكيدٍ خاطئ يُرفض
  await prisma.user.update({ where: { id: lead.id }, data: { isActive: false } });
  const wrongEmail = await permanentlyDeleteAccount({
    kind: "user", id: lead.id, confirmEmail: "غلط@example.test", reason: "اختبار", ...F });
  chk("بريدُ تأكيدٍ خاطئ يمنع الحذف", wrongEmail.ok === false,
      wrongEmail.ok === false ? wrongEmail.reason : "حُذف!");

  // ٨ — حساب المؤسس لا يُحذف، ولا يحذف المؤسس نفسه
  const self = await permanentlyDeleteAccount({
    kind: "user", id: founder.id, confirmEmail: founder.email, reason: "اختبار", ...F });
  chk("المؤسس لا يحذف نفسه", self.ok === false, self.ok === false ? self.reason : "حُذف!");

  // ٨أ — ولا يُحذف حساب المؤسس بيد مؤسسٍ آخر، ولا بإقرارٍ مباشر.
  //      الحماية مطلقة لا مشروطة: المنصة لا تبقى بلا مؤسس نشط.
  const otherFounder = await prisma.user.create({
    data: { fullName: "مؤسس اختبار", email: "founder-test@example.test",
            passwordHash: "x", role: "super_admin", isActive: true },
  });
  const killFounder = await permanentlyDeleteAccount({
    kind: "user", id: otherFounder.id, confirmEmail: otherFounder.email,
    reason: "محاولة حذف حساب مؤسس", force: true, ...F });
  chk("حساب المؤسس لا يُحذف ولو بإقرارٍ مباشر", killFounder.ok === false,
      killFounder.ok === false ? killFounder.reason : "حُذف!");
  chk("وما يزال في القاعدة",
      (await prisma.user.findUnique({ where: { id: otherFounder.id } })) !== null);

  // ٨ب — ولا يُنحّى: التنحية الطريق الآخر إلى تعطيله
  let standDownDenied = false;
  try {
    await removeLeadershipUser({ userId: otherFounder.id, reason: "اختبار",
      performedById: founder.id, performedByName: "المؤسس" });
  } catch { standDownDenied = true; }
  chk("وحساب المؤسس لا يُنحّى أيضاً", standDownDenied);
  chk("فيبقى نشطاً",
      (await prisma.user.findUniqueOrThrow({ where: { id: otherFounder.id } })).isActive === true);
  await prisma.user.delete({ where: { id: otherFounder.id } });

  // ٨ج — بطاقة الانضمام إلى حسابٍ إداري: التصريح للمؤسس وحده
  let mailDenied = false;
  try {
    await sendWelcomeToUser({ userId: founder.id, actorRole: "executive", actorName: "تنفيذي" });
  } catch { mailDenied = true; }
  chk("إرسال البطاقة للمؤسس وحده — ويُفرض في الخادم", mailDenied);

  // والمؤسس يُرسلها إلى نفسه (البريد مُعطَّل في الاختبار، فالمهم أن
  // التصريح يمرّ ولا يُرفض لكونه هو هو)
  const selfMail = await sendWelcomeToUser({
    userId: founder.id, actorRole: "super_admin", actorName: "المؤسس" });
  chk("والمؤسس يُرسل البطاقة إلى نفسه",
      selfMail.ok === true || (selfMail.ok === false && !selfMail.reason.includes("وحده")),
      selfMail.ok ? selfMail.to : selfMail.reason);

  // ٨د — ولا تُرسَل إلى حسابٍ مُنحّى: الرابط وعدٌ ببابٍ مفتوح
  const stoodDown = await prisma.user.create({
    data: { fullName: "مُنحّى اختبار", email: "stood-down@example.test",
            passwordHash: "x", role: "department_admin", isActive: false },
  });
  const deadMail = await sendWelcomeToUser({
    userId: stoodDown.id, actorRole: "super_admin", actorName: "المؤسس" });
  chk("ولا تُرسَل بطاقة دخول لحسابٍ مُنحّى", deadMail.ok === false,
      deadMail.ok === false ? deadMail.reason : "أُرسلت!");
  await prisma.user.delete({ where: { id: stoodDown.id } });

  // ٩ — تذكرةٌ له تُفَكّ ولا تُحذف
  const member = await prisma.member.findFirstOrThrow({ where: { departmentId: dept.id, isActive: true } });
  const ticket = await prisma.ticket.create({
    data: { subject: "تذكرة قبل الحذف", description: "اختبار", memberId: member.id,
            targetUserId: lead.id, stage: "department",
            stageDueAt: new Date(Date.now() + 86400_000), firstDueAt: new Date(Date.now() + 86400_000) },
  });

  const del = await permanentlyDeleteAccount({
    kind: "user", id: lead.id, confirmEmail: NEW, reason: "اختبار الحذف النهائي", ...F });
  chk("حُذف الحساب الإداري", del.ok);
  chk("ولم يبقَ في القاعدة", (await prisma.user.findUnique({ where: { id: lead.id } })) === null);
  const tAfter = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  chk("**التذكرة باقية لا محذوفة**", true);
  chk("وارتباطها فُكّ لا كُسر", tAfter.targetUserId === null);
  await prisma.ticket.delete({ where: { id: ticket.id } });

  // ١٠ — سجلّ العضوية: البريد محجوزٌ ما دام له توأم؟ لا — حُذف التوأم
  const memberDel = await permanentlyDeleteAccount({
    kind: "member", id: twin.id, confirmEmail: NEW, reason: "اختبار", ...F });
  chk("سجلّ العضوية المعتمد النشط يُرفض", memberDel.ok === false,
      memberDel.ok === false ? memberDel.reason : "حُذف!");

  await prisma.member.update({ where: { id: twin.id }, data: { isActive: false } });
  const memberDel2 = await permanentlyDeleteAccount({
    kind: "member", id: twin.id, confirmEmail: NEW, reason: "اختبار", ...F });
  chk("وبعد تعطيله يُحذف", memberDel2.ok, memberDel2.ok ? "" : (memberDel2 as {reason:string}).reason);
  chk("والبريد تحرّر", (await prisma.member.findUnique({ where: { email: NEW } })) === null);

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
