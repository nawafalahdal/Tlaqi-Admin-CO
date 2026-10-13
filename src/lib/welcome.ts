import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendWelcomeEmail } from "@/lib/email";
import { accountRoleLabel } from "@/lib/testTracks";
import { departmentBrand } from "@/lib/departmentBrand";
import { syncAdminAccountRow, syncMemberLifecycleRow } from "@/lib/workflow";
import { SOCIAL_LINKS, appBaseUrl } from "@/lib/emailBrand";
import { bannerUrl } from "@/lib/bannerToken";

/** الوسم الرسمي. يُضبط من البيئة ليُغيَّر دون نشر جديد. */
export const BRAND_HASHTAG = process.env.BRAND_HASHTAG || "#تلاقي";

/** قسمٌ بلا إعدادٍ رسمي: تمرّ الرسالة بالبديل المعتمد ويُسجَّل النقص.
 *
 *  البديل محايد عمداً — لا يَنسب إلى القسم مهمّةً لم تُكتب له — لكن
 *  سكوتَه عن نفسه هو العيب: تُرسَل مئةُ رسالةٍ عامّة ولا يدري أحد أن
 *  قسماً جديداً يحتاج نصّاً. فيُكتب في السجل ليُقرأ. */
async function flagUnconfiguredDepartment(
  departmentName: string | null,
  colorHex: string | null,
  fullName: string,
  email: string,
  at: Date
) {
  const brand = departmentBrand(departmentName, colorHex);
  if (brand.known) return;
  console.warn(
    `[departmentBrand] لا إعداد رسمي للقسم «${departmentName}» — استُعمل النصّ البديل`
  );
  await appendMemberEvent({
    fullName,
    email,
    event: "قسم بلا إعداد هوية",
    details: `القسم «${departmentName}» لا نصّ ترحيب رسمي له — وصلت الرسالة بالنصّ البديل`,
    roleOrDepartment: departmentName ?? "—",
    at,
  });
}

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
/** يَحجز حقَّ الإرسال مرّةً واحدة — في القاعدة لا في الذاكرة.
 *
 *  **المرّة الواحدة لا تُفرَض بفحصٍ قبل الإرسال.** الفحص ثم الإرسال
 *  يمرّ منه متسابقان: نقرأ «لم تُرسَل» مرّتين فتُرسَل مرّتان — وهذا
 *  وقع فعلاً حين ضُغط زرٌّ بطيء ضغطتين. فالشرط يُكتب في `where`:
 *  `welcomeEmailSentAt: null` جزءٌ من التحديث نفسه، فمن كتب أولاً
 *  حجز الحقّ ومن تأخّر وجد `count === 0`.
 *
 *  والحجز قبل الإرسال لا بعده. ولو فشل الإرسال بعده بقي الحقّ محجوزاً
 *  بلا رسالةٍ وصلت — فيُفَكّ الحجز صريحاً عند الفشل. */
async function claimWelcomeSend(
  subject: WelcomeSubject,
  at: Date
): Promise<boolean> {
  const where = { id: subject.id, welcomeEmailSentAt: null } as const;
  const data = { welcomeEmailSentAt: at };
  const written =
    subject.kind === "user"
      ? await prisma.user.updateMany({ where, data })
      : await prisma.member.updateMany({ where, data });
  return written.count > 0;
}

/** يُفَكّ الحجز إن لم تصل الرسالة — فلا يُحرَم صاحبها من بطاقته بإخفاقٍ
 *  في البريد. والشرط على الوقت نفسه: لا يُفَكّ حجزُ إرسالٍ آخر نجح. */
async function releaseWelcomeClaim(subject: WelcomeSubject, at: Date) {
  const where = { id: subject.id, welcomeEmailSentAt: at } as const;
  const data = { welcomeEmailSentAt: null };
  if (subject.kind === "user") await prisma.user.updateMany({ where, data });
  else await prisma.member.updateMany({ where, data });
}

const ALREADY_SENT =
  "بطاقة الانضمام تُرسل مرّةً واحدة وقد أُرسلت — وانتهت بها صلاحية الإرسال لهذا الشخص.";

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

    // الحجز قبل الإرسال — وما بعده إمّا رسالةٌ وصلت أو حجزٌ يُفَكّ
    const at = new Date();
    if (!(await claimWelcomeSend(subject, at))) return { ok: false, reason: ALREADY_SENT };

    const sent = await sendWelcomeEmail({
      to: user.email,
      fullName: user.fullName,
      roleLabel,
      jobTitle: user.jobTitle,
      specialization: user.specialization,
      section: user.section,
      departmentName: user.department?.name ?? null,
      departmentColorHex: user.department?.colorHex ?? null,
      bannerUrl: bannerUrl({ kind: "user", id: user.id }, appBaseUrl()),
      portalUrl,
      joinedAt: user.createdAt,
      handles: SOCIAL_LINKS,
      hashtag: BRAND_HASHTAG,
      occasion,
    });
    if (sent.skipped) {
      await releaseWelcomeClaim(subject, at);
      return { ok: false, reason: "تعذّر إرسال البريد الآن" };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { welcomeEmailCount: { increment: 1 } },
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
    await flagUnconfiguredDepartment(
      user.department?.name ?? null,
      user.department?.colorHex ?? null,
      user.fullName,
      user.email,
      at
    );
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

  const at = new Date();
  if (!(await claimWelcomeSend(subject, at))) return { ok: false, reason: ALREADY_SENT };

  const sent = await sendWelcomeEmail({
    to: member.email,
    fullName: member.fullName,
    roleLabel,
    jobTitle: member.jobTitle,
    specialization: member.specialization,
    section: member.section,
    departmentName: member.department?.name ?? null,
    departmentColorHex: member.department?.colorHex ?? null,
    bannerUrl: bannerUrl({ kind: "member", id: member.id }, appBaseUrl()),
    portalUrl,
    joinedAt: member.decidedAt ?? member.joinDate,
    handles: SOCIAL_LINKS,
    hashtag: BRAND_HASHTAG,
    occasion,
  });
  if (sent.skipped) {
    await releaseWelcomeClaim(subject, at);
    return { ok: false, reason: "تعذّر إرسال البريد الآن" };
  }

  await prisma.member.update({
    where: { id: member.id },
    data: { welcomeEmailCount: { increment: 1 } },
  });
  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "وصول بطاقة الانضمام",
    details: "✓ وصلت بطاقة الانضمام",
    roleOrDepartment: member.department?.name ?? roleLabel,
    at,
  });
  await flagUnconfiguredDepartment(
    member.department?.name ?? null,
    member.department?.colorHex ?? null,
    member.fullName,
    member.email,
    at
  );
  await syncMemberLifecycleRow(member.id);

  return { ok: true, to: member.email };
}
