"use server";

import { prisma } from "@/lib/prisma";
import { submitTestAttempt } from "@/lib/workflow";
import { revalidatePath } from "next/cache";

export async function confirmInviteEmailAction(token: string, enteredEmail: string) {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "open") {
    return { ok: false, error: "هذه الدعوة لم تعد متاحة" };
  }
  if (invite.email.toLowerCase().trim() !== enteredEmail.toLowerCase().trim()) {
    return { ok: false, error: "البريد الإلكتروني المُدخل لا يطابق بيانات الدعوة" };
  }
  return { ok: true as const };
}

export async function submitInviteTestAction(token: string, answers: Record<string, number>) {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.status !== "open") {
    return { ok: false as const, error: "هذه الدعوة لم تعد متاحة" };
  }

  // تحديث ذري شرطه status="open" يمنع إرسالين متزامنين لنفس الرمز من كليهما
  // اجتياز الفحص أعلاه ثم إنشاء عضوين — الفائز الوحيد هو من ينجح بهذا التحديث
  const claimed = await prisma.invite.updateMany({
    where: { id: invite.id, status: "open" },
    data: { status: "used" },
  });
  if (claimed.count === 0) {
    return { ok: false as const, error: "هذه الدعوة لم تعد متاحة" };
  }

  const member = await prisma.member.create({
    data: {
      fullName: invite.fullName,
      email: invite.email,
      departmentId: invite.departmentId,
      inviteId: invite.id,
    },
  });

  const { score, passed } = await submitTestAttempt({ memberId: member.id, answers });

  revalidatePath("/admin");
  revalidatePath("/admin/departments");

  return { ok: true as const, score, passed };
}
