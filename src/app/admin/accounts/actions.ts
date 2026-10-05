"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resetUserCredentials } from "@/lib/workflow";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

/** إعادة تعيين بيانات دخول حساب إداري (قائد قسم / تنفيذي) — الفاونڈر يملك هذا
 *  لأي حساب، والتنفيذي يملكه فقط لحسابات قادة الأقسام (لا لحساب تنفيذي آخر ولا لنفسه) */
export async function resetUserCredentialsAction(
  userId: string,
  newEmail: string
): Promise<{ error: string | null; tempPassword?: string; email?: string }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const allowed =
    session.user.role === "super_admin"
      ? true
      : session.user.role === "executive"
        ? target.role === "department_admin" || target.role === "operations_officer"
        : false;
  if (!allowed) return { error: "غير مصرح لك بهذا الإجراء" };

  const trimmedEmail = newEmail.trim().toLowerCase();
  try {
    const { tempPassword, user } = await resetUserCredentials(
      userId,
      trimmedEmail && trimmedEmail !== target.email ? trimmedEmail : undefined
    );
    revalidatePath("/admin/accounts");
    return { error: null, tempPassword, email: user.email };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
