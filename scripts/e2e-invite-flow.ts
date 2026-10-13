import { prisma } from "@/lib/prisma";
import { createCandidateAccount, submitTestAttempt, approveMember } from "@/lib/workflow";
import { renderWelcomeEmail } from "@/lib/email";
import { sendWelcomePack } from "@/lib/welcome";

/** دورة الدعوة كاملةً على بياناتٍ اختباريةٍ تُنشأ وتُحذف.
 *
 *  لا يلمس سجلَّ عضوٍ حقيقي: يُنشئ مرشّحاً ببريدٍ على نطاق `.test`
 *  المحجوز، ويمرّ به على الدعوة والاختبار والاعتماد، ثم يُزيله. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const EMAIL = `e2e-invite-${Date.now()}@example.test`;

async function cleanup() {
  const m = await prisma.member.findUnique({ where: { email: EMAIL } });
  if (m) {
    await prisma.testAttempt.deleteMany({ where: { memberId: m.id } });
    await prisma.request.deleteMany({ where: { linkedMemberId: m.id } });
    await prisma.member.delete({ where: { id: m.id } });
    await prisma.invite.delete({ where: { id: m.inviteId } });
  }
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

(async () => {
  await cleanup();
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const track = await prisma.testTrack.findFirstOrThrow({
    where: { departmentId: dept.id, scope: "department_member" },
    include: { questions: true },
  });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  // ١ — الدعوة
  const { invite, member } = await createCandidateAccount({
    fullName: "مرشّح الاختبار الآلي",
    email: EMAIL,
    jobTitle: "مطوّر واجهات",
    targetRole: "member",
    departmentId: dept.id,
    testTrackId: track.id,
    invitedById: founder.id,
  });
  chk("أُنشئت الدعوة", Boolean(invite.id));
  chk("القسم مسجَّل على الحساب", member.departmentId === dept.id);
  chk("المسمّى الوظيفي مُعبَّأ من الإدارة", member.jobTitle === "مطوّر واجهات");
  const inv1 = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
  chk("محاولة تسليم الدعوة مُسجَّلة", inv1.emailAttempts === 1, String(inv1.emailAttempts));
  chk(
    "حالة الوصول مُسجَّلة بصدق",
    process.env.RESEND_API_KEY ? true : inv1.emailSentAt === null,
    inv1.emailSentAt ? "وصلت" : "لم تصل (البريد معطّل) — صحيح"
  );

  // ٢ — لا يُعتمد تلقائياً
  chk("لم يُعتمد بمجرّد الدعوة", member.decidedAt === null);
  chk("لم تصله بطاقة الانضمام بعد", member.welcomeEmailSentAt === null);

  // ٣ — الاختبار
  const answers: Record<string, number> = {};
  for (const q of track.questions) answers[q.id] = q.correctIndex;
  const res = await submitTestAttempt({ memberId: member.id, answers });
  // `submitTestAttempt` يرجع null لمن لا محاولة له — وهنا له محاولة
  chk("سُجّلت محاولة الاختبار", res !== null);
  chk("اجتاز الاختبار", res?.passed === true, `${res?.score ?? "—"}%`);
  const afterTest = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("ما يزال بلا اعتماد بعد الاختبار", afterTest.decidedAt === null);
  chk("ولم تصله بطاقة انضمام", afterTest.welcomeEmailSentAt === null);

  // ٤ — الاعتماد
  await approveMember(member.id);
  const approved = await prisma.member.findUniqueOrThrow({
    where: { id: member.id },
    include: { department: true, invite: true },
  });
  chk("اعتُمد", approved.decidedAt !== null);
  // البطاقة تُختم عند **وصولها** لا عند محاولتها. فحين يكون البريد
  // معطّلاً (كما في هذا الاختبار) يبقى الختم فارغاً عمداً — وهو ما
  // يُبقي زرّ الإرسال ظاهراً لصاحبه، أي أن الإعادة ممكنة. ولو خُتم
  // عند المحاولة لظنّ النظامُ أنها وصلت ولأُغلق بابُ الإعادة.
  if (process.env.RESEND_API_KEY) {
    chk("وصلته بطاقة الانضمام عند الاعتماد", approved.welcomeEmailSentAt !== null);
  } else {
    chk(
      "البريد معطّل: لم تُختم البطاقة واصلةً — فالإعادة تبقى ممكنة",
      approved.welcomeEmailSentAt === null
    );
    const retry = await sendWelcomePack({ kind: "member", id: approved.id }, "resend");
    chk(
      "وإعادة الإرسال تُبلّغ بالفشل صراحةً لا بالنجاح",
      retry.ok === false,
      retry.ok === false ? retry.reason : "ادّعت النجاح!"
    );
  }
  chk("المسمّى بقي كما سجّلته الإدارة", approved.jobTitle === "مطوّر واجهات");
  chk("القسم بقي كما سجّلته الإدارة", approved.departmentId === dept.id);

  const html = renderWelcomeEmail({
    fullName: approved.fullName,
    roleLabel: "عضو",
    jobTitle: approved.jobTitle,
    departmentName: approved.department!.name,
    departmentColorHex: approved.department!.colorHex,
    portalUrl: "https://www.tlaqiteam.site/member",
    joinedAt: approved.decidedAt,
  });
  chk("بطاقة الانضمام تحمل مسمّاه", html.includes("مطوّر واجهات"));
  chk("وتحمل قسمه", html.includes("التقنية"));

  await cleanup();
  const gone = await prisma.member.findUnique({ where: { email: EMAIL } });
  chk("نُظّفت بيانات الاختبار", gone === null);

  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
