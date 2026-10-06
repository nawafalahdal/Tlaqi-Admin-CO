import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
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

  await appendMemberEvent({
    fullName: opts.authorName,
    email: "",
    event: "نشر إعلان",
    details: `${opts.title} — الجمهور: ${audienceLabel}`,
    at: announcement.createdAt,
  });

  return announcement;
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
