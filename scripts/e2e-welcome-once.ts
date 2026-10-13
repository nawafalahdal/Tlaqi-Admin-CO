import { prisma } from "@/lib/prisma";
import { sendWelcomePack } from "@/lib/welcome";
import { assignMemberDepartment } from "@/lib/departments";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const STAMP = Date.now();

/** بطاقة الانضمام تُرسل **مرّةً واحدة** — وانتهت بها الصلاحية.
 *
 *  والقاعدة تُفرَض في القاعدة لا في الواجهة: الحجز شرطٌ في `where`
 *  (`welcomeEmailSentAt: null`)، فمن كتب أولاً حجز الحقّ. ولهذا يُختبَر
 *  بالكتابة لا بقراءة زرٍّ: الفحصُ قبل الإرسال يمرّ منه متسابقان.
 *
 *  والبريد معطّلٌ في هذه البيئة (لا مفتاح Resend)، فـ`send` يُرجع
 *  `skipped` — وهذا نفسه يُختبَر: **إخفاقُ الإرسال يفكّ الحجز**، فلا
 *  يُحرَم صاحبها من بطاقته بخطأ في البريد. ثم تُختبَر المرّة الواحدة
 *  بختمٍ يُكتب في القاعدة كما يكتبه إرسالٌ ناجح.
 */
(async () => {
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  const invite = await prisma.invite.create({
    data: {
      fullName: "عضو بطاقة الانضمام", email: `welcome-once-${STAMP}@example.test`,
      targetRole: "member", testTrackId: track.id, invitedById: founder.id, status: "used",
    },
  });
  const member = await prisma.member.create({
    data: {
      fullName: "عضو بطاقة الانضمام", email: `welcome-once-${STAMP}@example.test`,
      inviteId: invite.id, approvalStatus: "approved", isActive: true,
      decidedAt: new Date(),
    },
  });

  // ── ١) إخفاقُ الإرسال لا يحرق المرّة الواحدة
  const failed = await sendWelcomePack({ kind: "member", id: member.id }, "approved");
  chk("البريد معطّلٌ هنا فالإرسال يُخفق", failed.ok === false,
      failed.ok === false ? failed.reason : "نجح!");
  const afterFail = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("**وإخفاقُ الإرسال يفكّ الحجز — فلا تُحرَم بطاقته بخطأ بريد**",
      afterFail.welcomeEmailSentAt === null,
      String(afterFail.welcomeEmailSentAt));
  chk("ولا عدّادَ زاد", afterFail.welcomeEmailCount === 0, String(afterFail.welcomeEmailCount));

  // ── ٢) بطاقةٌ وصلت: الختم يُغلق الباب — على كل الطرق
  const sentAt = new Date();
  await prisma.member.update({
    where: { id: member.id },
    data: { welcomeEmailSentAt: sentAt, welcomeEmailCount: 1 },
  });

  const second = await sendWelcomePack({ kind: "member", id: member.id }, "resend");
  chk("**والثانية تُرفَض — مرّةٌ واحدة لا تُعاد**", second.ok === false,
      second.ok === false ? second.reason : "أُرسلت ثانيةً!");
  chk("والسببُ يُقال صريحاً لا «خطأٌ ما»",
      second.ok === false && second.reason.includes("مرّةً واحدة"),
      second.ok === false ? second.reason : "");
  const afterSecond = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("ولم يُلمَس ختمُ الأولى",
      afterSecond.welcomeEmailSentAt?.getTime() === sentAt.getTime());
  chk("ولا العدّاد", afterSecond.welcomeEmailCount === 1, String(afterSecond.welcomeEmailCount));

  // ── ٣) والمؤسس ليس استثناءً: حسابُه `User` والقاعدة واحدة
  const founderStamp = founder.welcomeEmailSentAt;
  await prisma.user.update({
    where: { id: founder.id },
    data: { welcomeEmailSentAt: new Date() },
  });
  const founderSecond = await sendWelcomePack({ kind: "user", id: founder.id }, "resend");
  chk("**والمؤسس ليس استثناءً — بطاقته مرّةٌ واحدة أيضاً**", founderSecond.ok === false,
      founderSecond.ok === false ? founderSecond.reason : "أُرسلت!");
  await prisma.user.update({
    where: { id: founder.id },
    data: { welcomeEmailSentAt: founderStamp },
  });

  // ── ٤) «الإدارة العليا» قسمٌ يُصنَّف فيه — لا قسمٌ محجوب
  // القسم الاستثنائي قد لا يكون في قاعدة التطوير — يُنشأ للاختبار ويُزال
  const existingSenior = await prisma.department.findFirst({ where: { leadershipOnly: true } });
  const senior =
    existingSenior ??
    (await prisma.department.create({
      data: {
        name: `إدارة عليا اختبار ${STAMP}`,
        slug: `senior-test-${STAMP}`,
        colorHex: "#1A0E1C",
        leadershipOnly: true,
      },
    }));
  {
    const freeInvite = await prisma.invite.create({
      data: {
        fullName: "عضو إلى الإدارة العليا", email: `senior-${STAMP}@example.test`,
        targetRole: "member", testTrackId: track.id, invitedById: founder.id, status: "used",
      },
    });
    const free = await prisma.member.create({
      data: {
        fullName: "عضو إلى الإدارة العليا", email: `senior-${STAMP}@example.test`,
        inviteId: freeInvite.id, approvalStatus: "approved", isActive: true,
      },
    });
    const res = await assignMemberDepartment({
      memberId: free.id, departmentId: senior.id,
      actorRole: "super_admin", actorName: "المؤسس",
    });
    chk("**يُصنَّف عضوٌ في «الإدارة العليا» — القسم الاستثنائي ليس محجوباً**", res.ok,
        res.ok ? res.departmentName : (res as { reason: string }).reason);
    chk("وصار في سجلّه",
        (await prisma.member.findUniqueOrThrow({ where: { id: free.id } })).departmentId === senior.id);
    await prisma.member.delete({ where: { id: free.id } });
    await prisma.invite.delete({ where: { id: freeInvite.id } });
  }

  // ── ٥) والمؤسس يُسجّل قسمه مرّةً — والثانية تُرفَض بشرطٍ في `where`
  const deptForFounder = senior ?? (await prisma.department.findFirst());
  const founderDeptBefore = founder.departmentId;
  if (deptForFounder) {
    await prisma.user.update({ where: { id: founder.id }, data: { departmentId: null } });
    const first = await prisma.user.updateMany({
      where: { id: founder.id, departmentId: null },
      data: { departmentId: deptForFounder.id },
    });
    chk("المؤسس بلا قسمٍ يُسجَّل", first.count === 1, String(first.count));
    const again = await prisma.user.updateMany({
      where: { id: founder.id, departmentId: null },
      data: { departmentId: deptForFounder.id },
    });
    chk("**والمصنّف لا يُعاد تصنيفه — ولو ضُغط مرّتين**", again.count === 0, String(again.count));
    await prisma.user.update({
      where: { id: founder.id },
      data: { departmentId: founderDeptBefore },
    });
  }

  // إعادة ما كان
  if (!existingSenior) {
    await prisma.testTrack.deleteMany({ where: { departmentId: senior.id } });
    await prisma.department.delete({ where: { id: senior.id } });
  }
  await prisma.member.delete({ where: { id: member.id } });
  await prisma.invite.delete({ where: { id: invite.id } });

  console.log(log.join("\n"));
  const failedAny = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failedAny ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failedAny ? 1 : 0);
})();
