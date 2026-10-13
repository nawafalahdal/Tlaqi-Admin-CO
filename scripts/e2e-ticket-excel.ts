import { prisma } from "@/lib/prisma";
import { raiseTicket, respondToTicket, sweepTicketEscalation, TICKET_INCLUDE } from "@/lib/tickets";

/** العمود «متأخرة؟» في الإكسل — يُقاس لا يُستنتَج.
 *
 *  هذه هي الحالة التي أبلغت عنها: تذكرةٌ أُغلقت في موعدها ثم تبدّلت
 *  مرحلتها، فقُرئت متأخّرة. فتُختبَر الحسبة نفسها قبل وبعد مسّ المرحلة. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

/** نفس حسبة `syncTicketSheetRow` — تُقرأ من مصدرٍ واحد لا تُكرَّر */
function lateness(t: {
  status: string;
  stage: string;
  resolvedAt: Date | null;
  stageDueAt: Date;
  firstDueAt: Date | null;
}) {
  const resolved = t.status === "resolved";
  const baseline = t.firstDueAt;
  const isLate = resolved
    ? baseline
      ? (t.resolvedAt ?? new Date()) > baseline
      : t.stage !== "department"
    : new Date() > (baseline ?? t.stageDueAt);
  return { isLate, closedOnTime: resolved ? !isLate : null };
}

(async () => {
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const member = await prisma.member.findFirstOrThrow({ where: { departmentId: dept.id, isActive: true } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive" } });

  const t = await raiseTicket({
    memberId: member.id,
    targetDepartmentId: dept.id,
    subject: "اختبار عمود التأخّر",
    description: "تذكرة اختبار",
  });
  chk("الموعد الأصلي سُجِّل عند الرفع", t.firstDueAt !== null);

  // أُغلقت في موعدها
  const r = await respondToTicket({ ticketId: t.id, status: "resolved", resolutionNote: "حُلّت", actorUserId: exec.id });
  chk("أُغلقت", r.ok);
  let full = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, include: TICKET_INCLUDE });
  let L = lateness(full);
  chk("الإكسل: ليست متأخّرة", L.isLate === false);
  chk("الإكسل: أُغلقت بالموعد = نعم", L.closedOnTime === true);
  chk("الإكسل: من أغلقها مُسجَّل", full.resolvedByUser?.fullName === exec.fullName, full.resolvedByUser?.fullName ?? "—");

  // الآن مُسَّت المرحلة يدوياً (كما كان الكنس يفعل) — العمود لا يتبدّل
  await prisma.ticket.update({ where: { id: t.id }, data: { stage: "ceo_escalation" } });
  full = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, include: TICKET_INCLUDE });
  L = lateness(full);
  chk("مسُّ المرحلة لا يجعلها متأخّرة في الإكسل", L.isLate === false);
  chk("ولا يقلب «أُغلقت بالموعد» إلى لا", L.closedOnTime === true);

  // ومهلةٌ انقضت وهي مُغلقة ليست تأخّراً
  await prisma.ticket.update({
    where: { id: t.id },
    data: { stage: "department", stageDueAt: new Date(Date.now() - 5 * 86400_000) },
  });
  await sweepTicketEscalation();
  full = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, include: TICKET_INCLUDE });
  chk("الكنس لم يُعد فتحها", full.status === "resolved");
  L = lateness(full);
  chk("وبقيت «أُغلقت بالموعد = نعم» بعد الكنس", L.closedOnTime === true);

  // وتذكرةٌ أُغلقت فعلاً بعد موعدها تُقرأ متأخّرة
  const late = await raiseTicket({
    memberId: member.id,
    targetDepartmentId: dept.id,
    subject: "اختبار تذكرة متأخّرة",
    description: "تذكرة اختبار",
  });
  await prisma.ticket.update({
    where: { id: late.id },
    data: { firstDueAt: new Date(Date.now() - 10 * 86400_000) },
  });
  await respondToTicket({ ticketId: late.id, status: "resolved", resolutionNote: "حُلّت متأخّرة", actorUserId: exec.id });
  const lateFull = await prisma.ticket.findUniqueOrThrow({ where: { id: late.id }, include: TICKET_INCLUDE });
  const L2 = lateness(lateFull);
  chk("تذكرةٌ أُغلقت بعد موعدها تُقرأ متأخّرة", L2.isLate === true);
  chk("و«أُغلقت بالموعد = لا»", L2.closedOnTime === false);

  await prisma.ticket.deleteMany({ where: { id: { in: [t.id, late.id] } } });

  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
