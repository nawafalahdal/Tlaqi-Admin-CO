"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canPublishAnnouncement, publishAnnouncement } from "@/lib/announcements";
import { safeErrorMessage } from "@/lib/safeError";
import { appendMemberEvent } from "@/lib/googleSheets";
import { revalidatePath } from "next/cache";
import type { AnnouncementAudience, RequestType } from "@prisma/client";

const AUDIENCES: AnnouncementAudience[] = ["everyone", "leadership", "department"];
/** ما يصحّ أن ترفعه القيادة كطلب بين الأقسام.
 *  «بانر ترحيبي» ليس منها: تُنشئه المنصة تلقائياً عند الاعتماد، فرفعه
 *  يدوياً يُنتج طلباً مكرراً بلا عضو مرتبط. */
const LEADERSHIP_REQUEST_TYPES: RequestType[] = [
  "dept_contact",
  "content_writing",
  "design_work",
  "custom_design",
  "publishing",
  "tech_support",
  "hr_support",
  "equipment",
  "budget_approval",
  "meeting",
  "escalate_to_executive",
  "escalate_to_founder",
  "other",
];

export async function publishAnnouncementAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await auth();
    if (!session) return { error: "يجب تسجيل الدخول", success: false };
    if (!canPublishAnnouncement(session.user.role)) {
      return { error: "غير مصرح لك بنشر الإعلانات", success: false };
    }

    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const audienceRaw = String(formData.get("audience") ?? "everyone");
    const departmentId = String(formData.get("departmentId") ?? "").trim() || null;
    // البثّ بالبريد قرار صريح في النموذج، لا افتراضاً صامتاً
    const sendEmail = formData.get("sendEmail") === "on";

    if (!title || !body) return { error: "العنوان والنص مطلوبان", success: false };
    if (!AUDIENCES.includes(audienceRaw as AnnouncementAudience)) {
      return { error: "جمهور غير صالح", success: false };
    }
    const audience = audienceRaw as AnnouncementAudience;
    if (audience === "department" && !departmentId) {
      return { error: "اختر القسم المستهدف", success: false };
    }

    await publishAnnouncement({
      title,
      body,
      audience,
      departmentId,
      authorId: session.user.id,
      authorName: session.user.name ?? "—",
      sendEmail,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/operations");
    revalidatePath("/admin/departments");
    revalidatePath("/member");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function deleteAnnouncementAction(id: string): Promise<{ error: string | null }> {
  try {
    const session = await auth();
    if (!session) return { error: "يجب تسجيل الدخول" };

    const announcement = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    // المؤسس يحذف أي إعلان؛ غيره يحذف إعلانه هو فقط
    const allowed =
      session.user.role === "super_admin" ||
      (canPublishAnnouncement(session.user.role) && announcement.authorId === session.user.id);
    if (!allowed) return { error: "غير مصرح لك بحذف هذا الإعلان" };

    await prisma.announcement.delete({ where: { id } });
    revalidatePath("/admin");
    revalidatePath("/admin/operations");
    revalidatePath("/member");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** يرفع القيادة (فاوندر/تنفيذي/مسؤول تشغيل) طلباً لقسم معيّن — بخلاف الطلبات
 *  التي يُنشئها النظام تلقائياً (بانر ترحيبي، اجتماع شرح بعد الرسوب) */
export async function createLeadershipRequestAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const session = await auth();
    if (!session) return { error: "يجب تسجيل الدخول", success: false };
    if (!canPublishAnnouncement(session.user.role)) {
      return { error: "غير مصرح لك برفع طلب للأقسام", success: false };
    }

    const typeRaw = String(formData.get("type") ?? "");
    const targetDepartmentId = String(formData.get("targetDepartmentId") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim();
    const dueDays = Number(formData.get("dueDays") ?? 3);

    if (!LEADERSHIP_REQUEST_TYPES.includes(typeRaw as RequestType)) {
      return { error: "نوع الطلب غير صالح", success: false };
    }
    if (!targetDepartmentId) return { error: "اختر القسم المستهدف", success: false };
    if (!note) return { error: "اكتب تفاصيل الطلب", success: false };
    if (!Number.isFinite(dueDays) || dueDays < 1 || dueDays > 30) {
      return { error: "المهلة يجب أن تكون بين يوم و30 يوماً", success: false };
    }

    const department = await prisma.department.findUniqueOrThrow({
      where: { id: targetDepartmentId },
    });

    const dueDate = new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000);
    await prisma.request.create({
      data: {
        type: typeRaw as RequestType,
        targetDepartmentId: department.id,
        createdById: session.user.id,
        status: "new",
        dueDate,
        note: `${note} — رفعه ${session.user.name ?? "القيادة"}`,
      },
    });

    await appendMemberEvent({
      fullName: session.user.name ?? "القيادة",
      email: session.user.email ?? "",
      event: "رفع طلب لقسم",
      details: `${department.name}: ${note}`,
      at: new Date(),
    });

    revalidatePath("/admin");
    revalidatePath("/admin/operations");
    revalidatePath("/admin/departments");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
