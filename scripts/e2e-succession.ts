import { prisma } from "@/lib/prisma";
import { buildOrgChart } from "@/lib/orgChart";
import { permanentlyDeleteAccount } from "@/lib/founderActions";
import { successorFor, transferResponsibilities } from "@/lib/succession";
import { requestApproval } from "@/lib/approvals";
import { raiseTicket } from "@/lib/tickets";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const STAMP = Date.now();

/** الخلافة: المنصب يبقى حين يذهب شاغلُه.
 *
 *  ويُختبَر الشيئان المختلفان:
 *  ١) **الهيكل** — لا يُنقَل لأنه يُحسَب: من عُيِّن بعده يُقرأ في موضعه
 *     بقادته وأقسامه وأعضائه بلا إجراء. يُختبَر بقراءة الهيكل قبل
 *     الحذف وبعده وعدِّ من تحته.
 *  ٢) **العمل المعلَّق** — يُنقَل لأنه مربوطٌ بصفِّه هو: دعوةٌ أرسلها،
 *     وطلبُ اعتمادٍ ينتظره، وتذكرةٌ وُجِّهت إليه. ولولا النقل لرفضت
 *     القاعدةُ حذفَ صفِّه أصلاً — وهذا هو «حدث خطأ غير متوقّع».
 */
(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: false } });

  // ── تنفيذيٌّ قديم وآخر جديد: الجديد أُنشئ بعده فالأقدم هو من يُقرأ
  //    تنفيذياً، وبزواله يرث الجديد الموضع نفسه
  const oldCeo = await prisma.user.create({
    data: {
      fullName: `تنفيذي سابق ${STAMP}`, email: `ceo-old-${STAMP}@example.test`,
      passwordHash: "x", role: "executive", isActive: true,
      // أقدمُ تنفيذيٍّ نشط هو من يُقرأ في المقعد، فيُجعَل أقدمَ الجميع
      createdAt: new Date("2020-01-01T00:00:00Z"),
    },
  });
  const newCeo = await prisma.user.create({
    data: {
      fullName: `تنفيذي جديد ${STAMP}`, email: `ceo-new-${STAMP}@example.test`,
      passwordHash: "x", role: "executive", isActive: true,
    },
  });

  // ومن يرث المقعد بعده يُحسَب من القاعدة لا يُفترَض: أقدمُ تنفيذيٍّ
  // نشطٍ سواه — وقد يكون تنفيذياً قائماً قبل هذا الاختبار
  const expectedNextCeo = await prisma.user.findFirstOrThrow({
    where: { role: "executive", isActive: true, id: { not: oldCeo.id } },
    orderBy: { createdAt: "asc" },
    select: { fullName: true },
  });

  const chartBefore = await buildOrgChart();
  const ceoBefore = chartBefore.ceo.kind === "filled" ? chartBefore.ceo.person.fullName : "(شاغر)";
  const deptsBefore = chartBefore.departments.length;
  const peopleUnderBefore = chartBefore.departments.reduce(
    (n, d) => n + (d.lead.kind === "filled" ? 1 : 0) + d.members.length,
    0
  );
  chk("التنفيذي السابق هو من يُقرأ في الهيكل", ceoBefore === oldCeo.fullName, ceoBefore);

  // ── عملٌ معلَّق باسمه: دعوةٌ أرسلها، وطلبُ اعتمادٍ ينتظره، وتذكرة
  const invite = await prisma.invite.create({
    data: {
      fullName: "مدعوٌّ بيد التنفيذي", email: `invitee-${STAMP}@example.test`,
      targetRole: "member", testTrackId: track.id, invitedById: oldCeo.id, status: "open",
    },
  });

  const ticketForApproval = await raiseTicket({
    raisedByUserId: founder.id, targetUserId: oldCeo.id,
    subject: `خطة تحتاج اعتماداً ${STAMP}`, description: "تُرفع للاعتماد",
  });
  const asked = await requestApproval({
    ticketId: ticketForApproval.id, requesterUserId: founder.id,
    kind: "marketing_plan", approverUserId: oldCeo.id,
  });
  chk("طلبُ اعتمادٍ معلَّقٌ باسم التنفيذي السابق", asked.ok,
      asked.ok ? "" : (asked as { reason: string }).reason);

  const openTicket = await raiseTicket({
    raisedByUserId: founder.id, targetUserId: oldCeo.id,
    subject: `تذكرة مفتوحة إليه ${STAMP}`, description: "تنتظر ردّه",
  });

  // ── الخَلَف: من يرث؟
  const heir = await successorFor(oldCeo);
  chk("**الخَلَفُ يُحسَب من سلسلة الصفات لا يُختار يدوياً**", heir !== null,
      heir ? `${heir.fullName} (${heir.roleLabel})` : "لا خَلَف");

  // ── الحذف: كان يسقط بخطأٍ عام بسبب قيد الدعوة
  const deleted = await permanentlyDeleteAccount({
    kind: "user", id: oldCeo.id, confirmEmail: oldCeo.email,
    reason: "التسجيل بحساب آخر", force: true,
    actorRole: "super_admin", actorId: founder.id, actorName: "المؤسس",
  });
  chk("**الحذف يمرّ — ولا يسقط بخطأٍ عام بسبب دعوةٍ أرسلها**", deleted.ok,
      deleted.ok ? (deleted.handover ?? "") : (deleted as { reason: string }).reason);
  chk("ويُقال ما انتقل لا يُخمَّن",
      deleted.ok && Boolean(deleted.handover) && deleted.handover!.includes("دعوة"),
      deleted.ok ? deleted.handover : "");

  // ── ولا شيء سقط: الدعوة قائمةٌ بمالكٍ جديد
  const inviteAfter = await prisma.invite.findUnique({
    where: { id: invite.id }, select: { invitedById: true },
  });
  chk("**الدعوة لم تُحذف — ورِثها الخَلَف**",
      inviteAfter !== null && inviteAfter.invitedById !== oldCeo.id,
      inviteAfter ? "قائمة" : "اختفت!");

  const approvalAfter = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketForApproval.id },
    select: { approverUserId: true, approvalState: true, decisions: true },
  });
  chk("**طلبُ الاعتماد لم يَعلَق بمعتمِدٍ محذوف**",
      approvalAfter.approverUserId !== null && approvalAfter.approverUserId !== oldCeo.id,
      String(approvalAfter.approverUserId));
  chk("وحالتُه لم تُمَسّ — الخلافة ليست قراراً",
      approvalAfter.approvalState === "awaiting", String(approvalAfter.approvalState));
  chk("والسجلّ يقول إن الانتقال خلافةٌ لا بتّ",
      approvalAfter.decisions.some((d) => (d.note ?? "").includes("خَلَف")));

  const ticketAfter = await prisma.ticket.findUniqueOrThrow({
    where: { id: openTicket.id }, select: { targetUserId: true },
  });
  chk("**التذكرة المفتوحة أُعيد توجيهها ولم تُفَكّ بلا وجهة**",
      ticketAfter.targetUserId !== null, String(ticketAfter.targetUserId));

  // ── والهيكل: الجديد في موضع القديم بقادته وأقسامه وأعضائه
  const chartAfter = await buildOrgChart();
  const ceoAfter = chartAfter.ceo.kind === "filled" ? chartAfter.ceo.person.fullName : "(شاغر)";
  const peopleUnderAfter = chartAfter.departments.reduce(
    (n, d) => n + (d.lead.kind === "filled" ? 1 : 0) + d.members.length,
    0
  );
  chk("**المقعد لا يبقى شاغراً: ورِثه التنفيذيُّ التالي بلا إجراء**",
      ceoAfter === expectedNextCeo.fullName, `${ceoBefore} ← ${ceoAfter}`);
  chk("**والأقسام كما هي — لم يَنقلها أحد**",
      chartAfter.departments.length === deptsBefore,
      `${deptsBefore} → ${chartAfter.departments.length}`);
  chk("**والقادة والأعضاء تحته كما كانوا**", peopleUnderAfter === peopleUnderBefore,
      `${peopleUnderBefore} → ${peopleUnderAfter}`);

  // ── قائد قسم: أعضاؤه يتبعون قسمه لا شخصه
  const lead = await prisma.user.create({
    data: {
      fullName: `قائد قسم ${STAMP}`, email: `lead-${STAMP}@example.test`,
      passwordHash: "x", role: "department_admin", departmentId: dept.id, isActive: true,
    },
  });
  const beforeLeadGone = (await buildOrgChart()).departments.find((d) => d.id === dept.id);
  const membersUnderLead = beforeLeadGone?.members.length ?? 0;
  chk("القسم يُقرأ بقائده", beforeLeadGone?.lead.kind === "filled");

  await permanentlyDeleteAccount({
    kind: "user", id: lead.id, confirmEmail: lead.email, reason: "اختبار الخلافة",
    force: true, actorRole: "super_admin", actorId: founder.id, actorName: "المؤسس",
  });
  const afterLeadGone = (await buildOrgChart()).departments.find((d) => d.id === dept.id);
  chk("**وبذهابه يُعلَن منصبُه شاغراً لا يُسنَد إلى أحد**",
      afterLeadGone?.lead.kind === "vacant", String(afterLeadGone?.lead.kind));
  chk("**وأعضاؤه باقون في قسمهم — يتبعون القسم لا الشخص**",
      (afterLeadGone?.members.length ?? 0) === membersUnderLead,
      `${membersUnderLead} → ${afterLeadGone?.members.length ?? 0}`);

  // ── ولا يُنقَل طلبٌ إلى صاحبه: الخَلَفُ لا يعتمد طلبَ نفسه
  const selfTicket = await raiseTicket({
    raisedByUserId: newCeo.id, targetUserId: founder.id,
    subject: `طلب التنفيذي الجديد ${STAMP}`, description: "رفعه الخَلَف نفسه",
  });
  await requestApproval({
    ticketId: selfTicket.id, requesterUserId: newCeo.id,
    kind: "initiative", approverUserId: founder.id,
  });
  const counts = await transferResponsibilities({
    fromUserId: founder.id, toUserId: newCeo.id, byName: "اختبار",
  });
  const selfAfter = await prisma.ticket.findUniqueOrThrow({
    where: { id: selfTicket.id }, select: { approverUserId: true },
  });
  chk("**ولا يُسلَّم طلبٌ إلى رافعه — فلا يعتمد أحدٌ نفسه**",
      selfAfter.approverUserId !== newCeo.id,
      `${selfAfter.approverUserId === founder.id ? "بقي عند المؤسس" : String(selfAfter.approverUserId)}`);
  chk("والنقل يُحصي ما نقله", typeof counts.invites === "number");

  // إعادة ما كان
  await prisma.approvalDecision.deleteMany({
    where: { ticketId: { in: [ticketForApproval.id, openTicket.id, selfTicket.id] } },
  });
  await prisma.ticket.deleteMany({
    where: { id: { in: [ticketForApproval.id, openTicket.id, selfTicket.id] } },
  });
  await prisma.invite.deleteMany({ where: { email: `invitee-${STAMP}@example.test` } });
  await prisma.user.deleteMany({ where: { id: newCeo.id } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
