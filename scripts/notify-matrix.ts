import { prisma } from "@/lib/prisma";
import { EMAIL_POLICY } from "@/lib/emailPolicy";
import { approverFor, resolvedRecipients, DELIBERATELY_SILENT } from "@/lib/notify";
import { TICKET_INCLUDE } from "@/lib/tickets";

/** يطبع مصفوفة «الحدث ← من يُخبَر» بالبريد الفعلي من القاعدة.
 *
 *  لا يُرسل شيئاً: يسأل نفس الدوال التي تسألها الأحداث، فيُقرأ الجواب
 *  قبل أن يصل أحداً. وهذا هو الفرق بين قاعدةٍ مكتوبة وقاعدةٍ مُتحقَّق
 *  منها — من يسأل «من يصله بريدٌ عند حلّ تذكرة رفعها الفاوندر؟» يُشغّل
 *  هذا فيرى الجواب لا يستنتجه. */
(async () => {
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const noLeadDept = await prisma.department.findFirst({
    where: { admins: { none: { role: "department_admin", isActive: true } } },
  });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const member = await prisma.member.findFirstOrThrow({ where: { departmentId: dept.id } });

  const rows: [string, string[], string][] = [];

  const a1 = await approverFor(dept.id);
  rows.push(["registration.awaiting_approval (عضو قسم له قائد)", a1.to, a1.because]);

  if (noLeadDept) {
    const a2 = await approverFor(noLeadDept.id);
    rows.push([`registration.awaiting_approval (قسم بلا قائد: ${noLeadDept.name})`, a2.to, a2.because]);
  }
  const a3 = await approverFor(null);
  rows.push(["registration.awaiting_approval (مرشّح قيادي)", a3.to, a3.because]);

  const founderTicket = {
    member: null,
    raisedByUser: { email: founder.email },
  };
  const r1 = resolvedRecipients(founderTicket);
  rows.push(["ticket.resolved (رفعها الفاوندر)", r1.to, r1.because]);

  const memberTicket = { member: { email: member.email }, raisedByUser: null };
  const r2 = resolvedRecipients(memberTicket);
  rows.push(["ticket.resolved (رفعها عضو)", r2.to, r2.because]);

  const r3 = resolvedRecipients({ ...memberTicket, stakeholderEmails: [founder.email] });
  rows.push(["ticket.resolved (+ صاحب مصلحة معيَّن)", r3.to, r3.because]);

  console.log("\n═══ مصفوفة الحدث ← المستلم ═══\n");
  for (const [ev, to, why] of rows) {
    console.log(`${ev}\n   → ${to.length ? to.join(", ") : "(لا أحد)"}\n   ∵ ${why}\n`);
  }

  // سياسة التقليل: ما يُرسَل وما يُكتم — تُطبَع من مصدرها لا تُكتَب هنا،
  // فلا تنحرف الوثيقة عن الكود
  const kept = Object.entries(EMAIL_POLICY).filter(([, v]) => v.send);
  const muted = Object.entries(EMAIL_POLICY).filter(([, v]) => !v.send);
  console.log(`═══ سياسة البريد: ${kept.length} نوعاً يُرسَل، ${muted.length} مكتومة ═══\n`);
  for (const [ev, v] of kept) console.log(`✉ ${ev}\n   ∵ ${v.why}\n`);
  console.log("─── مكتومة بالسياسة (تُقال في المنصة) ───\n");
  for (const [ev, v] of muted) console.log(`🔇 ${ev}\n   ∵ ${v.why}\n`);

  console.log("═══ أحداث يُمتنع عن البريد فيها عمداً ═══\n");
  for (const [k, why] of Object.entries(DELIBERATELY_SILENT)) {
    console.log(`✗ ${k}\n   ∵ ${why}\n`);
  }

  // تحقّق صريح: الفاوندر لا يدخل بصفته، بل بدوره في التذكرة
  const founderLeaksIn = r2.to.includes(founder.email);
  console.log(
    founderLeaksIn
      ? "✗ FAIL: الفاوندر يصله بريد تذكرةٍ لم يرفعها ولم يُعيَّن فيها"
      : "✓ الفاوندر لا يصله بريد تذكرةٍ لم يرفعها — الصفة لا تُدخِل أحداً"
  );
  console.log(
    r1.to.includes(founder.email)
      ? "✓ الفاوندر يصله إشعار حلّ تذكرةٍ رفعها بنفسه"
      : "✗ FAIL: الفاوندر لا يُخبَر بحلّ تذكرته"
  );
  console.log(
    TICKET_INCLUDE.raisedByUser ? "✓ التذكرة تحمل رافعها في استعلامها" : "✗"
  );
})();
