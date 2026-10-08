import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendAnnouncementEmail } from "@/lib/email";
import type { AnnouncementAudience } from "@prisma/client";
import type { Session } from "next-auth";

/** الأدوار التي تملك نشر إعلان.
 *
 *  صار قادة الأقسام منهم: القسم يحتاج أن يخاطب أهله — «تفاعلوا مع هذا
 *  المنشور»، «اختبار المنصة اليوم» — ومرور ذلك بالقيادة يُبطئه بلا فائدة
 *  ويُشغل القيادة بما ليس لها. لكن صلاحيته محدودة بقسمه كما في
 *  `announcementPowers`: يُخاطب أهله لا الفريق كلّه. */
export function canPublishAnnouncement(role: string) {
  return (
    role === "super_admin" ||
    role === "executive" ||
    role === "operations_officer" ||
    role === "department_admin"
  );
}

/** ما يملكه صاحب الجلسة في الإعلانات بالضبط.
 *
 *  الصلاحية ليست «ينشر أو لا ينشر»: من ينشر، ولمن، وهل يضع رابط اجتماع.
 *  جمعُها في موضع واحد يمنع أن تتفرّق على النموذج والإجراء فتختلفا —
 *  وهو ما يجعل زرّاً يظهر لمن يُرفض طلبه. */
/** القيادة التي تُخاطب الأقسام من فوقها — لا قادة الأقسام أنفسهم.
 *
 *  كان رفع الطلبات بين الأقسام يستعمل `canPublishAnnouncement`، فلمّا
 *  دخل قادة الأقسام في النشر كانوا سيرثون معه رفع الطلبات على الأقسام
 *  الأخرى. الصلاحيتان مختلفتان ويجب أن تُكتبا مختلفتين. */
export function isLeadership(role: string) {
  return role === "super_admin" || role === "executive" || role === "operations_officer";
}

export function announcementPowers(session: {
  user: { role: string; departmentId?: string | null };
}): {
  canPublish: boolean;
  audiences: AnnouncementAudience[];
  /** قائد القسم مربوط بقسمه: لا يختار الوجهة أصلاً */
  lockedDepartmentId: string | null;
  /** رابط الاجتماع للإدارة العليا وحدها: من يدعو الفريق لاجتماع هو من
   *  يملك عَقده. ومسؤول التشغيل ينفّذ الاجتماعات ولا يدعو إليها. */
  canAttachMeeting: boolean;
} {
  const { role, departmentId } = session.user;

  if (role === "super_admin" || role === "executive") {
    return {
      canPublish: true,
      audiences: ["everyone", "leadership", "department"],
      lockedDepartmentId: null,
      canAttachMeeting: true,
    };
  }
  if (role === "operations_officer") {
    return {
      canPublish: true,
      audiences: ["everyone", "leadership", "department"],
      lockedDepartmentId: null,
      canAttachMeeting: false,
    };
  }
  if (role === "department_admin" && departmentId) {
    return {
      canPublish: true,
      audiences: ["department"],
      lockedDepartmentId: departmentId,
      canAttachMeeting: false,
    };
  }
  return { canPublish: false, audiences: [], lockedDepartmentId: null, canAttachMeeting: false };
}

export async function publishAnnouncement(opts: {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  departmentId: string | null;
  authorId: string;
  authorName: string;
  sendEmail?: boolean;
  meetingUrl?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
}) {
  const announcement = await prisma.announcement.create({
    data: {
      title: opts.title,
      body: opts.body,
      audience: opts.audience,
      departmentId: opts.audience === "department" ? opts.departmentId : null,
      authorId: opts.authorId,
      authorName: opts.authorName,
      meetingUrl: opts.meetingUrl || null,
      linkUrl: opts.linkUrl || null,
      linkLabel: opts.linkLabel || null,
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
      // الروابط تُرسل مع البريد أيضاً: إعلان اجتماع يصل بلا رابطه
      // يُجبر صاحبه على فتح المنصة لينسخه — وهو ما أردنا تجنّبه بالبريد
      meetingUrl: opts.meetingUrl || null,
      linkUrl: opts.linkUrl || null,
      linkLabel: opts.linkLabel || null,
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
