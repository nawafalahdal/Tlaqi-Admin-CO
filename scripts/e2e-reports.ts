import { prisma } from "@/lib/prisma";
import { raiseTicket, respondToTicket, withdrawTicket } from "@/lib/tickets";
import { departmentsReport, membersReport, onTimeRate, closedOnTimeTickets } from "@/lib/reports";
import { purgeArchivedTickets } from "@/lib/retention";
import { canAward, sendAward } from "@/lib/awards";
import { loginHealthFor, loginHealthNotes, loginHealthBlocked } from "@/lib/loginHealth";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const STAMP = Date.now();

/** التقارير والتكريم وحالة الدخول.
 *
 *  والدعوى الكبرى هنا: **العدّاد يبقى بعد أن تزول التذكرة.** يُغلَق
 *  ويُعَدّ، ثم تُؤرشَف التذكرة ويُمحى صفُّها — ويبقى الرقم. ولولا ذلك
 *  لصار كلُّ تقريرٍ أسبوعاً واحداً ثم يُفرَّغ.
 */
(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });
  const dept = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: false } });

  const before = await prisma.ticketTally.findUnique({ where: { scope: `dept:${dept.id}` } });
  const onTimeBefore = before?.onTime ?? 0;
  const withdrawnBefore = before?.withdrawn ?? 0;

  // ── تذكرةٌ تُغلَق في موعدها
  const t1 = await raiseTicket({
    raisedByUserId: founder.id, targetDepartmentId: dept.id,
    subject: `تقرير — أُغلقت في موعدها ${STAMP}`, description: "تُغلَق سريعاً",
  });
  await respondToTicket({
    ticketId: t1.id, status: "resolved", resolutionNote: "حُلّت", actorUserId: exec.id,
  });
  const afterOnTime = await prisma.ticketTally.findUniqueOrThrow({
    where: { scope: `dept:${dept.id}` },
  });
  chk("**الإغلاق في الموعد يُعَدّ لحظتَه**", afterOnTime.onTime === onTimeBefore + 1,
      `${onTimeBefore} ← ${afterOnTime.onTime}`);
  chk("ويُعَدّ للمُغلِق أيضاً",
      (await prisma.ticketTally.findUnique({ where: { scope: `user:${exec.id}` } }))!.onTime >= 1);

  // ── وتذكرةٌ تُسحَب: لا تُحسب التزاماً ولا تأخّراً
  const t2 = await raiseTicket({
    raisedByUserId: founder.id, targetDepartmentId: dept.id,
    subject: `تقرير — مسحوبة ${STAMP}`, description: "تُسحَب",
  });
  await withdrawTicket({ ticketId: t2.id, actorUserId: founder.id, reason: "لم تعد لازمة" });
  const afterWithdraw = await prisma.ticketTally.findUniqueOrThrow({
    where: { scope: `dept:${dept.id}` },
  });
  chk("**والمسحوبة تُعَدّ سحباً لا تأخّراً**",
      afterWithdraw.withdrawn === withdrawnBefore + 1 && afterWithdraw.onTime === afterOnTime.onTime,
      `سحب ${afterWithdraw.withdrawn}, التزام ${afterWithdraw.onTime}`);

  // ── الأرشفة تمحو الصفّ ويبقى العدّ
  await prisma.ticket.updateMany({
    where: { id: { in: [t1.id, t2.id] } },
    data: { resolvedAt: new Date("2020-01-01"), sheetRow: 7 },
  });
  const purged = await purgeArchivedTickets();
  chk("التذاكر أُرشفت فزالت صفوفُها", purged >= 2, `${purged} صفّاً`);
  chk("**والعدّاد باقٍ بعدها — التقرير لا يُفرَّغ بالأرشفة**",
      (await prisma.ticketTally.findUniqueOrThrow({ where: { scope: `dept:${dept.id}` } })).onTime ===
        afterOnTime.onTime);

  // ── تقرير الأقسام
  const report = await departmentsReport();
  const mine = report.find((r) => r.departmentId === dept.id);
  chk("تقرير الأقسام يحمل القسم بقائده وأعضائه", Boolean(mine),
      mine ? `${mine.departmentName}: ${mine.membersCount} أعضاء` : "غائب");
  chk("ويحمل عدّاد الالتزام", (mine?.tally.onTime ?? 0) >= 1);

  chk("**ونسبةُ الالتزام `null` حين لا شيء يُقاس — لا صفرٌ يُقرأ تقصيراً**",
      onTimeRate({ onTime: 0, late: 0, withdrawn: 3 }) === null);
  chk("وتُحسَب حين يوجد ما يُقاس", onTimeRate({ onTime: 3, late: 1, withdrawn: 0 }) === 75);

  // ── تقرير الأعضاء محصورٌ بقسمه
  const members = await membersReport(dept.id);
  chk("تقرير الأعضاء يُجلَب لقسمٍ بعينه", Array.isArray(members), `${members.length} عضواً`);
  const other = await prisma.department.findFirst({
    where: { leadershipOnly: false, id: { not: dept.id } },
  });
  if (other) {
    const otherMembers = await membersReport(other.id);
    const ids = new Set(members.map((m) => m.memberId));
    chk("**ولا يتسرّب إليه عضوٌ من قسمٍ آخر — الحرس في الاستعلام**",
        otherMembers.every((m) => !ids.has(m.memberId)));
  }

  const onTimeList = await closedOnTimeTickets(20);
  chk("قائمة «أُغلقت في موعدها» تُبنى", Array.isArray(onTimeList), `${onTimeList.length} تذكرة`);
  chk("ولا تحمل إلا ما أُغلق في موعده", onTimeList.every((t) => t.onTime === true));

  // ── التكريم: للمؤسس والتنفيذي وحدهما
  chk("التكريم للمؤسس", canAward("super_admin"));
  chk("وللتنفيذي", canAward("executive"));
  chk("**ولا يملكه قائد القسم ولا العضو**",
      !canAward("department_admin") && !canAward("member") && !canAward("operations_officer"));
  const denied = await sendAward({
    target: { kind: "user", id: exec.id }, achievement: "إنجازٌ ما",
    actorRole: "department_admin", actorName: "قائد",
  });
  chk("ويُفرَض في الخادم لا بإخفاء زرّ", denied.ok === false,
      denied.ok === false ? denied.reason : "مرّ!");
  const noReason = await sendAward({
    target: { kind: "user", id: exec.id }, achievement: "حسن",
    actorRole: "super_admin", actorName: "المؤسس",
  });
  chk("**وتكريمٌ بلا إنجازٍ مكتوب يُرفَض**", noReason.ok === false,
      noReason.ok === false ? noReason.reason : "مرّ!");

  // ── حالة الدخول
  const health = await loginHealthFor([
    { email: exec.email, mustChangePassword: true, totpEnabled: false, neverSignedIn: false },
  ]);
  const h = health.get(exec.email.toLowerCase())!;
  chk("حالةُ الدخول تُقرأ دفعةً واحدة", Boolean(h));
  chk("**وكلمةُ المرور المؤقتة تُقال مشكلةَ دخول**", loginHealthBlocked(h) === true);
  chk("وتُكتَب جملةً تُقرأ لا رمزاً",
      loginHealthNotes(h).some((n) => n.includes("المؤقتة")), loginHealthNotes(h).join(" | "));
  chk("**وعدمُ تفعيل تطبيق المصادقة وحده ليس عُطلاً — رمزُ البريد عاملٌ كامل**",
      loginHealthBlocked({
        lockedUntil: null, failCount: 0, mustChangePassword: false,
        totpEnabled: false, neverSignedIn: false,
      }) === false);

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
