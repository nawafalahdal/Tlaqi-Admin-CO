import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendWelcomeEmail } from "@/lib/email";
import { accountRoleLabel } from "@/lib/testTracks";
import { syncAdminAccountRow, syncMemberLifecycleRow } from "@/lib/workflow";
import { SOCIAL_LINKS, appBaseUrl } from "@/lib/emailBrand";

/** الوسم الرسمي. يُضبط من البيئة ليُغيَّر دون نشر جديد. */
export const BRAND_HASHTAG = process.env.BRAND_HASHTAG || "#تلاقي";

/** من يملك طلب إعادة الترحيب: صاحب الحساب نفسه لا غير.
 *
 *  الزرّ موجود لمن لم تصله الرسالة، لا ليُرسلها أحدٌ لأحد. ولهذا لا
 *  يأخذ معرّفاً من الواجهة أصلاً — يقرأ صاحب الجلسة من الجلسة. */
export type WelcomeSubject =
  | { kind: "user"; id: string }
  | { kind: "member"; id: string };

/** يُرسل رسالة الانضمام ويُثبت وصولها في القاعدة والشيت.
 *
 *  رسالة واحدة تقوم مقام ثلاث: تُعلن الاعتماد، وتُرحّب، وتحمل عدّة
 *  المشاركة. كانت ثلاثاً تصل متتابعة في دقائق — تُقرأ أولاها ويُهمل
 *  الباقي، وتُستهلك حصّة الإرسال ثلاث مرات في خبرٍ واحد.
 *
 *  ولا يُرسل شيء لمن أُغلقت تجربته: `noFurtherEmail` حدٌّ نهائي، واحترامه
 *  جزء من الوداع لا استثناء عليه.
 */
export async function sendWelcomePack(
  subject: WelcomeSubject,
  occasion: "approved" | "resend" = "resend"
): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  const portalUrl = `${appBaseUrl()}/${subject.kind === "member" ? "member" : "admin"}`;

  if (subject.kind === "user") {
    const user = await prisma.user.findUnique({
      where: { id: subject.id },
      include: { department: true },
    });
    if (!user) return { ok: false, reason: "الحساب غير موجود" };
    if (!user.isActive) return { ok: false, reason: "الحساب غير نشط" };

    const roleLabel = accountRoleLabel(user.role);
    const sent = await sendWelcomeEmail({
      to: user.email,
      fullName: user.fullName,
      roleLabel,
      jobTitle: user.jobTitle,
      specialization: user.specialization,
      section: user.section,
      departmentName: user.department?.name ?? null,
      portalUrl,
      joinedAt: user.createdAt,
      handles: SOCIAL_LINKS,
      hashtag: BRAND_HASHTAG,
      occasion,
    });
    if (sent.skipped) return { ok: false, reason: "تعذّر إرسال البريد الآن" };

    const at = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { welcomeEmailSentAt: at, welcomeEmailCount: { increment: 1 } },
    });
    await appendMemberEvent({
      fullName: user.fullName,
      email: user.email,
      event: "وصول بطاقة الانضمام",
      details: "✓ وصلت بطاقة الانضمام",
      roleOrDepartment: user.department?.name ?? roleLabel,
      at,
    });
    // الصفّ الثابت يُحدَّث فوراً: السجل الحي يُثبت الحدث، والصفّ يُظهر
    // الحالة. ومن يفتح الشيت يقرأ الحالة قبل أن يبحث في السجل.
    await syncAdminAccountRow(user.id);

    return { ok: true, to: user.email };
  }

  const member = await prisma.member.findUnique({
    where: { id: subject.id },
    include: { department: true, invite: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  // التجربة المُغلقة لا تُفتح ببريد: الوداع وعدٌ بألّا نراسله بعده
  if (member.noFurtherEmail) return { ok: false, reason: "انتهت تجربة هذا العضو" };
  if (!member.isActive) return { ok: false, reason: "الحساب غير نشط" };

  const roleLabel = accountRoleLabel(member.invite.targetRole);
  const sent = await sendWelcomeEmail({
    to: member.email,
    fullName: member.fullName,
    roleLabel,
    jobTitle: member.jobTitle,
    specialization: member.specialization,
    section: member.section,
    departmentName: member.department?.name ?? null,
    portalUrl,
    joinedAt: member.decidedAt ?? member.joinDate,
    handles: SOCIAL_LINKS,
    hashtag: BRAND_HASHTAG,
    occasion,
  });
  if (sent.skipped) return { ok: false, reason: "تعذّر إرسال البريد الآن" };

  const at = new Date();
  await prisma.member.update({
    where: { id: member.id },
    data: { welcomeEmailSentAt: at, welcomeEmailCount: { increment: 1 } },
  });
  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "وصول بطاقة الانضمام",
    details: "✓ وصلت بطاقة الانضمام",
    roleOrDepartment: member.department?.name ?? roleLabel,
    at,
  });
  await syncMemberLifecycleRow(member.id);

  return { ok: true, to: member.email };
}
