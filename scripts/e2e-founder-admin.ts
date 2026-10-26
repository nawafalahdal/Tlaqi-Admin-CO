import { prisma } from "@/lib/prisma";
import {
  permanentlyDeleteAccount,
  changeLeadershipEmail,
  sendWelcomeToUser,
} from "@/lib/founderActions";
import { removeLeadershipUser, seatConflicts } from "@/lib/workflow";
import { buildOrgChart } from "@/lib/orgChart";
import { requestPasswordReset } from "@/lib/passwordReset";
import { hashPassword } from "@/lib/credentials";
import { isLeadershipRecord } from "@/lib/roster";
import { memberForSession } from "@/lib/termination";
import type { Session } from "next-auth";

/** جلسةٌ مصطنعة للفحص — بالدور وحده */
const asRole = (id: string, role: string, name = "فحص"): Session =>
  ({ user: { id, role, name, email: "probe@example.test" },
     expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);

/** الحذف النهائي وتغيير بريد القيادة — على حساباتٍ تُنشأ وتُحذف. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const MARK = `e2e-fa-${Date.now()}`;
const OLD = `old-${MARK}@example.test`;
const NEW = `new-${MARK}@example.test`;

async function cleanup() {
  for (const e of [OLD, NEW, "held-twin@example.test", "via-twin@example.test", "via-active@example.test", "orphan-lead@example.test"]) {
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
  const mailDenied = await sendWelcomeToUser({ userId: founder.id, session: asRole(founder.id + "x", "executive") });
  chk("الرئيس التنفيذي لا يُعيد البطاقة — ويُفرض في الخادم", mailDenied.ok === false,
      mailDenied.ok === false ? mailDenied.reason : "أُرسلت!");
  // السلسلة: المؤسس يُرسل لنفسه (البريد معطّل في الفحص، فالمهم ألّا يُرفض بالصلاحية)
  const founderSelf = await sendWelcomeToUser({ userId: founder.id, session: asRole(founder.id, "super_admin", "المؤسس") });
  chk("والمؤسس يُرسل بطاقته لنفسه", founderSelf.ok === true || !founderSelf.reason.includes("وحده"),
      founderSelf.ok ? founderSelf.to : founderSelf.reason);
  // وبلا سقف: بعد إرساليه وأكثر لا يُقال له «استُنفدت» — والسقفُ باقٍ على غيره
  const keep = await prisma.user.findUniqueOrThrow({ where: { id: founder.id },
    select: { welcomeEmailCount: true, welcomeEmailSentAt: true, welcomeClaimedAt: true } });
  const longAgo = new Date(Date.now() - 86_400_000);
  await prisma.user.update({ where: { id: founder.id },
    data: { welcomeEmailCount: 5, welcomeEmailSentAt: longAgo, welcomeClaimedAt: null } });
  const founderUncapped = await sendWelcomeToUser({ userId: founder.id, session: asRole(founder.id, "super_admin", "المؤسس") });
  chk("والمؤسس لنفسه بلا سقف", founderUncapped.ok === true || !founderUncapped.reason.includes("استُنفدت"),
      founderUncapped.ok ? founderUncapped.to : founderUncapped.reason);
  await prisma.user.update({ where: { id: founder.id }, data: keep });
  const execUser = await prisma.user.findFirst({ where: { role: "executive", isActive: true },
    select: { id: true, welcomeEmailCount: true, welcomeEmailSentAt: true, welcomeClaimedAt: true } });
  if (execUser) {
    await prisma.user.update({ where: { id: execUser.id },
      data: { welcomeEmailCount: 2, welcomeEmailSentAt: longAgo, welcomeClaimedAt: null } });
    const execCapped = await sendWelcomeToUser({ userId: execUser.id, session: asRole(founder.id, "super_admin", "المؤسس") });
    chk("والسقفُ باقٍ على بطاقة التنفيذي ولو أعادها المؤسس", execCapped.ok === false && execCapped.reason.includes("استُنفدت"),
        execCapped.ok === false ? execCapped.reason : "أُرسلت!");
    await prisma.user.update({ where: { id: execUser.id }, data: {
      welcomeEmailCount: execUser.welcomeEmailCount, welcomeEmailSentAt: execUser.welcomeEmailSentAt,
      welcomeClaimedAt: execUser.welcomeClaimedAt } });
  }
  // والتنفيذي لا يُعيد لقائد قسم — ذاك لمسؤول التشغيل
  const lead2 = await prisma.user.findFirst({ where: { role: "department_admin", isActive: true } });
  if (lead2) {
    const execToLead = await sendWelcomeToUser({ userId: lead2.id, session: asRole(founder.id + "x", "executive") });
    chk("التنفيذي لا يُعيد بطاقة قائد القسم", execToLead.ok === false && execToLead.reason.includes("مسؤول المتابعة"),
        execToLead.ok === false ? execToLead.reason : "أُرسلت!");
  }
  const opsToFounder = await sendWelcomeToUser({ userId: founder.id, session: asRole(founder.id + "y", "operations_officer") });
  chk("ومسؤول التشغيل لا يُعيد بطاقة المؤسس", opsToFounder.ok === false && opsToFounder.reason.includes("المؤسس"),
      opsToFounder.ok === false ? opsToFounder.reason : "أُرسلت!");

  // ٨د — ولا تُرسَل إلى حسابٍ مُنحّى: الرابط وعدٌ ببابٍ مفتوح
  const stoodDown = await prisma.user.create({
    data: { fullName: "مُنحّى اختبار", email: "stood-down@example.test",
            passwordHash: "x", role: "department_admin", isActive: false },
  });
  const deadMail = await sendWelcomeToUser({
    userId: stoodDown.id, session: asRole(founder.id + "y", "operations_officer") });
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
  // كانت القاعدة أن تُفَكّ وجهتُها إلى `null`. وهذا عطبٌ لا حماية:
  // تذكرةٌ بلا وجهة تسقط من كل قائمةٍ فلا يراها أحد ولا تُغلَق أبداً.
  // فصارت تُورَّث: المفتوحة تنتقل إلى خَلَف صاحبها.
  chk("**ووجهتُها انتقلت إلى الخَلَف لا إلى العدم**",
      tAfter.targetUserId !== null && tAfter.targetUserId !== lead.id,
      String(tAfter.targetUserId));
  await prisma.ticket.delete({ where: { id: ticket.id } });

  // ١٠ — الحذفُ للشخص لا لأحد سجلَّيه: سجلُّ ترشّح القائد يُمحى مع حسابه.
  //
  //      كان يبقى معتمَداً نشطاً، فيظهر في الهيكل عضواً في قسمه ويحجز بريدَه
  //      (التوقّعُ القديم هنا كان «يبقى، ويُرفض محوه ما دام نشطاً» — وهو ما طلب
  //      المؤسس صراحةً تغييره: المحذوف نهائياً لا يبقى منه إلا الشيت).
  chk("**وسجلُّ ترشّحه مُحي معه**", (await prisma.member.findUnique({ where: { id: twin.id } })) === null);
  chk("ودعوتُه معه", (await prisma.invite.findUnique({ where: { id: invite.id } })) === null);
  chk("ويُقال إن البريد تحرّر", del.ok && del.emailFreed === true && del.heldBy === null);
  chk("والبريد حرٌّ فعلاً لدعوةٍ جديدة",
      (await prisma.member.findUnique({ where: { email: NEW } })) === null &&
      (await prisma.user.findUnique({ where: { email: NEW } })) === null);

  // وعضوٌ عاديٌّ معتمدٌ نشط: لا يُمحى بلا إقرارٍ ثانٍ، ويُمحى به
  const plainInvite = await prisma.invite.create({
    data: { fullName: "عضو اختبار", email: OLD, targetRole: "member",
            departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  const plain = await prisma.member.create({
    data: { fullName: "عضو اختبار", email: OLD, departmentId: dept.id, inviteId: plainInvite.id,
            approvalStatus: "approved", isActive: true, decidedAt: new Date("2026-01-01") },
  });
  const memberDel = await permanentlyDeleteAccount({
    kind: "member", id: plain.id, confirmEmail: OLD, reason: "اختبار", ...F });
  chk("سجلّ العضوية المعتمد النشط يُرفض بلا إقرار", memberDel.ok === false,
      memberDel.ok === false ? memberDel.reason : "حُذف!");
  const memberDel2 = await permanentlyDeleteAccount({
    kind: "member", id: plain.id, confirmEmail: OLD, reason: "اختبار", force: true, ...F });
  chk("وبالإقرار يُحذف", memberDel2.ok, memberDel2.ok ? "" : (memberDel2 as {reason:string}).reason);
  chk("والبريد تحرّر", (await prisma.member.findUnique({ where: { email: OLD } })) === null &&
      (await prisma.invite.findUnique({ where: { id: plainInvite.id } })) === null);

  // ٨ه — الحساب المُنحّى يُمحى بلا إقرارٍ إضافي، ويُقال الحقُّ في البريد.
  //
  //      المُنحّى بريدُه محجوزٌ في القاعدة وإن لم يَقبل دخولاً. وحذفُه
  //      يُحرّره — إلا إن بقي له سجلُّ عضويةٍ يحمله، فيُقال ذلك صريحاً
  //      ولا يُقال «تحرّر» وقد لم يتحرّر.
  const removed = await prisma.user.create({
    data: { fullName: "مُنحّى للحذف", email: "removed-purge@example.test",
            passwordHash: "x", role: "department_admin", isActive: false,
            removedAt: new Date(), removalReason: "اختبار التنحية" },
  });
  const purgeRemoved = await permanentlyDeleteAccount({
    kind: "user", id: removed.id, confirmEmail: "removed-purge@example.test",
    reason: "محو حسابٍ مُنحّى لتحرير بريده", ...F });
  chk("الحساب المُنحّى يُمحى بلا إقرارٍ إضافي", purgeRemoved.ok,
      purgeRemoved.ok ? "" : (purgeRemoved as { reason: string }).reason);
  chk("ويُقال إن البريد تحرّر", purgeRemoved.ok && purgeRemoved.emailFreed === true);
  chk("والبريد حرٌّ فعلاً",
      (await prisma.user.findUnique({ where: { email: "removed-purge@example.test" } })) === null);

  // ٨و — وإن بقي سجلُّ عضويةٍ يحمل البريد، لا يُقال «تحرّر»
  const heldDept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const heldInvite = await prisma.invite.create({
    data: { fullName: "قائد له توأم", email: "held-twin@example.test",
            departmentId: heldDept.id, targetRole: "department_admin",
            testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  await prisma.member.create({
    data: { fullName: "قائد له توأم", email: "held-twin@example.test",
            inviteId: heldInvite.id, departmentId: heldDept.id,
            approvalStatus: "approved", isActive: true },
  });
  const heldUser = await prisma.user.create({
    data: { fullName: "قائد له توأم", email: "held-twin@example.test",
            passwordHash: "x", role: "department_admin", isActive: false,
            removedAt: new Date(), removalReason: "اختبار" },
  });
  const purgeHeld = await permanentlyDeleteAccount({
    kind: "user", id: heldUser.id, confirmEmail: "held-twin@example.test",
    reason: "محو قائدٍ مُنحّى له سجلّ ترشّح", ...F });
  chk("حُذف الحساب الإداري المُنحّى", purgeHeld.ok);
  // كان التوقّعُ «يبقى سجلُّ العضوية ويُقال إن البريد محجوز» — والحذفُ الآن للسجلّين معاً
  chk("**ومعه سجلُّ ترشّحه، فالبريد تحرّر ويُقال ذلك**",
      purgeHeld.ok && purgeHeld.emailFreed === true && purgeHeld.heldBy === null &&
      (await prisma.member.findUnique({ where: { email: "held-twin@example.test" } })) === null &&
      (await prisma.invite.findUnique({ where: { id: heldInvite.id } })) === null);
  await prisma.member.deleteMany({ where: { email: "held-twin@example.test" } });
  await prisma.invite.deleteMany({ where: { id: heldInvite.id } });

  // ٨ز — والحذفُ من سجلّ الترشّح يذهب إلى الحساب الإداري فيُمحى الاثنان — بحمايات ذلك الطريق
  const viaInvite = await prisma.invite.create({
    data: { fullName: "قائد يُحذف من سجلّه", email: "via-twin@example.test", departmentId: heldDept.id,
            targetRole: "department_admin", testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  const viaTwin = await prisma.member.create({
    data: { fullName: "قائد يُحذف من سجلّه", email: "via-twin@example.test", inviteId: viaInvite.id,
            departmentId: heldDept.id, approvalStatus: "approved", isActive: true },
  });
  const viaUser = await prisma.user.create({
    data: { fullName: "قائد يُحذف من سجلّه", email: "via-twin@example.test", passwordHash: "x",
            role: "department_admin", departmentId: heldDept.id, isActive: false, removedAt: new Date(), removalReason: "اختبار" },
  });
  const viaDel = await permanentlyDeleteAccount({
    kind: "member", id: viaTwin.id, confirmEmail: "via-twin@example.test", reason: "محوٌ من سجلّ الترشّح", force: true, ...F });
  chk("**الحذفُ من سجلّ الترشّح يمحو الحساب الإداري معه**",
      viaDel.ok && (await prisma.user.findUnique({ where: { id: viaUser.id } })) === null &&
      (await prisma.member.findUnique({ where: { id: viaTwin.id } })) === null,
      viaDel.ok ? "" : (viaDel as { reason: string }).reason);
  const activeInvite = await prisma.invite.create({
    data: { fullName: "قائد نشط", email: "via-active@example.test", departmentId: heldDept.id,
            targetRole: "department_admin", testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  const activeTwin = await prisma.member.create({
    data: { fullName: "قائد نشط", email: "via-active@example.test", inviteId: activeInvite.id,
            departmentId: heldDept.id, approvalStatus: "approved", isActive: true },
  });
  const activeUser = await prisma.user.create({
    data: { fullName: "قائد نشط", email: "via-active@example.test", passwordHash: "x",
            role: "department_admin", departmentId: heldDept.id, isActive: true },
  });
  const activeViaDel = await permanentlyDeleteAccount({
    kind: "member", id: activeTwin.id, confirmEmail: "via-active@example.test", reason: "محاولة بلا إقرار", ...F });
  chk("ولا يُمحى قائدٌ نشطٌ من سجلّ ترشّحه بلا إقرار — ويبقى السجلّان",
      activeViaDel.ok === false &&
      (await prisma.user.findUnique({ where: { id: activeUser.id } })) !== null &&
      (await prisma.member.findUnique({ where: { id: activeTwin.id } })) !== null,
      activeViaDel.ok === false ? activeViaDel.reason : "حُذف!");
  await prisma.user.delete({ where: { id: activeUser.id } });
  await prisma.member.delete({ where: { id: activeTwin.id } });
  await prisma.invite.delete({ where: { id: activeInvite.id } });

  // ٨ح — بقيةُ حذفٍ سابق: سجلُّ ترشّح قائدٍ حُذف حسابه قبل هذا الإصلاح.
  //      لا يُدخَل به، ولا يُستعاد له، ولا يظهر في الهيكل — ويُمحى من «المنحّون».
  const orphanInvite = await prisma.invite.create({
    data: { fullName: "قائدة سابقة", email: "orphan-lead@example.test", departmentId: heldDept.id,
            targetRole: "department_admin", testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  const orphan = await prisma.member.create({
    data: { fullName: "قائدة سابقة", email: "orphan-lead@example.test", inviteId: orphanInvite.id,
            departmentId: heldDept.id, approvalStatus: "approved", isActive: true,
            // كلمةُ مرورٍ باقية: أسوأ الحالات — سجلٌّ من قبل أن يُفرَّغ عند الترقية
            passwordHash: await hashPassword("Orphan#2026aa") },
    include: { invite: true },
  });
  chk("سجلُّ ترشّح القائد المعتمَد يُعرَف سجلاً قيادياً", isLeadershipRecord(orphan) &&
      !isLeadershipRecord({ approvalStatus: "approved", invite: { targetRole: "member" } }) &&
      !isLeadershipRecord({ approvalStatus: "pending_review", invite: { targetRole: "department_admin" } }));
  const chart = await buildOrgChart("ar");
  const inChart = chart.departments.some((d) => d.members.some((m) => m.id === orphan.id) || d.committees.some((c) => c.members.some((m) => m.id === orphan.id))) ||
    chart.unassigned.some((m) => m.id === orphan.id);
  chk("**ولا يظهر في الهيكل عضواً**", !inChart);
  const tokensBefore = await prisma.passwordResetToken.count({ where: { email: "orphan-lead@example.test" } });
  await requestPasswordReset("orphan-lead@example.test");
  chk("ولا يُرسَل له رابطُ استعادةٍ لكلمة المرور",
      (await prisma.passwordResetToken.count({ where: { email: "orphan-lead@example.test" } })) === tokensBefore);
  const orphanDel = await permanentlyDeleteAccount({
    kind: "member", id: orphan.id, confirmEmail: "orphan-lead@example.test", reason: "بقيةُ حذفٍ سابق", force: true, ...F });
  chk("ويُمحى نهائياً فيتحرّر البريد", orphanDel.ok &&
      (await prisma.member.findUnique({ where: { email: "orphan-lead@example.test" } })) === null &&
      (await prisma.invite.findUnique({ where: { id: orphanInvite.id } })) === null);

  // ٩ — تعارض المقاعد يحمل ما يُفرّق المكرّر عن القائد العامل.
  //
  //      كان يُعيد أسماءً وبُرُداً فقط، فيرى المؤسس أن المقعد مشغولٌ
  //      باثنين ولا يعرف أيُّهما الزائد — وحذفُ الخطأ منهما يُخرج قائداً
  //      عاملاً من المنصة. فصار يحمل: متى أُنشئ، وهل استُعمل قطّ، وهل
  //      له سجلُّ ترشّحٍ معتمَد.
  const dupDept = await prisma.department.findFirstOrThrow({ where: { name: "التسويق" } });
  const existingLeads = await prisma.user.count({
    where: { role: "department_admin", departmentId: dupDept.id, isActive: true },
  });

  // مكرّرٌ لم يُستعمل قطّ ولا سجلّ ترشّح له
  const ghostLead = await prisma.user.create({
    data: { fullName: "قائد مكرّر لم يُستعمل", email: "dup-unused@example.test",
            passwordHash: "x", role: "department_admin", departmentId: dupDept.id,
            isActive: true },
  });
  // وقائدٌ عاملٌ: غيّر كلمته وأكمل سجلّه
  const realLead = await prisma.user.create({
    data: { fullName: "قائد عامل", email: "dup-real@example.test",
            passwordHash: "x", role: "department_admin", departmentId: dupDept.id,
            isActive: true, passwordChangedAt: new Date(), profileCompletedAt: new Date() },
  });

  const conflicts = await seatConflicts();
  const seat = conflicts.find(
    (c) => c.role === "department_admin" && c.departmentName === dupDept.name
  );
  chk("التعارض يُرصَد", !!seat, seat ? `${seat.holders.length} شاغلين` : "لم يُرصَد");

  if (seat) {
    const ghost = seat.holders.find((h) => h.id === ghostLead.id);
    const real = seat.holders.find((h) => h.id === realLead.id);
    chk("وكلُّ شاغلٍ له معرّفٌ يُحذَف به", !!ghost?.id && !!real?.id);
    chk("**والمكرّر يُوسَم: لم يُستعمل قطّ**", ghost?.everUsed === false);
    chk("والعامل يُوسَم: استُعمل", real?.everUsed === true);
    chk("**ومن لا سجلّ ترشّح له يُقال فيه ذلك**", ghost?.approvalStatus === null);
    chk("وتاريخ الإنشاء محمول", ghost?.createdAt instanceof Date);
  }

  // والمؤسس يمحو المكرّر — بإقرارٍ مباشر لأنه نشط
  const purgeDup = await permanentlyDeleteAccount({
    kind: "user", id: ghostLead.id, confirmEmail: "dup-unused@example.test",
    reason: "حساب قيادي مكرّر لم يُستعمل قطّ", force: true, ...F });
  chk("ويُمحى المكرّر", purgeDup.ok, purgeDup.ok ? "" : (purgeDup as { reason: string }).reason);

  await prisma.user.deleteMany({ where: { id: realLead.id } });
  const after = await prisma.user.count({
    where: { role: "department_admin", departmentId: dupDept.id, isActive: true },
  });
  chk("وعاد المقعد كما كان", after === existingLeads, `${existingLeads} → ${after}`);

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
