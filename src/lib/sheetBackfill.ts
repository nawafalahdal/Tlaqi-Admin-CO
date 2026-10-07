import { prisma } from "@/lib/prisma";
import { appendMemberEvent, appendTestResult } from "@/lib/googleSheets";
import { syncMemberLifecycleRow, syncAdminAccountRow } from "@/lib/workflow";
import { syncTicketSheetRow, TICKET_INCLUDE } from "@/lib/tickets";
import { ROLE_LABELS } from "@/lib/testTracks";

/** تعبئة رجعية للشيت بما في قاعدة البيانات أصلاً.
 *
 *  الشيت يُسجّل الأحداث لحظة وقوعها، فما وُجد قبل ربطه — أو أُنشئ بسكربت
 *  التهيئة مباشرة في القاعدة — لم يصله شيء. هذه الدالة تمر على كل البيانات
 *  القائمة وتكتبها مرة واحدة.
 *
 *  آمنة للتكرار: تبويبا "التذاكر" و"دورة الحياة" يعتمدان صفاً ثابتاً لكل
 *  سجل (sheetRow)، فإعادة التشغيل تُحدِّث الصف نفسه لا تُضاعفه. أما
 *  "نتائج الاختبارات" و"السجل الحي" فهما تبويبا إضافة، ولذلك يتخطّاهما
 *  التشغيل الثاني إلا بطلب صريح. */
export async function backfillSheets(opts: { includeAppendOnlyTabs: boolean }) {
  const counts = { lifecycle: 0, adminAccounts: 0, tickets: 0, testResults: 0, events: 0 };

  // 1) دورة حياة الأعضاء — صف ثابت لكل عضو، معتمداً كان أو ما زال مرشّحاً.
  //    كان الشرط هنا decidedAt فلا يظهر المرشّحون إطلاقاً، وهو ما جعل
  //    التبويب يبدو فارغاً بينما السجل الحي وحده يمتلئ.
  const allMembers = await prisma.member.findMany({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const m of allMembers) {
    await syncMemberLifecycleRow(m.id);
    counts.lifecycle++;
  }

  // 2) الحسابات الإدارية — صف ثابت لكل حساب، بما فيها المُنحّاة
  const allUsers = await prisma.user.findMany({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const u of allUsers) {
    await syncAdminAccountRow(u.id);
    counts.adminAccounts++;
  }

  // 3) التذاكر — صف ثابت لكل تذكرة
  const tickets = await prisma.ticket.findMany({
    include: TICKET_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  for (const t of tickets) {
    await syncTicketSheetRow(t);
    counts.tickets++;
  }

  if (!opts.includeAppendOnlyTabs) return counts;

  // 4) نتائج الاختبارات — سطر لكل محاولة
  const attempts = await prisma.testAttempt.findMany({
    include: { member: { include: { department: true, invite: true } } },
    orderBy: { attemptedAt: "asc" },
  });
  for (const a of attempts) {
    await appendTestResult({
      fullName: a.member.fullName,
      email: a.member.email,
      track:
        a.member.department?.name ??
        (ROLE_LABELS[a.member.invite.targetRole] ?? "—"),
      score: a.score,
      passed: a.passed,
      at: a.attemptedAt,
    });
    counts.testResults++;
  }

  // 5) السجل الحي — تُعاد بناء الأحداث من الطوابع الزمنية المحفوظة.
  //    لا يوجد جدول أحداث في القاعدة، فما لا طابع له لا يمكن استرجاعه؛
  //    وهذه هي الأحداث التي تحمل تاريخاً موثوقاً.
  const members = await prisma.member.findMany({
    include: { department: true, invite: true, warnings: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  type Event = { fullName: string; email: string; scope: string; event: string; details: string; at: Date };
  const events: Event[] = [];

  for (const m of members) {
    const scope = m.department?.name ?? (ROLE_LABELS[m.invite.targetRole] ?? "—");
    const base = { fullName: m.fullName, email: m.email, scope };

    events.push({ ...base, event: "إنشاء حساب مرشّح", details: "سجل سابق — أُضيف بالتعبئة الرجعية", at: m.createdAt });

    if (m.decidedAt) {
      events.push({
        ...base,
        event: m.approvalStatus === "approved" ? "اعتماد نهائي" : "رفض",
        details: m.testScore !== null ? `نتيجة الاختبار: ${m.testScore}%` : "",
        at: m.decidedAt,
      });
    }
    for (const [i, w] of m.warnings.entries()) {
      events.push({ ...base, event: `تنبيه ${i + 1}/3`, details: w.reason, at: w.createdAt });
    }
    if (m.certificateIssuedAt) {
      events.push({ ...base, event: "إصدار شهادة", details: "شهادة إتمام", at: m.certificateIssuedAt });
    }
    if (m.terminatedAt) {
      events.push({ ...base, event: "إنهاء عضوية", details: m.exitReason ?? "", at: m.terminatedAt });
    }
  }

  const removedUsers = await prisma.user.findMany({
    where: { isActive: false, removedAt: { not: null } },
    include: { department: true },
  });
  for (const u of removedUsers) {
    events.push({
      fullName: u.fullName,
      email: u.email,
      scope: u.department?.name ?? (ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role),
      event: "تنحية حساب قيادي",
      details: u.removalReason ?? "",
      at: u.removedAt!,
    });
  }

  // ترتيب زمني حتى يُقرأ السجل كقصة متسلسلة لا كدفعات متفرقة
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of events) {
    await appendMemberEvent({
      fullName: e.fullName,
      email: e.email,
      roleOrDepartment: e.scope,
      event: e.event,
      details: e.details,
      at: e.at,
    });
    counts.events++;
  }

  return counts;
}
