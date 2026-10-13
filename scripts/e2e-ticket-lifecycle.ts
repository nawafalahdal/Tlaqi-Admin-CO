import { prisma } from "@/lib/prisma";
import { raiseTicket, respondToTicket, sweepTicketEscalation } from "@/lib/tickets";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const member = await prisma.member.findFirstOrThrow({ where: { departmentId: dept.id, isActive: true } });

  for (const who of ["member", "founder"] as const) {
    const t = await raiseTicket({
      ...(who === "member" ? { memberId: member.id } : { raisedByUserId: founder.id }),
      targetDepartmentId: dept.id,
      subject: `اختبار دورة الحياة — ${who}`,
      description: "تذكرة اختبار",
    });
    log.push(`\n── تذكرة رفعها ${who} (#${t.ticketNumber})`);

    // قيد المعالجة
    const r1 = await respondToTicket({ ticketId: t.id, status: "in_progress", actorUserId: exec.id });
    chk("التحويل لقيد المعالجة", r1.ok);

    // إغلاق
    const r2 = await respondToTicket({ ticketId: t.id, status: "resolved", resolutionNote: "حُلّت", actorUserId: exec.id });
    chk("الإغلاق", r2.ok === true && r2.changed === true);
    const afterClose = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    chk("الحالة محفوظة في القاعدة", afterClose.status === "resolved");
    chk("ختم وقت الإغلاق محفوظ", !!afterClose.resolvedAt);
    chk("فاعل الإغلاق منسوب", afterClose.resolvedByUserId === exec.id, afterClose.resolvedByUserId ?? "null");
    const firstResolvedAt = afterClose.resolvedAt!.getTime();

    // إغلاق مكرر: لا رسالة ثانية ولا ختم جديد
    const r3 = await respondToTicket({ ticketId: t.id, status: "resolved", resolutionNote: "مرة ثانية", actorUserId: founder.id });
    chk("الإغلاق المكرر لا يُعدّ تغييراً", r3.ok === true && r3.changed === false);
    const afterDouble = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    chk("ختم الإغلاق الأصلي لم يُستبدل", afterDouble.resolvedAt!.getTime() === firstResolvedAt);
    chk("فاعل الإغلاق الأصلي لم يُستبدل", afterDouble.resolvedByUserId === exec.id);

    // إعادة الفتح الضمنية مرفوضة
    const r4 = await respondToTicket({ ticketId: t.id, status: "in_progress", actorUserId: exec.id });
    chk("إعادة الفتح الضمنية مرفوضة", r4.ok === false, r4.ok === false ? r4.reason : "مرّت!");
    const afterImplicit = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    chk("ما تزال مُغلقة بعد الرفض", afterImplicit.status === "resolved");

    // تمرير تاريخ الاستحقاق ثم تشغيل الكنس
    await prisma.ticket.update({
      where: { id: t.id },
      data: { stageDueAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) },
    });
    const stageBefore = afterImplicit.stage;
    await sweepTicketEscalation();
    const afterSweep = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    chk("ما تزال مُغلقة بعد الكنس", afterSweep.status === "resolved");
    chk("الكنس لم يُقدّم مرحلتها", afterSweep.stage === stageBefore, `${stageBefore} → ${afterSweep.stage}`);
    chk("لم تُجدَّد مهلتها", afterSweep.stageDueAt.getTime() < Date.now());

    // إعادة فتح صريحة مُصرَّح بها
    const r5 = await respondToTicket({ ticketId: t.id, status: "in_progress", actorUserId: founder.id, reopen: true });
    chk("إعادة الفتح الصريحة تمرّ", r5.ok);
    const afterReopen = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    chk("عدّاد إعادة الفتح سُجّل", afterReopen.reopenCount === 1, String(afterReopen.reopenCount));
    chk("ختوم الإغلاق مُحيت", afterReopen.resolvedAt === null && afterReopen.resolvedByUserId === null);
    chk("مهلة جديدة من اليوم", afterReopen.stageDueAt.getTime() > Date.now());

    await prisma.ticket.delete({ where: { id: t.id } });
  }

  console.log(log.join("\n"));
  console.log("\n" + (log.some((l) => l.startsWith("✗")) ? "FAILURES PRESENT" : "ALL PASS"));
})();
