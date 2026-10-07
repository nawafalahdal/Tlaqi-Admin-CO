import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendAnnouncementEmail } from "@/lib/email";
import type { AnnouncementAudience } from "@prisma/client";
import type { Session } from "next-auth";

/** الأدوار التي تملك نشر إعلان — القيادة فقط، لا الأعضاء ولا قادة الأقسام */
export function canPublishAnnouncement(role: string) {
  return role === "super_admin" || role === "executive" || role === "operations_officer";
}

export async function publishAnnouncement(opts: {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  departmentId: string | null;
  authorId: string;
  authorName: string;
  sendEmail?: boolean;
}) {
  const announcement = await prisma.announcement.create({
    data: {
      title: opts.title,
      body: opts.body,
      audience: opts.audience,
      departmentId: opts.audience === "department" ? opts.departmentId : null,
      authorId: opts.authorId,
      authorName: opts.authorName,
    },
    include: { department: true },
  });

  const audienceLabel =
    announcement.audience === "everyone"
      ? "الجميع"
      : announcement.audience === "leadership"
        ? "القيادة فقط"
        : (announcement.department?.name ?? "قسم");

  // البثّ بالبريد اختياري: الإعلان على المنصة يصل لمن يفتحها، والبريد
  // يصل لمن لا يفتحها اليوم. الفرق بينهما قرار الناشر لا افتراض النظام.
  let delivered = 0;
  if (opts.sendEmail) {
    const recipients = await announcementRecipients(
      announcement.audience,
      announcement.departmentId
    );
    delivered = await sendAnnouncementEmail({
      recipients,
      title: opts.title,
      body: opts.body,
      authorName: opts.authorName,
      audienceLabel,
      portalUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/admin`,
    });
    await prisma.announcement.update({
      where: { id: announcement.id },
      data: { sentByEmail: true, emailRecipients: delivered },
    });
  }

  await appendMemberEvent({
    fullName: opts.authorName,
    email: "",
    event: "نشر إعلان",
    details:
      `${opts.title} — الجمهور: ${audienceLabel}` +
      (opts.sendEmail ? ` — أُرسل بالبريد إلى ${delivered} مستلماً` : " — على المنصة فقط"),
    at: announcement.createdAt,
  });

  return { ...announcement, emailRecipients: delivered };
}

/** يُرجع الإعلانات التي يحق لهذه الجلسة رؤيتها حسب دورها وقسمها */
export async function announcementsForSession(session: Session, take = 5) {
  const role = session.user.role;
  const departmentId = session.user.departmentId ?? undefined;
  const isLeadership = role !== "member";

  return prisma.announcement.findMany({
    where: {
      OR: [
        { audience: "everyone" },
        ...(isLeadership ? [{ audience: "leadership" as const }] : []),
        ...(departmentId ? [{ audience: "department" as const, departmentId }] : []),
      ],
    },
    include: { department: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}


/** بُرُد جمهور الإعلان: الحسابات الإدارية النشطة والأعضاء المعتمدين النشطين.
 *  المرشّح الذي لم يُعتمد بعد ليس من الفريق، فلا تصله إعلانات الفريق. */
async function announcementRecipients(
  audience: AnnouncementAudience,
  departmentId: string | null
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(audience === "department" && departmentId ? { departmentId } : {}),
    },
    select: { email: true },
  });

  // "القيادة فقط" لا تشمل الأعضاء بطبيعتها
  const members =
    audience === "leadership"
      ? []
      : await prisma.member.findMany({
          where: {
            isActive: true,
            approvalStatus: "approved",
            ...(audience === "department" && departmentId ? { departmentId } : {}),
          },
          select: { email: true },
        });

  return Array.from(new Set([...users, ...members].map((r) => r.email).filter(Boolean)));
}
