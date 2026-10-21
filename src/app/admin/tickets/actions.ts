"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { raiseTicket, escalateTicketNow, respondToTicket, canRespondToTicket } from "@/lib/tickets";
import { safeErrorMessage } from "@/lib/safeError";
import { isSafeHttpUrl } from "@/lib/calendar";

import { getLocale, getDictionary } from "@/i18n/server";
const TICKET_ROLES = ["super_admin", "executive", "operations_officer", "department_admin"];

/** كل حساب إداري يرفع تذكرة — الفاوندر والتنفيذي ومسؤول التشغيل وقادة الأقسام.
 *  حصرها سابقاً على الأعضاء كان يعني أن القيادة لا تملك قناة العمل نفسها. */
export async function raiseAdminTicketAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  const L = getDictionary(await getLocale()).rTicketsActions;
  const session = await auth();
  if (!session || !TICKET_ROLES.includes(session.user.role)) {
    return { error: L.youAreNotAllowed, success: false };
  }

  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const target = String(formData.get("target") ?? "");
  const linkUrl = String(formData.get("linkUrl") ?? "").trim();

  if (!subject || !description) return { error: L.subjectAndDetailsAre, success: false };
  if (!target) return { error: L.chooseTheTicketS, success: false };
  // نصٌّ ليس رابطاً في موضع يُنقر يُربك قارئه
  if (linkUrl && !isSafeHttpUrl(linkUrl)) {
    return { error: L.invalidAttachedLinkIt, success: false };
  }

  // الوجهة تصل كقيمة واحدة مسبوقة بنوعها، فلا يحتمل النموذج وجهتين معاً
  const [kind, id] = target.split(":");

  try {
    await raiseTicket({
      raisedByUserId: session.user.id,
      targetDepartmentId: kind === "dept" ? id : undefined,
      targetUserId: kind === "user" ? id : undefined,
      targetMemberId: kind === "member" ? id : undefined,
      subject,
      description,
      linkUrl: linkUrl || null,
    });
    revalidatePath("/admin/tickets");
    revalidatePath("/admin");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

/** تصعيد يدوي فوري بدل انتظار المهلة — لصاحب التذكرة أو من يملكها الآن */
export async function escalateTicketAction(ticketId: string) {
  const L = getDictionary(await getLocale()).rTicketsActions;
  const session = await auth();
  if (!session || !TICKET_ROLES.includes(session.user.role)) {
    throw new Error(L.youAreNotAllowed2);
  }
  await escalateTicketNow(ticketId, session.user.name ?? "—");
  revalidatePath("/admin/tickets");
  revalidatePath("/admin");
}

/** الردّ على تذكرة من صفحة التذاكر الموحّدة */
export async function respondToTicketAction(
  ticketId: string,
  status: "in_progress" | "resolved",
  resolutionNote?: string
) {
  const L = getDictionary(await getLocale()).rTicketsActions;
  const session = await auth();
  if (!session || !TICKET_ROLES.includes(session.user.role)) {
    throw new Error(L.youAreNotAllowed2);
  }

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { member: true, raisedByUser: true, targetMember: true },
  });

  // الردّ لصاحب المرحلة الحالية وحده، ولا يردّ أحد على تذكرة رفعها بنفسه
  if (!canRespondToTicket(ticket, session)) throw new Error(L.youAreNotAllowed2);

  const res = await respondToTicket({
    ticketId,
    status,
    resolutionNote,
    actorUserId: session.user.id,
  });
  if (!res.ok) throw new Error(res.reason);
  revalidatePath("/admin/tickets");
  revalidatePath("/admin");
}
