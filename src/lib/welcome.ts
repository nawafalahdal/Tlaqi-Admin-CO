import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendWelcomeEmail, sendShareInvitationEmail } from "@/lib/email";
import { accountRoleLabel } from "@/lib/testTracks";
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

function suggestedPost(fullName: string, roleLabel: string) {
  return `سعيدٌ بانضمامي إلى فريق تَـــلاقِ ${roleLabel === "عضو" ? "عضواً" : `بصفة ${roleLabel}`}. نلتقي · نفكّر · نصنع. ${BRAND_HASHTAG}`.replace(
    /\s+/g,
    " "
  );
}

/** يُرسل الترحيب ثم دعوة المشاركة، ويُثبت الوصول في القاعدة والشيت.
 *
 *  الترتيب مقصود: الترحيب أولاً لأنه الرسالة الشخصية، ثم دعوة المشاركة
 *  لأنها تُبنى على خبرٍ وصل. وإن تعذّر إرسال الترحيب لم تُرسل الثانية:
 *  دعوةٌ لمشاركة خبرٍ لم يصل صاحبه بعدُ عبث.
 *
 *  ولا يُرسل شيء لمن أُغلقت تجربته: `noFurtherEmail` حدٌّ نهائي، واحترامه
 *  جزء من الوداع لا استثناء عليه.
 */
export async function sendWelcomePack(subject: WelcomeSubject): Promise<
  { ok: true; to: string } | { ok: false; reason: string }
> {
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
      event: "وصول البريد الترحيبي",
      details: `أُرسل الترحيب — المرة ${user.welcomeEmailCount + 1}`,
      roleOrDepartment: user.department?.name ?? roleLabel,
      at,
    });

    await sendShareInvitationEmail({
      to: user.email,
      fullName: user.fullName,
      roleLabel,
      handles: SOCIAL_LINKS,
      hashtag: BRAND_HASHTAG,
      suggestedPost: suggestedPost(user.fullName, roleLabel),
    });
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
    event: "وصول البريد الترحيبي",
    details: `أُرسل الترحيب — المرة ${member.welcomeEmailCount + 1}`,
    roleOrDepartment: member.department?.name ?? roleLabel,
    at,
  });

  await sendShareInvitationEmail({
    to: member.email,
    fullName: member.fullName,
    roleLabel,
    handles: SOCIAL_LINKS,
    hashtag: BRAND_HASHTAG,
    suggestedPost: suggestedPost(member.fullName, roleLabel),
  });
  return { ok: true, to: member.email };
}
