"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { raiseTicket } from "@/lib/tickets";
import { safeErrorMessage } from "@/lib/safeError";
import { appBaseUrl } from "@/lib/emailBrand";
import { canRequestWelcomeResend, resenderRoleFor, RESENDER_LABEL, WELCOME_MAX_SENDS } from "@/lib/welcomeResend";
import { canIssueCertificates, mayIssueCertificateFor } from "@/lib/recognitionDesk";
import { issueAppreciation } from "@/lib/appreciation";
import { markCertificateShared } from "@/lib/offboarding";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
/** طلبُ إعادة بطاقة الانضمام — يصل تذكرةً إلى من يعلو صاحبَها في السلسلة.
 *
 *  لا يُرسل شيئاً: يرفع تذكرةً بالمسار القائم (`raiseTicket`) وجهتُها مسؤول
 *  التشغيل بعينه، فتصله في لوحته وبريده وتتصعّد إن تأخّرت كأيّ تذكرة. وهو
 *  من يتأكّد ثم يُعيد البطاقة من صفحته أو يردّ الطلب.
 *
 *  ويرفعه اثنان: قيادةُ التسويق عن غيرها، وصاحبُ البطاقة عن نفسه («لم
 *  تصلني»). ولا يتكرّر: تذكرةٌ مفتوحةٌ بالموضوع نفسه من الرافع نفسه تكفي. */
async function raiseResendRequest(opts: {
  raiser: { memberId: string } | { userId: string };
  target: { kind: "user" | "member"; id: string };
  /** من يطلب وكيف — يُكتب في التذكرة ليعرف مسؤولُ التشغيل مصدرها */
  why: (name: string) => string;
  subject: (name: string) => string;
}): Promise<{ error: string | null; ticketNumber?: number }> {
  const t = getDictionary(await getLocale());
  const L = t.rWelcomeActions;
  const target =
    opts.target.kind === "user"
      ? await prisma.user.findUnique({
          where: { id: opts.target.id },
          select: { fullName: true, role: true, isActive: true, welcomeEmailCount: true },
        })
      : await prisma.member.findUnique({
          where: { id: opts.target.id },
          select: { fullName: true, isActive: true, welcomeEmailCount: true, noFurtherEmail: true },
        });
  if (!target || !target.isActive) return { error: L.theAccountDoesNot };
  const targetRole = "role" in target ? target.role : "member";
  // المؤسسُ لا يطلب: يُرسل بطاقته لنفسه مباشرة
  if (targetRole === "super_admin") return { error: L.theFounderSCard };
  const resenderRole = resenderRoleFor(targetRole);
  const resenderLabel = RESENDER_LABEL[resenderRole];
  if ("noFurtherEmail" in target && target.noFurtherEmail) return { error: L.thisMemberSTrial };
  if (target.welcomeEmailCount >= WELCOME_MAX_SENDS) {
    return { error: L.theResendChanceIs };
  }

  // الطلبُ يصل من يعلو صاحبَ البطاقة في السلسلة — `resenderRoleFor`
  const resender = await prisma.user.findFirst({
    where: { role: resenderRole, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!resender) return { error: fmt(L.noIsAssignedYet, t.shell.roles[resenderRole]) };

  const subject = opts.subject(target.fullName);
  const raiserWhere = "memberId" in opts.raiser ? { memberId: opts.raiser.memberId } : { raisedByUserId: opts.raiser.userId };
  const existing = await prisma.ticket.findFirst({
    where: { ...raiserWhere, targetUserId: resender.id, subject, status: { in: ["open", "in_progress"] } },
    select: { ticketNumber: true },
  });
  if (existing) return { error: fmt(L.theRequestWasAlready, existing.ticketNumber) };

  const created = await raiseTicket({
    ...("memberId" in opts.raiser ? { memberId: opts.raiser.memberId } : { raisedByUserId: opts.raiser.userId }),
    targetUserId: resender.id,
    subject,
    description:
      `${opts.why(target.fullName)} ` +
      `أُرسلت له حتى الآن ${target.welcomeEmailCount} بطاقة، ويبقى له إعادةٌ واحدة. ` +
      `تأكّد من بريده ثم أعِدها من صفحة «الترحيب والتكريم» (الإعادة لـ${resenderLabel}).`,
    linkUrl: `${appBaseUrl()}/admin/welcome-cards?q=${encodeURIComponent(target.fullName)}`,
  });
  revalidatePath("/admin/tickets");
  revalidatePath("/admin");
  return { error: null, ticketNumber: created.ticketNumber };
}

/** قيادةُ التسويق تطلب الإعادة لقائدٍ أو عضو */
export async function requestWelcomeResendAction(
  kind: "user" | "member",
  id: string
): Promise<{ error: string | null; ticketNumber?: number }> {
  const L = getDictionary(await getLocale()).rWelcomeActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  if (!(await canRequestWelcomeResend(session))) {
    return { error: L.requestingAWelcomeCard };
  }
  try {
    return await raiseResendRequest({
      raiser: { userId: session.user.id },
      target: { kind, id },
      subject: (name) => `طلب إعادة بطاقة الانضمام — ${name}`,
      why: (name) => `تطلب قيادة التسويق إعادة إرسال بطاقة الانضمام إلى ${name}.`,
    });
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** «لم تصلني» — صاحبُ البطاقة يُبلغ عن نفسه، ولا يُرسلها لنفسه.
 *
 *  لا يأخذ معرّفاً من الواجهة: البلاغُ عن صاحب الجلسة وحده. */
export async function reportMissingWelcomeAction(): Promise<{ error: string | null; ticketNumber?: number }> {
  const L = getDictionary(await getLocale()).rWelcomeActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  const isMember = session.user.role === "member";
  try {
    return await raiseResendRequest({
      raiser: isMember ? { memberId: session.user.id } : { userId: session.user.id },
      target: { kind: isMember ? "member" : "user", id: session.user.id },
      subject: (name) => `لم تصلني بطاقة الانضمام — ${name}`,
      why: (name) => `يُبلغ ${name} أن بطاقة الانضمام لم تصله.`,
    });
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** السلسلة: لا يُصدر أحدٌ إلا لمن يليه مباشرة — المؤسس للرئيس التنفيذي،
 *  والتنفيذي لمسؤول التشغيل، ومسؤول التشغيل للقادة والأعضاء. */
async function chainRefusal(role: string, memberId: string, L: ReturnType<typeof getDictionary>["rRecognitionDesk"]) {
  if (typeof memberId !== "string" || !memberId) return { refusal: L.notFound, member: null };
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { stepDownAt: true, offboardingClosedAt: true, invite: { select: { targetRole: true } } },
  });
  if (!member) return { refusal: L.notFound, member: null };
  if (!mayIssueCertificateFor(role, member.invite.targetRole)) {
    return { refusal: fmt(L.notYourChain, RESENDER_LABEL[resenderRoleFor(member.invite.targetRole)]), member: null };
  }
  return { refusal: null, member };
}

/** الشهادات من صفحة «الترحيب والتكريم» — لمن يعلو صاحبَها في السلسلة
 *  (`mayIssueCertificateFor`)، ويُفرَض هنا لا في الزرّ.
 *
 *  وكلٌّ يمرّ بمَخنَق نوعه: الختمُ مرّةً واحدة، والبريدُ يُعاد ما لم يصل،
 *  ومن أصدر ومتى ولمن يُكتب في السجل الحي. */
export async function issueAppreciationDeskAction(
  memberId: string,
  earlyReason?: string | null
): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rRecognitionDesk;
  const session = await auth();
  if (!session) return { error: L.signInFirst };
  if (!canIssueCertificates(session.user.role)) return { error: L.notAllowed };
  const { refusal } = await chainRefusal(session.user.role, memberId, L);
  if (refusal) return { error: refusal };
  const reason = typeof earlyReason === "string" ? earlyReason.trim().slice(0, 300) : null;
  try {
    const res = await issueAppreciation(memberId, { name: session.user.name ?? "—", earlyReason: reason });
    revalidatePath("/admin/welcome-cards");
    return { error: res.ok ? null : res.reason };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** شهادة الشكر والخبرة — لمن بدأ ختام تجربته وحده: من تنحّى ولم يُغلَق ختامه.
 *  وحوكمةُ الأسبوعين وحمايةُ التكرار في `markCertificateShared` نفسه. */
export async function issueFinalCertificateDeskAction(memberId: string): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rRecognitionDesk;
  const session = await auth();
  if (!session) return { error: L.signInFirst };
  if (!canIssueCertificates(session.user.role)) return { error: L.notAllowed };
  const { refusal, member } = await chainRefusal(session.user.role, memberId, L);
  if (refusal || !member) return { error: refusal ?? L.notFound };
  if (!member.stepDownAt || member.offboardingClosedAt) return { error: L.finalOnlyAtClosing };
  try {
    const res = await markCertificateShared(memberId, session.user.name ?? "—");
    revalidatePath("/admin/welcome-cards");
    revalidatePath("/admin/departments");
    return { error: res.ok ? null : res.reason };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
