import { prisma } from "@/lib/prisma";
import { WELCOME_MAX_SENDS } from "@/lib/welcomeResend";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendWelcomeEmail } from "@/lib/email";
import { accountRoleLabel } from "@/lib/testTracks";
import { departmentBrand } from "@/lib/departmentBrand";
import { syncAdminAccountRow, syncMemberLifecycleRow } from "@/lib/workflow";
import { SOCIAL_LINKS, appBaseUrl } from "@/lib/emailBrand";
import { bannerUrl, shareCardUrl } from "@/lib/bannerToken";
import { reasonFor, type SendOutcome } from "@/lib/emailOutcome";

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
/** هل وصلت بطاقتُه فعلاً — ولو لم يُسجَّل ذلك في حقله؟
 *
 *  **السبب واقعةٌ في المنصة:** الفريق كلُّه وصلته بطاقاتُه، لكن حقل
 *  `welcomeEmailSentAt` لم يكن يُكتب في كل المسارات القديمة. فبقي الزرّ
 *  معروضاً لمن وصلته — وزرٌّ يُضغَط ثم يُرفَض وعدٌ كاذب، وإن لم يُرفَض
 *  فرسالةٌ ثانية لمن قرأ الأولى.
 *
 *  فصار الجواب يُقرأ من سجلّ البريد أيضاً: صفٌّ من نوع «ترحيب» إلى
 *  بريده **أُرسل فعلاً** يعني أنها وصلت. والحالة تُفحَص: «لم تُرسل
 *  (البريد معطّل)» ليست وصولاً.
 */
export async function welcomeAlreadyDelivered(opts: {
  email: string;
  welcomeEmailSentAt: Date | null;
}): Promise<"delivered" | "not_delivered" | "unknown"> {
  if (opts.welcomeEmailSentAt) return "delivered";
  try {
    const logged = await prisma.emailLog.count({
      where: { recipient: opts.email, kind: "ترحيب", status: "أُرسلت" },
    });
    return logged > 0 ? "delivered" : "not_delivered";
  } catch {
    // **ولا يُقال «وصلت» حيث لا دليل.** كان يُعاد `true` هنا «احتياطاً
    // ألّا نُرسل ثانيةً» — فصار تعثُّرُ استعلامٍ يُغلق البابَ نهائياً
    // ويُقال لصاحبه إنها أُرسلت وهي لم تُرسَل. والجهلُ يُقال جهلاً:
    // الاستدعاءُ يُترجمه إلى «تعذّر التحقّق — أعِد المحاولة».
    return "unknown";
  }
}

/** مهلةُ الحجز — خمسُ دقائق.
 *
 *  أطولُ من أيّ نداءٍ لمزوّد البريد بكثير، وأقصرُ من أن يُحبَس أحدٌ
 *  خارج بطاقته إن ماتت لامبدا في منتصف المحاولة. */

export const WELCOME_CLAIM_TTL_MS = 5 * 60_000;

/** أقلُّ ما يفصل إعادةً عن الإرسال الذي قبلها — عشرُ دقائق */
export const WELCOME_RESEND_COOLDOWN_MS = 10 * 60_000;

/** يَحجز حقَّ الإرسال مرّةً واحدة — في القاعدة لا في الذاكرة.
 *
 *  **المرّة الواحدة لا تُفرَض بفحصٍ قبل الإرسال.** الفحص ثم الإرسال
 *  يمرّ منه متسابقان: نقرأ «لم تُرسَل» مرّتين فتُرسَل مرّتان — وهذا
 *  وقع فعلاً حين ضُغط زرٌّ بطيء ضغطتين. فالشرط يُكتب في `where`:
 *  من كتب أولاً حجز الحقّ ومن تأخّر وجد `count === 0`.
 *
 *  **والحجزُ في عمودٍ غيرِ عمودِ القبول — وهذا إصلاحُ الحادثة.** كان
 *  الحجزُ يُكتَب في `welcomeEmailSentAt` نفسِه ثم يُمسَح عند الإخفاق.
 *  وبين الكتابة والمسح نداءٌ شبكيٌّ إلى مزوّد البريد. فإن انقطع
 *  التنفيذُ هناك بقي ختمُ القبول مكتوباً ولم تُرسَل رسالة — فيقول
 *  الشيتُ «✓ وصلت بطاقة الانضمام»، ويُردّ زرُّ الإرسال بـ«أُرسلت من
 *  قبل» إلى الأبد، ولا أثرَ يُفسّر شيئاً. وهي الأعراضُ الثلاثة
 *  المُبلَّغ عنها.
 *
 *  **وللحجز مهلة.** حجزٌ بلا مهلةٍ يُبدِّل قفلاً أبدياً بقفلٍ أبديٍّ
 *  آخر: لو انقطع التنفيذُ بعد الحجز لبقي الصفُّ محجوزاً إلى الأبد. فما
 *  مضى عليه أكثرُ من `WELCOME_CLAIM_TTL_MS` يُعَدّ منقطعاً ويُدَّعى من
 *  جديد — والشرطُ كلُّه في `where` فلا يُقرأ ثم يُقرَّر.
 */
async function claimWelcomeSend(
  subject: WelcomeSubject,
  at: Date,
  /** بريدُه — يُفحَص به سجلُّ البريد لمن لم يُكتب حقلُه */
  email?: string,
  /** إعادةٌ بيد من يملكها (`canResendWelcome`) — لا تقيّدها المرّة الواحدة */
  repeat = false
): Promise<{ claimed: true } | { claimed: false; reason: string }> {
  if (repeat) {
    // الإعادةُ لا تُسأل «أُرسلت من قبل؟» — هي إعادةٌ لِما أُرسل. ويبقى
    // الحجزُ نفسه يمنع ضغطتين متسابقتين، وتُفصَل الإعادةُ عن سابقتها
    // بمهلةٍ فلا تُغرَق صناديقُ الناس بنقراتٍ متتالية.
    const cooldown = new Date(at.getTime() - WELCOME_RESEND_COOLDOWN_MS);
    const where = {
      id: subject.id,
      // السقفُ في الشرط نفسه — انظر `WELCOME_MAX_SENDS`
      welcomeEmailCount: { lt: WELCOME_MAX_SENDS },
      AND: [
        { OR: [{ welcomeEmailSentAt: null }, { welcomeEmailSentAt: { lt: cooldown } }] },
        { OR: [{ welcomeClaimedAt: null }, { welcomeClaimedAt: { lt: new Date(at.getTime() - WELCOME_CLAIM_TTL_MS) } }] },
      ],
    };
    const data = { welcomeClaimedAt: at };
    const written =
      subject.kind === "user"
        ? await prisma.user.updateMany({ where, data })
        : await prisma.member.updateMany({ where, data });
    if (written.count > 0) return { claimed: true };
    const row =
      subject.kind === "user"
        ? await prisma.user.findUnique({ where: { id: subject.id }, select: { welcomeEmailCount: true } })
        : await prisma.member.findUnique({ where: { id: subject.id }, select: { welcomeEmailCount: true } });
    if ((row?.welcomeEmailCount ?? 0) >= WELCOME_MAX_SENDS) {
      return {
        claimed: false,
        reason: `بلغت بطاقاتُ هذا الشخص الحدَّ الأقصى (${WELCOME_MAX_SENDS} مرات) — لا تُعاد بعده`,
      };
    }
    return {
      claimed: false,
      reason: "أُرسلت البطاقة قبل دقائق أو تُرسَل الآن — انتظر عشر دقائق ثم أعِدها إن لزم",
    };
  }
  if (email) {
    const delivered = await welcomeAlreadyDelivered({ email, welcomeEmailSentAt: null });
    if (delivered === "delivered") return { claimed: false, reason: ALREADY_SENT };
    if (delivered === "unknown") {
      // تعذّرت قراءةُ السجلّ: لا يُقال «أُرسلت من قبل» — ذلك ادّعاءٌ بلا
      // دليل ويُغلق البابَ نهائياً. يُقال «تعذّر التحقّق» وتُعاد المحاولة.
      return {
        claimed: false,
        reason: "تعذّر التحقّقُ من سجلّ البريد الآن — أعِد المحاولة بعد قليل",
      };
    }
  }

  const stale = new Date(at.getTime() - WELCOME_CLAIM_TTL_MS);
  const where = {
    id: subject.id,
    welcomeEmailSentAt: null,
    // حجزٌ حرٌّ أو حجزٌ انقضت مهلتُه
    OR: [{ welcomeClaimedAt: null }, { welcomeClaimedAt: { lt: stale } }],
  };
  const data = { welcomeClaimedAt: at };
  const written =
    subject.kind === "user"
      ? await prisma.user.updateMany({ where, data })
      : await prisma.member.updateMany({ where, data });

  if (written.count > 0) return { claimed: true };
  // لم يُحجَز: إمّا أن القبولَ مختومٌ سلفاً أو أن محاولةً جاريةً لم تَنقضِ
  const row =
    subject.kind === "user"
      ? await prisma.user.findUnique({
          where: { id: subject.id },
          select: { welcomeEmailSentAt: true },
        })
      : await prisma.member.findUnique({
          where: { id: subject.id },
          select: { welcomeEmailSentAt: true },
        });
  return {
    claimed: false,
    reason: row?.welcomeEmailSentAt
      ? ALREADY_SENT
      : "محاولةُ إرسالٍ جاريةٌ الآن — انتظر دقيقةً ثم أعِد المحاولة",
  };
}

/** يُختَم القبولُ بعد أن يَقبل المزوّدُ فعلاً — ويُفَكّ الحجزُ معه.
 *
 *  وهذا هو الموضعُ الوحيد الذي يُكتَب فيه `welcomeEmailSentAt`. فما
 *  يُقرأ في الشيت وفي الواجهة لا يَسبق الواقع. */
async function stampWelcomeAccepted(subject: WelcomeSubject, at: Date) {
  const where = { id: subject.id } as const;
  const data = { welcomeEmailSentAt: at, welcomeClaimedAt: null };
  if (subject.kind === "user") await prisma.user.updateMany({ where, data });
  else await prisma.member.updateMany({ where, data });
}

/** يُفَكّ الحجز إن لم تَقبل الرسالةُ — فلا يُحرَم صاحبها من بطاقته
 *  بإخفاقٍ في البريد. والشرط على الوقت نفسه: لا يُفَكّ حجزُ محاولةٍ
 *  أخرى جارية. */
async function releaseWelcomeClaim(subject: WelcomeSubject, at: Date) {
  const where = { id: subject.id, welcomeClaimedAt: at } as const;
  const data = { welcomeClaimedAt: null };
  if (subject.kind === "user") await prisma.user.updateMany({ where, data });
  else await prisma.member.updateMany({ where, data });
}

const ALREADY_SENT =
  "بطاقة الانضمام تُرسل مرّةً واحدة وقد أُرسلت — وانتهت بها صلاحية الإرسال لهذا الشخص.";

export async function sendWelcomePack(
  subject: WelcomeSubject,
  occasion: "approved" | "resend" = "resend",
  /** `true` لإعادةٍ بيد من يملكها — انظر `claimWelcomeSend` */
  repeat = false
): Promise<
  | { ok: true; to: string; providerId?: string | null }
  | { ok: false; reason: string; outcome?: SendOutcome }
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

    // الحجز قبل الإرسال — وما بعده إمّا رسالةٌ وصلت أو حجزٌ يُفَكّ
    const at = new Date();
    const claim = await claimWelcomeSend(subject, at, user.email, repeat);
    if (!claim.claimed) return { ok: false, reason: claim.reason };

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
      cardUrl: shareCardUrl("welcome", { kind: "user", id: user.id }, appBaseUrl()),
      gender: user.gender,
      accountRole: user.role,
      portalUrl,
      joinedAt: user.createdAt,
      handles: SOCIAL_LINKS,
      hashtag: BRAND_HASHTAG,
      occasion,
    });
    if (sent.skipped) {
      // الحجزُ يُفَكّ فيُعاد الزرُّ قابلاً للضغط — ولا تُحرَم بطاقةٌ
      // بإخفاقِ بريد
      await releaseWelcomeClaim(subject, at);
      // والسببُ يُقال بعينه: من يَقرأ «رفضها المزوّد — النطاق غير
      // موثَّق» يَعرف أين يَذهب، ومن يَقرأ «تعذّر» لا يَعرف شيئاً
      return { ok: false, reason: reasonFor(sent.outcome), outcome: sent.outcome };
    }

    // الختمُ بعد القبول لا قبله — انظر `stampWelcomeAccepted`
    await stampWelcomeAccepted(subject, at);
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

    return {
      ok: true,
      to: user.email,
      providerId: sent.outcome.state === "accepted" ? sent.outcome.providerId : null,
    };
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
  const claim = await claimWelcomeSend(subject, at, member.email, repeat);
  if (!claim.claimed) return { ok: false, reason: claim.reason };

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
    cardUrl: shareCardUrl("welcome", { kind: "member", id: member.id }, appBaseUrl()),
    gender: member.gender,
    accountRole: member.invite.targetRole,
    portalUrl,
    joinedAt: member.decidedAt ?? member.joinDate,
    handles: SOCIAL_LINKS,
    hashtag: BRAND_HASHTAG,
    occasion,
  });
  if (sent.skipped) {
    await releaseWelcomeClaim(subject, at);
    return { ok: false, reason: reasonFor(sent.outcome), outcome: sent.outcome };
  }

  await stampWelcomeAccepted(subject, at);
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
