import { prisma } from "@/lib/prisma";
import { captureEmails } from "@/lib/emailCapture";

/** **إعادةُ دعوة من لم يجتز الاختبار** (قائدُ القسم).
 *
 *  الخطأ (نوفمبر 2026): زرُّ «إعادة فتح الدعوة» في لوحة القسم كان يقلب حالةَ الدعوة إلى «مفتوحة» وحدها — حالةٌ لا
 *  يقرؤها شيءٌ منذ صارت الدعوةُ حساباً — فلا يُعاد الاختبار ولا يصل المرشّحَ شيء. ودعوتُه من جديد بالبريد نفسه
 *  تُرفض بـ«البريد مستخدم». والآن: الزرُّ يعيد فتح الاختبار فعلاً (`reopenCandidateTest`) ويصل البريد، والدعوةُ
 *  الثانية تقول لصاحبها أين يُعاد الفتح. يُشغَّل على نسخةٍ مؤقتة محلية وحدها. */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || process.env.VERCEL || process.env.VERCEL_ENV) {
  console.error("فحصٌ محليٌّ فقط");
  process.exit(1);
}
const TAG = `e2e-rif-${Date.now()}`;
const EMAIL = `${TAG}@example.test`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

(async () => {
  const W = await import("@/lib/workflow");
  const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false, committeeStatus: null } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const track = await prisma.testTrack.upsert({
    where: { scope_departmentId: { scope: "department_member", departmentId: dept.id } },
    create: { scope: "department_member", departmentId: dept.id },
    update: {},
  });
  const q = await prisma.testQuestion.create({ data: { trackId: track.id, prompt: `سؤال ${TAG}`, options: ["أ", "ب", "ج", "د"], correctIndex: 2, order: 999 } });
  const invite = (opts = {}) =>
    W.createCandidateAccount({ fullName: "مرشّح الإعادة", email: EMAIL, jobTitle: "صانع محتوى", targetRole: "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, ...opts });
  const failedList = () =>
    prisma.member.count({ where: { email: EMAIL, departmentId: dept.id, approvalStatus: "pending_review", testStatus: "failed", invite: { targetRole: "member" } } });

  try {
    const { member } = await invite();
    await W.submitTestAttempt({ memberId: member.id, answers: {} });
    const failed = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    chk("المرشّح رسب", failed.testStatus === "failed" && failed.approvalStatus === "pending_review");
    chk("ويظهر في «بحاجة إلى اجتماع شرح» بلوحة قسمه", (await failedList()) === 1);

    // ── دعوتُه من جديد بالبريد نفسه: لا تُنشأ دعوةٌ ثانية، ويُقال أين يُعاد الفتح
    let msg = "";
    try {
      await invite();
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    chk("الدعوةُ الثانية لا تُنشئ حساباً ثانياً", (await prisma.member.count({ where: { email: EMAIL } })) === 1);
    chk("ورسالتُها تدلّ على إعادة فتح الاختبار لا «البريد مستخدم»", msg.includes("لم يجتز الاختبار") && msg.includes("أعِد فتح اختباره"), msg);

    // ── الإعادة بلا اجتماع شرح تُرفض
    let refused = false;
    try {
      await W.reopenCandidateTest({ memberId: member.id, meetingHeld: false, performedByName: "قائد" });
    } catch {
      refused = true;
    }
    chk("لا تُعاد الدعوة قبل تأكيد اجتماع الشرح", refused);

    // ── الإعادة الفعلية: يُفتح الاختبار ويُرسَل البريد.
    //    بلا التقاط عمداً: وضعُ الالتقاط يتجاوز سياسةَ الكتمان (للمعاينة)، فكان هذا الفحصُ يمرّ
    //    والرسالةُ مكتومةٌ في الإنتاج — ولم تصل المرشّحَ قطّ (شكوى المؤسس، نوفمبر 2026)
    const reopened = await W.reopenCandidateTest({ memberId: member.id, meetingHeld: true, note: "شُرحت الأسئلة", performedByName: "قائدة التسويق" });
    const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    chk("أُعيد فتح الاختبار", after.testStatus === "not_started" && after.testScore === null);
    chk("وحُسبت المحاولة", after.testReopenCount === 1);
    chk("**ورسالةُ إعادة الفتح لا تكتمها السياسة**", reopened.reopenEmail.outcome.state !== "suppressed_policy", reopened.reopenEmail.outcome.state);
    const policyLogged = await prisma.emailLog.count({ where: { recipient: EMAIL, kind: "إعادة اختبار", status: "لم تُرسل (سياسة التقليل)" } });
    chk("ولا تُسجَّل «مكتومة» في سجل الرسائل", policyLogged === 0, String(policyLogged));
    chk("وخرج من «بحاجة إلى اجتماع شرح»", (await failedList()) === 0);

    // ── إعادةُ الإرسال: لمن أُعيد فتحُ اختباره ولم يدخل — مهلةٌ جديدة ورسالةٌ تصله
    chk("ويُعرَض له زرُّ «إعادة إرسال رسالة الاختبار»", W.canResendReopenedTest(after));
    await prisma.member.update({ where: { id: member.id }, data: { credentialsIssuedAt: new Date(Date.now() - 20 * 3600_000) } });
    const mails = await captureEmails(() => W.resendReopenedTest({ memberId: member.id, performedByName: "قائدة التسويق" }));
    const resent = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    chk("وإعادةُ الإرسال تصل المرشّحَ بريدَها", mails.some((m) => m.to.includes(EMAIL) && m.subject.includes("أُعيد فتح اختبار")), JSON.stringify(mails.map((m) => m.subject)));
    chk("وتبدأ مهلةُ الدخول من جديد", W.candidateHoursLeft(resent.credentialsIssuedAt!) === W.CANDIDATE_WINDOW_HOURS, String(W.candidateHoursLeft(resent.credentialsIssuedAt!)));
    chk("ولا يُمسّ الاختبارُ ولا عددُ المحاولات", resent.testStatus === "not_started" && resent.testReopenCount === 1);

    // ── وحذفُها «دعوةً غير مستخدمة» يُرفض برسالة — كان يسقط بخطأ قاعدة البيانات (محاولتُه المحفوظة)
    const F = await import("@/lib/founderActions");
    const del = await F.deleteUnusedInvite({ inviteId: member.inviteId, actorRole: "super_admin", actorName: "المؤسس" }).catch(
      (e: unknown) => ({ ok: "crash" as const, reason: (e instanceof Error ? e.message : String(e)).split("\n").filter(Boolean).slice(-2).join(" ") })
    );
    chk("**ولا تُعَدّ دعوتُه «غير مستخدمة» فتُحذف — برسالةٍ لا بسقوط**", del.ok === false && (await prisma.member.count({ where: { id: member.id } })) === 1, JSON.stringify(del));

    // ── والدعوةُ الثانية الآن تقول إنه مدعوٌّ واختبارُه مفتوح
    let msg2 = "";
    try {
      await invite();
    } catch (e) {
      msg2 = e instanceof Error ? e.message : String(e);
    }
    chk("ودعوتُه مرةً أخرى تقول إن اختباره مفتوح", msg2.includes("مدعوٌّ بالفعل"), msg2);

    // ── يجتاز في المحاولة الثانية
    const answers = Object.fromEntries((await prisma.testQuestion.findMany({ where: { trackId: track.id } })).map((x) => [x.id, x.correctIndex]));
    await W.submitTestAttempt({ memberId: member.id, answers });
    const passed = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    chk("ويجتاز الاختبارَ بعد إعادة فتحه", passed.testStatus === "passed", `${passed.testStatus} ${passed.testScore}`);
    chk("وبعد أن سلّم لا تُعاد له رسالةُ الإعادة", !W.canResendReopenedTest(passed));
  } finally {
    const m = await prisma.member.findUnique({ where: { email: EMAIL }, select: { id: true, inviteId: true } });
    if (m) {
      await prisma.request.deleteMany({ where: { linkedMemberId: m.id } }).catch(() => {});
      await prisma.testAttempt.deleteMany({ where: { memberId: m.id } }).catch(() => {});
      await prisma.member.delete({ where: { id: m.id } }).catch(() => {});
      await prisma.invite.delete({ where: { id: m.inviteId } }).catch(() => {});
    }
    await prisma.testQuestion.delete({ where: { id: q.id } }).catch(() => {});
    for (const c of checks) console.log(c);
    const failedN = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failedN}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failedN ? 1 : 0);
  }
})();
