import { prisma } from "@/lib/prisma";
import { EMAIL_POLICY, emailAllowed, singleRecipient } from "@/lib/emailPolicy";
import { raiseTicket, respondToTicket, escalateTicketNow, withdrawTicket } from "@/lib/tickets";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const STAMP = Date.now();
const SUPPRESSED = "لم تُرسل (سياسة التقليل)";

/** سياسة البريد المُقلَّل — تُقاس بالصفوف لا بالنيّة.
 *
 *  كلُّ إرسالٍ يُسجَّل في `EmailLog`، فعدُّ الصفوف بعد دورة حياةٍ كاملة
 *  يقول كم رسالةً كانت ستُرسَل فعلاً. والمكتوم يُسجَّل مكتوماً — فيُفرَّق
 *  بين «لم يُرسَل بالسياسة» و«لم يقع الحدث».
 */
(async () => {
  // ── ١) السياسة نفسها: ما يُرسَل وما يُكتم
  const kept = Object.entries(EMAIL_POLICY).filter(([, v]) => v.send).map(([k]) => k);
  const muted = Object.entries(EMAIL_POLICY).filter(([, v]) => !v.send).map(([k]) => k);
  chk(`أنواعٌ تُرسَل: ${kept.length}، ومكتومة: ${muted.length}`, kept.length > 0 && muted.length > 0);
  chk("ولكل نوعٍ سببٌ مكتوب لا فراغ",
      Object.values(EMAIL_POLICY).every((v) => v.why.trim().length > 10));

  chk("**رمز الدخول لا يُكتم أبداً — لا دخول بدونه**", emailAllowed("auth.login_code"));
  chk("ولا إعادة تعيين كلمة المرور", emailAllowed("auth.password_reset"));
  chk("ولا رسالة الدخول الأولى", emailAllowed("member.credentials"));
  chk("ولا بطاقة الانضمام عند الاعتماد", emailAllowed("member.welcome"));
  chk("والتصعيد مكتوم", emailAllowed("ticket.escalated") === false);
  chk("والتذكيرات مكتومة",
      !emailAllowed("ticket.reminder") && !emailAllowed("request.reminder") &&
      !emailAllowed("meeting.reminder") && !emailAllowed("window.reminder"));
  chk("ونتيجة الرسوب وإعادة الاختبار مكتومتان",
      !emailAllowed("test.failed") && !emailAllowed("test.reopened"));
  chk("ونُخزة التحقق بخطوتين مكتومة", !emailAllowed("totp.nudge"));

  // ── ٢) لا نسخةَ مجاملة
  chk("**ثلاثةُ مرشّحين يصيرون مستلماً واحداً**",
      singleRecipient(["a@x.test", "b@x.test", "c@x.test"]).length === 1);
  chk("والاختيار ثابتٌ لا عشوائي",
      singleRecipient(["a@x.test", "b@x.test"])[0] === "a@x.test");
  chk("وقائمةٌ فارغةٌ تبقى فارغة", singleRecipient([]).length === 0);
  chk("والفراغات تُطرَح", singleRecipient(["", "b@x.test"])[0] === "b@x.test");

  // ── ٣) دورة تذكرة كاملة: رسالتان لا أربع
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });

  const since = new Date();
  const t = await raiseTicket({
    raisedByUserId: founder.id,
    // توجيهٌ إلى شخصٍ بعينه: القسم في قاعدة التطوير قد يكون بلا قائد
    // نشط فلا مستلم أصلاً — والمقصود قياسُ عدد الرسائل لا غيابُها
    targetUserId: exec.id,
    subject: `سياسة البريد — دورة كاملة ${STAMP}`,
    description: "تذكرة اختبار لقياس عدد الرسائل",
  });

  await escalateTicketNow(t.id, "اختبار");
  await escalateTicketNow(t.id, "اختبار");
  await respondToTicket({ ticketId: t.id, status: "resolved", resolutionNote: "حُلّت", actorUserId: exec.id });

  const rows = await prisma.emailLog.findMany({
    where: { subject: { contains: String(STAMP) }, createdAt: { gte: since } },
  });
  const attempted = rows.filter((r) => r.status !== SUPPRESSED);
  const mutedRows = rows.filter((r) => r.status === SUPPRESSED);

  chk("**رسالتان فقط في دورة التذكرة الكاملة**", attempted.length === 2,
      `${attempted.length}: ${attempted.map((r) => r.kind).join(" + ")}`);
  chk("الأولى عند الرفع لمن وُجِّهت إليه",
      attempted.some((r) => r.kind.includes("تذكرة") || r.kind.includes("جديدة")),
      attempted.map((r) => r.kind).join(" | "));
  chk("وكلُّ رسالةٍ لمستلمٍ واحد — لا نسخة",
      attempted.every((r) => !r.recipient.includes(",") && !r.recipient.includes("،")),
      attempted.map((r) => r.recipient).join(" | "));
  chk("والتصعيدان سُجّلا مكتومين لا مفقودين", mutedRows.length >= 2,
      `${mutedRows.length} صفّاً مكتوماً`);

  // ── ٤) والسحب لا يُراسِل
  const t2 = await raiseTicket({
    raisedByUserId: founder.id,
    targetUserId: exec.id,
    subject: `سياسة البريد — سحب ${STAMP}`,
    description: "تُسحَب",
  });
  const since2 = new Date();
  await withdrawTicket({ ticketId: t2.id, actorUserId: founder.id, reason: "لم تعد لازمة" });
  const afterWithdraw = await prisma.emailLog.findMany({
    where: { subject: { contains: `سحب ${STAMP}` }, createdAt: { gte: since2 } },
  });
  chk("**السحب لا يُرسل بريداً — والمكتوم مسجَّل**",
      afterWithdraw.every((r) => r.status === SUPPRESSED),
      afterWithdraw.map((r) => `${r.kind}:${r.status}`).join(" | ") || "لا صفوف");

  // إعادة ما كان
  await prisma.ticket.deleteMany({ where: { id: { in: [t.id, t2.id] } } });
  await prisma.emailLog.deleteMany({ where: { subject: { contains: String(STAMP) } } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
