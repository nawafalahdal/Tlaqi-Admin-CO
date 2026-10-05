"use server";

import { prisma } from "@/lib/prisma";
import { submitTestAttempt } from "@/lib/workflow";
import { scoreTest } from "@/lib/testQuestions";
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

export async function submitInviteTestAction(
  token: string,
  answers: Record<string, number>
) {
  const invite = await prisma.invite.findUnique({ where: { token }, include: { department: true } });
  if (!invite || invite.status !== "open") {
    return { ok: false as const, error: "هذه الدعوة لم تعد متاحة" };
  }

  const score = scoreTest(answers);

  const member = await prisma.member.create({
    data: {
      fullName: invite.fullName,
      email: invite.email,
      departmentId: invite.departmentId,
      inviteId: invite.id,
    },
  });

  await prisma.invite.update({ where: { id: invite.id }, data: { status: "used" } });

  const updated = await submitTestAttempt({
    memberId: member.id,
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, String(v)])),
    score,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/departments");

  return { ok: true as const, score, passed: updated.testStatus === "passed" };
}
