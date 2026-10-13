"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  submitTerminationRequest, decideTerminationRequest,
  withdrawTerminationRequest, canDecide, memberForSession,
} from "@/lib/termination";
import { prisma } from "@/lib/prisma";
import { safeErrorMessage } from "@/lib/safeError";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("يجب تسجيل الدخول");
  return session;
}

function parseDate(iso?: string | null): Date | null {
  if (!iso || !iso.trim()) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** يرفع صاحبُ الحساب طلبه — هويّته من الجلسة لا من الواجهة */
export async function submitTerminationAction(
  reason: string,
  endDateIso?: string
): Promise<{ error: string | null }> {
  const session = await requireSession();
  try {
    const member = await memberForSession(session);
    if (!member) return { error: "لا سجلّ عضويةٍ مرتبطٌ بحسابك" };
    const res = await submitTerminationRequest({
      memberId: member.id,
      reason,
      requestedEndDate: parseDate(endDateIso),
    });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/member");
    revalidatePath("/admin/profile");
    revalidatePath("/admin/terminations");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** يسحب صاحبُ الطلب طلبَه — والملكية مفروضة في الاستعلام */
export async function withdrawTerminationAction(requestId: string): Promise<{ error: string | null }> {
  const session = await requireSession();
  try {
    const member = await memberForSession(session);
    if (!member) return { error: "لا سجلّ عضويةٍ مرتبطٌ بحسابك" };
    const res = await withdrawTerminationRequest({ requestId, memberId: member.id });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/member");
    revalidatePath("/admin/profile");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** قرار المسؤول — والصلاحية تُفحَص على الطلب بعينه لا على الدور وحده */
export async function decideTerminationAction(
  requestId: string,
  decision: "approve" | "reject" | "request_meeting",
  note?: string,
  endDateIso?: string
): Promise<{ error: string | null }> {
  const session = await requireSession();
  try {
    const req = await prisma.terminationRequest.findUnique({
      where: { id: requestId },
      select: { memberId: true },
    });
    if (!req) return { error: "الطلب غير موجود" };
    if (!(await canDecide(req, session))) return { error: "غير مصرح لك بهذا الإجراء" };

    const res = await decideTerminationRequest({
      requestId,
      decision,
      note,
      endDate: parseDate(endDateIso),
      actorId: session.user.id,
      actorName: session.user.name ?? "—",
    });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/terminations");
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
