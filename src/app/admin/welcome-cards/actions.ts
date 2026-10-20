"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { raiseTicket } from "@/lib/tickets";
import { safeErrorMessage } from "@/lib/safeError";
import { appBaseUrl } from "@/lib/emailBrand";
import { canRequestWelcomeResend, canResendTo, WELCOME_MAX_SENDS } from "@/lib/welcomeResend";

/** طلبُ إعادة بطاقة الانضمام — يصل تذكرةً إلى مسؤول المتابعة والتشغيل.
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
  if (!target || !target.isActive) return { error: "الحساب غير موجود أو غير نشط" };
  if (!canResendTo({ kind: opts.target.kind, role: "role" in target ? target.role : undefined })) {
    return { error: "بطاقةُ المؤسس لا تُعاد من هنا" };
  }
  if ("noFurtherEmail" in target && target.noFurtherEmail) return { error: "انتهت تجربة هذا العضو" };
  if (target.welcomeEmailCount >= WELCOME_MAX_SENDS) {
    return { error: "استُنفدت فرصةُ الإعادة — بطاقةُ الاعتماد وإعادةٌ واحدة، ولا تُعاد بعدها" };
  }

  const ops = await prisma.user.findFirst({
    where: { role: "operations_officer", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!ops) return { error: "لا مسؤولَ متابعةٍ وتشغيلٍ معيَّنٌ بعد — لا يصل الطلب لأحد" };

  const subject = opts.subject(target.fullName);
  const raiserWhere = "memberId" in opts.raiser ? { memberId: opts.raiser.memberId } : { raisedByUserId: opts.raiser.userId };
  const existing = await prisma.ticket.findFirst({
    where: { ...raiserWhere, targetUserId: ops.id, subject, status: { in: ["open", "in_progress"] } },
    select: { ticketNumber: true },
  });
  if (existing) return { error: `الطلب مرفوعٌ من قبل ولم يُغلق بعد (تذكرة #${existing.ticketNumber})` };

  const created = await raiseTicket({
    ...("memberId" in opts.raiser ? { memberId: opts.raiser.memberId } : { raisedByUserId: opts.raiser.userId }),
    targetUserId: ops.id,
    subject,
    description:
      `${opts.why(target.fullName)} ` +
      `أُرسلت له حتى الآن ${target.welcomeEmailCount} بطاقة، ويبقى له إعادةٌ واحدة. ` +
      `تأكّد من بريده ثم أعِدها من صفحة «بطاقات الانضمام».`,
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
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
  if (!(await canRequestWelcomeResend(session))) {
    return { error: "طلبُ إعادة بطاقة الانضمام لقيادة التسويق" };
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
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
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
