import { prisma } from "@/lib/prisma";
import {
  raiseTicket,
  respondToTicket,
  withdrawTicket,
  canRespondToTicket,
  sweepTicketEscalation,
} from "@/lib/tickets";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

/** العطب الذي أبلغ عنه المؤسس: تذكرةٌ رفعها هو، تأخّرت فصُعِّدت حتى بلغت
 *  مرحلته، فلم يستطع إغلاقها — ووصله انهيارُ صفحة لا رسالةٌ مفهومة.
 *
 *  وهذا الاختبار يُثبت ثلاثة: أن الجمود كان حقيقياً، وأنه ارتفع بالسحب،
 *  وأن السحب لا يُنتحِل صفة الحل. */
(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });

  // ── 1) الجمود: تذكرة الفاوندر تبلغ مرحلته فلا يملك الردّ أحد
  const t = await raiseTicket({
    raisedByUserId: founder.id,
    targetDepartmentId: dept.id,
    subject: "اختبار السحب — تذكرة بلغت آخر السلسلة",
    description: "تذكرة اختبار للجمود",
  });

  // نُقدّم الزمن ثلاث مرات حتى تبلغ founder_escalation
  for (let i = 0; i < 3; i++) {
    await prisma.ticket.updateMany({
      where: { id: t.id },
      data: { stageDueAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) },
    });
    await sweepTicketEscalation();
  }
  const escalated = await prisma.ticket.findUniqueOrThrow({
    where: { id: t.id },
    include: { member: true, raisedByUser: true, targetMember: true },
  });
  chk("بلغت مرحلة الإدارة العليا", escalated.stage === "founder_escalation", escalated.stage);

  const founderSession = { user: { id: founder.id, role: "super_admin", departmentId: null } };
  const execSession = { user: { id: exec.id, role: "executive", departmentId: null } };
  chk(
    "الفاوندر لا يردّ على تذكرته — القاعدة باقية",
    canRespondToTicket(escalated, founderSession) === false
  );
  chk(
    "ولا أحدَ غيره مصرَّحٌ له في هذه المرحلة — فالجمود كان حقيقياً",
    canRespondToTicket(escalated, execSession) === false
  );

  // ── 2) السحب يرفع الجمود
  const tooShort = await withdrawTicket({ ticketId: t.id, actorUserId: founder.id, reason: "لا" });
  chk("السحب بلا سبب مرفوض", tooShort.ok === false);

  const notMine = await withdrawTicket({
    ticketId: t.id,
    actorUserId: exec.id,
    reason: "أسحب تذكرة غيري",
  });
  chk("لا يسحب أحدٌ تذكرة غيره", notMine.ok === false);
  const untouched = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
  chk("ولم يُكتب شيء على الصفّ", untouched.status !== "resolved" && untouched.withdrawnAt === null);

  const ok = await withdrawTicket({
    ticketId: t.id,
    actorUserId: founder.id,
    reason: "لم تعد هناك حاجة — عُولج الأمر خارج المنصة",
  });
  chk("صاحبها يسحبها", ok.ok === true && ok.ok && ok.changed === true);

  const withdrawn = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
  chk("أُغلقت فعلاً في القاعدة", withdrawn.status === "resolved");
  chk("وختم السحب مسجَّل", !!withdrawn.withdrawnAt);
  chk("والفاعل منسوب", withdrawn.resolvedByUserId === founder.id);
  chk("والسبب محفوظ", (withdrawn.resolutionNote ?? "").includes("سحبها صاحبها"));

  // ── 3) السحب لا يُنتحِل صفة الحل، ولا يُكرَّر
  const again = await withdrawTicket({
    ticketId: t.id,
    actorUserId: founder.id,
    reason: "سحب ثانٍ",
  });
  chk("السحب المكرّر لا يُعدّ تغييراً", again.ok === true && again.ok && again.changed === false);
  const afterDouble = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
  chk(
    "ختم السحب الأصلي لم يُستبدل",
    afterDouble.withdrawnAt!.getTime() === withdrawn.withdrawnAt!.getTime()
  );

  // الكنس لا يُقدّم مرحلتها ولا يُعيد فتحها
  await prisma.ticket.updateMany({
    where: { id: t.id },
    data: { stageDueAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) },
  });
  await sweepTicketEscalation();
  const afterSweep = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
  chk("المسحوبة لا تعود مفتوحة بعد الكنس", afterSweep.status === "resolved");
  chk("ولا تُقدَّم مرحلتها", afterSweep.stage === "founder_escalation");

  // ── 4) القاعدة الأصلية لم تُكسَر: الردّ الحقيقي ما زال ممنوعاً على صاحبها
  const t2 = await raiseTicket({
    raisedByUserId: founder.id,
    targetDepartmentId: dept.id,
    subject: "اختبار السحب — القاعدة باقية",
    description: "تذكرة اختبار",
  });
  const fresh = await prisma.ticket.findUniqueOrThrow({
    where: { id: t2.id },
    include: { member: true, raisedByUser: true, targetMember: true },
  });
  chk(
    "صاحبها لا يُغلقها إغلاق حلٍّ في أي مرحلة",
    canRespondToTicket(fresh, founderSession) === false
  );
  const w2 = await withdrawTicket({
    ticketId: t2.id,
    actorUserId: founder.id,
    reason: "سحبٌ مبكّر قبل أي تصعيد",
  });
  chk("والسحب متاح له قبل التصعيد أيضاً", w2.ok === true);
  const w2row = await prisma.ticket.findUniqueOrThrow({ where: { id: t2.id } });
  chk("ولا يُسجَّل حلاً بل سحباً", !!w2row.withdrawnAt);

  // ── 5) الحلّ الحقيقي من صاحب المرحلة ما زال يعمل ولا يُوسَم سحباً
  const t3 = await raiseTicket({
    raisedByUserId: founder.id,
    targetDepartmentId: dept.id,
    subject: "اختبار السحب — الحل الحقيقي",
    description: "تذكرة اختبار",
  });
  const r = await respondToTicket({
    ticketId: t3.id,
    status: "resolved",
    resolutionNote: "أجاب القسم",
    actorUserId: exec.id,
  });
  chk("الحلّ من غير صاحبها يمرّ", r.ok === true);
  const solved = await prisma.ticket.findUniqueOrThrow({ where: { id: t3.id } });
  chk("ولا يُوسَم سحباً", solved.withdrawnAt === null);

  await prisma.ticket.deleteMany({ where: { id: { in: [t.id, t2.id, t3.id] } } });

  console.log(log.join("\n"));
  console.log("\n" + (log.some((l) => l.startsWith("✗")) ? "FAILURES PRESENT" : "ALL PASS"));
})();
