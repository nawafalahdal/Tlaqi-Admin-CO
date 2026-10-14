import {
  lastWeeklyCutoff,
  archivedTicketCutoff,
  ticketIsArchived,
  visibleTicketWhere,
  purgeArchivedTickets,
  TICKET_RETENTION_DAYS,
} from "@/lib/retention";
import { prisma } from "@/lib/prisma";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const STAMP = Date.now();

/** حدُّ الأرشفة — حسابُ وقتٍ عبر منطقتين، وهو موضعُ العطوب.
 *
 *  الخادم يعمل بـUTC والموعد بتوقيت الرياض (+٣). فلو حُسب بساعة الخادم
 *  لاختفت التذاكر الثالثة عصراً بدل العاشرة مساءً. ويُختبَر بلحظاتٍ
 *  معلومةٍ لا بـ«الآن» — الاختبار الذي يعتمد على لحظة تشغيله يمرّ اليوم
 *  ويسقط غداً.
 */
(async () => {
  // السبت ١٠ مساءً بالرياض = ١٩:٠٠ UTC من السبت نفسه
  // ٢٠٢٦-١٠-١٧ سبت. نأخذ لحظاتٍ حوله.
  const satBefore = new Date("2026-10-17T18:59:00Z"); // السبت ٩:٥٩ م بالرياض
  const satAfter = new Date("2026-10-17T19:01:00Z"); // السبت ١٠:٠١ م بالرياض
  const sunday = new Date("2026-10-18T06:00:00Z");

  chk("**قبل العاشرة: الحدّ هو سبتُ الأسبوع الماضي**",
      lastWeeklyCutoff(satBefore).toISOString() === "2026-10-10T19:00:00.000Z",
      lastWeeklyCutoff(satBefore).toISOString());
  chk("**وبعدها بدقيقة: الحدّ هو الليلة**",
      lastWeeklyCutoff(satAfter).toISOString() === "2026-10-17T19:00:00.000Z",
      lastWeeklyCutoff(satAfter).toISOString());
  chk("ويبقى الليلةَ طوال الأحد",
      lastWeeklyCutoff(sunday).toISOString() === "2026-10-17T19:00:00.000Z",
      lastWeeklyCutoff(sunday).toISOString());
  chk("والساعة عاشرةُ الرياض لا عاشرةُ الخادم",
      lastWeeklyCutoff(satAfter).getUTCHours() === 19);

  chk(`وحدُّ الأرشفة أقدمُ من الموعد بـ${TICKET_RETENTION_DAYS} أيام`,
      archivedTicketCutoff(satAfter).toISOString() === "2026-10-10T19:00:00.000Z",
      archivedTicketCutoff(satAfter).toISOString());

  // ── تذكرةٌ أُغلقت الاثنين قبل أسبوعين: تختفي ليلة السبت
  const closedLongAgo = {
    status: "resolved", approvalState: null,
    resolvedAt: new Date("2026-10-05T10:00:00Z"),
  };
  chk("المغلقة قبل أسبوعين تُعرَض حتى ليلة السبت",
      ticketIsArchived(closedLongAgo, satBefore) === false);
  chk("**وتختفي في الموعد بالدقيقة**",
      ticketIsArchived(closedLongAgo, satAfter) === true);

  // ── تذكرةٌ أُغلقت أمس: تبقى أسبوعاً
  const closedYesterday = {
    status: "resolved", approvalState: null,
    resolvedAt: new Date("2026-10-16T10:00:00Z"),
  };
  chk("**والمغلقة هذا الأسبوع تبقى — الأسبوع حقُّها**",
      ticketIsArchived(closedYesterday, satAfter) === false);

  // ── المفتوحة لا تُؤرشَف مهما طالت
  chk("والمفتوحة لا تُؤرشَف مهما قدُمت",
      ticketIsArchived(
        { status: "in_progress", approvalState: null, resolvedAt: new Date("2020-01-01") },
        satAfter
      ) === false);

  // ── والحوكمة تبقى
  chk("**وتذكرةُ الحوكمة تبقى ولو أُغلقت من سنة**",
      ticketIsArchived(
        { status: "resolved", approvalState: "approved", resolvedAt: new Date("2020-01-01") },
        satAfter
      ) === false);

  // ── شرطُ القراءة يُبنى ويُقبَل في استعلامٍ حقيقي
  const where = visibleTicketWhere(satAfter);
  chk("شرطُ القراءة فيه أربعةُ أوجه", where.OR.length === 4);
  const counted = await prisma.ticket.count({ where });
  chk("ويُقبَل في القاعدة لا في الذاكرة فقط", typeof counted === "number", `${counted} تذكرة معروضة`);

  // ── الحذف لا يمسّ صفّاً لم يُكتب في الإكسل
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: false } });
  const unwritten = await prisma.ticket.create({
    data: {
      subject: `أُرشفة بلا إكسل ${STAMP}`, description: "لم تُكتب في الشيت",
      raisedByUserId: founder.id, targetDepartmentId: dept.id, stage: "department",
      status: "resolved", resolvedAt: new Date("2020-01-01"),
      stageDueAt: new Date("2020-01-02"), firstDueAt: new Date("2020-01-02"),
      sheetRow: null,
    },
  });
  const written = await prisma.ticket.create({
    data: {
      subject: `أُرشفة بإكسل ${STAMP}`, description: "كُتبت في الشيت",
      raisedByUserId: founder.id, targetDepartmentId: dept.id, stage: "department",
      status: "resolved", resolvedAt: new Date("2020-01-01"),
      stageDueAt: new Date("2020-01-02"), firstDueAt: new Date("2020-01-02"),
      sheetRow: 42,
    },
  });

  const purged = await purgeArchivedTickets(satAfter);
  chk("الكنس يمحو المؤرشَف", purged >= 1, `${purged} صفّاً`);
  chk("**ولا يمحو صفّاً لم يُكتب في الإكسل — المحو بلا أرشيف فقد**",
      (await prisma.ticket.findUnique({ where: { id: unwritten.id } })) !== null);
  chk("ويمحو الذي كُتب",
      (await prisma.ticket.findUnique({ where: { id: written.id } })) === null);

  await prisma.ticket.deleteMany({ where: { id: unwritten.id } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
