"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { raiseTicket } from "@/lib/tickets";
import { safeErrorMessage } from "@/lib/safeError";
import { appBaseUrl } from "@/lib/emailBrand";
import { canRequestWelcomeResend, canResendTo, WELCOME_MAX_SENDS } from "@/lib/welcomeResend";

/** طلبُ إعادة بطاقة الانضمام — من قيادة التسويق إلى مسؤول المتابعة والتشغيل.
 *
 *  لا يُرسل شيئاً: يرفع تذكرةً بالمسار القائم (`raiseTicket`) وجهتُها مسؤول
 *  التشغيل بعينه، فتصله في لوحته وبريده وتتصعّد إن تأخّرت كأيّ تذكرة. وهو
 *  من يُعيد البطاقة من صفحته أو يردّ الطلب.
 *
 *  ولا يُكرَّر الطلب: تذكرةٌ مفتوحةٌ بالموضوع نفسه من الرافع نفسه تكفي. */
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
    const target =
      kind === "user"
        ? await prisma.user.findUnique({
            where: { id },
            select: { fullName: true, role: true, isActive: true, welcomeEmailCount: true },
          })
        : await prisma.member.findUnique({
            where: { id },
            select: { fullName: true, isActive: true, welcomeEmailCount: true, noFurtherEmail: true },
          });
    if (!target || !target.isActive) return { error: "الحساب غير موجود أو غير نشط" };
    if (!canResendTo({ kind, role: "role" in target ? target.role : undefined })) {
      return { error: "بطاقةُ المؤسس لا تُعاد من هنا" };
    }
    if ("noFurtherEmail" in target && target.noFurtherEmail) return { error: "انتهت تجربة هذا العضو" };
    if (target.welcomeEmailCount >= WELCOME_MAX_SENDS) {
      return { error: `بلغت بطاقاتُه الحدَّ الأقصى (${WELCOME_MAX_SENDS} مرات) — لا تُعاد بعده` };
    }

    const ops = await prisma.user.findFirst({
      where: { role: "operations_officer", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!ops) return { error: "لا مسؤولَ متابعةٍ وتشغيلٍ معيَّنٌ بعد — لا يصل الطلب لأحد" };

    const subject = `طلب إعادة بطاقة الانضمام — ${target.fullName}`;
    const existing = await prisma.ticket.findFirst({
      where: {
        raisedByUserId: session.user.id,
        targetUserId: ops.id,
        subject,
        status: { in: ["open", "in_progress"] },
      },
      select: { ticketNumber: true },
    });
    if (existing) return { error: `الطلب مرفوعٌ من قبل ولم يُغلق بعد (تذكرة #${existing.ticketNumber})` };

    const created = await raiseTicket({
      raisedByUserId: session.user.id,
      targetUserId: ops.id,
      subject,
      description:
        `تطلب قيادة التسويق إعادة إرسال بطاقة الانضمام إلى ${target.fullName}. ` +
        `أُرسلت له حتى الآن ${target.welcomeEmailCount} من ${WELCOME_MAX_SENDS}. ` +
        `تُعاد من صفحة «بطاقات الانضمام».`,
      linkUrl: `${appBaseUrl()}/admin/welcome-cards?q=${encodeURIComponent(target.fullName)}`,
    });
    revalidatePath("/admin/tickets");
    revalidatePath("/admin");
    return { error: null, ticketNumber: created.ticketNumber };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
