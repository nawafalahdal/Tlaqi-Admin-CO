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
import { issueCertificate, recipientDetails, resendIssued, type IssueInput } from "@/lib/certificateRegistry";
import { isCertificateType } from "@/lib/certificateTypes";

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
    select: { stepDownAt: true, offboardingClosedAt: true, certificateIssuedAt: true, invite: { select: { targetRole: true } } },
  });
  if (!member) return { refusal: L.notFound, member: null };
  if (!mayIssueCertificateFor(role, member.invite.targetRole)) {
    return { refusal: fmt(L.notYourChain, RESENDER_LABEL[resenderRoleFor(member.invite.targetRole)]), member: null };
  }
  return { refusal: null, member };
}

/** **نموذج الإصدار** — ما يحتاجه عن المستلِم حين يُختار: بياناتُه الأولى لكل نوع،
 *  وما صدر له، وما يمنع كلَّ نوع، والموقِّعان بتوقيعَيهما، والرقمُ التالي.
 *  والسلسلةُ تُفرَض هنا: لا تُقرأ بياناتُ من ليس في عهدة السائل. */
export async function loadCertificateRecipientAction(memberId: string) {
  const L = getDictionary(await getLocale()).rRecognitionDesk;
  const session = await auth();
  if (!session) return { ok: false as const, reason: L.signInFirst };
  if (!canIssueCertificates(session.user.role)) return { ok: false as const, reason: L.notAllowed };
  if (typeof memberId !== "string" || !memberId) return { ok: false as const, reason: L.notFound };
  try {
    return await recipientDetails(session.user.role, memberId);
  } catch (err) {
    return { ok: false as const, reason: safeErrorMessage(err) };
  }
}

/** «إصدار وإرسال» — يُفحص كلُّ شيءٍ ثانيةً في `issueCertificate`: السلسلة، والأهلية،
 *  والحقول، والإصدار المبكر بسببه ومرجعه، ولا تكرار لمناسبةٍ واحدة. */
export async function issueCertificateAction(input: IssueInput) {
  const L = getDictionary(await getLocale()).rRecognitionDesk;
  const session = await auth();
  if (!session) return { ok: false as const, reason: L.signInFirst };
  if (!canIssueCertificates(session.user.role)) return { ok: false as const, reason: L.notAllowed };
  if (!input || typeof input !== "object" || typeof input.memberId !== "string" || !isCertificateType(input.type)) {
    return { ok: false as const, reason: L.notFound };
  }
  const fields = input.fields && typeof input.fields === "object" ? input.fields : {};
  const early =
    input.early && typeof input.early === "object"
      ? { reason: String(input.early.reason ?? ""), reference: String(input.early.reference ?? "") }
      : null;
  try {
    const res = await issueCertificate(
      { id: session.user.id, name: session.user.name ?? "—", role: session.user.role },
      { memberId: input.memberId, type: input.type, fields, early }
    );
    revalidatePath("/admin/welcome-cards");
    return res;
  } catch (err) {
    return { ok: false as const, reason: safeErrorMessage(err) };
  }
}

/** إعادةُ إرسال شهادةٍ من السجل لم يصل بريدها — بلا شهادةٍ ثانية */
export async function resendIssuedCertificateAction(certificateId: string): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rRecognitionDesk;
  const session = await auth();
  if (!session) return { error: L.signInFirst };
  if (!canIssueCertificates(session.user.role)) return { error: L.notAllowed };
  if (typeof certificateId !== "string" || !certificateId) return { error: L.notFound };
  try {
    const res = await resendIssued(
      { id: session.user.id, name: session.user.name ?? "—", role: session.user.role },
      certificateId
    );
    revalidatePath("/admin/welcome-cards");
    return { error: res.ok ? null : res.reason };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** إعادةُ إرسال شهادةٍ صدرت قبل السجل ولم يصل بريدها — لمن يعلو صاحبَها في السلسلة.
 *
 *  **إعادةٌ لا إصدار:** الإصدارُ كلُّه من «نموذج الإصدار» (`issueCertificateAction`)
 *  حيث الرقمُ والسجلُّ والسببُ والمرجعُ للمبكرة. فمن نادى هذا لمن لم تصدر له
 *  شهادتُه بعد يُرَدّ — ولا يُفتح بابٌ ثانٍ للإصدار المبكر بلا مرجع. */
export async function issueAppreciationDeskAction(
  memberId: string,
  _earlyReason?: string | null
): Promise<{ error: string | null }> {
  void _earlyReason;
  const L = getDictionary(await getLocale()).rRecognitionDesk;
  const session = await auth();
  if (!session) return { error: L.signInFirst };
  if (!canIssueCertificates(session.user.role)) return { error: L.notAllowed };
  const { refusal } = await chainRefusal(session.user.role, memberId, L);
  if (refusal) return { error: refusal };
  const stamped = await prisma.member.findUnique({ where: { id: memberId }, select: { appreciationIssuedAt: true } });
  if (!stamped?.appreciationIssuedAt) return { error: L.issueFromForm };
  try {
    const res = await issueAppreciation(memberId, { name: session.user.name ?? "—" });
    revalidatePath("/admin/welcome-cards");
    return { error: res.ok ? null : res.reason };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** إعادةُ إرسال شهادة الشكر والخبرة التي صدرت قبل السجل ولم يصل بريدها.
 *  وحوكمةُ الأسبوعين وحمايةُ التكرار في `markCertificateShared` نفسه. */
export async function issueFinalCertificateDeskAction(memberId: string): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rRecognitionDesk;
  const session = await auth();
  if (!session) return { error: L.signInFirst };
  if (!canIssueCertificates(session.user.role)) return { error: L.notAllowed };
  const { refusal, member } = await chainRefusal(session.user.role, memberId, L);
  if (refusal || !member) return { error: refusal ?? L.notFound };
  if (!member.stepDownAt || member.offboardingClosedAt) return { error: L.finalOnlyAtClosing };
  // إعادةٌ لا إصدار — الإصدارُ من نموذج الإصدار برقمه وسجله
  if (!member.certificateIssuedAt) return { error: L.issueFromForm };
  try {
    const res = await markCertificateShared(memberId, session.user.name ?? "—");
    revalidatePath("/admin/welcome-cards");
    revalidatePath("/admin/departments");
    return { error: res.ok ? null : res.reason };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
