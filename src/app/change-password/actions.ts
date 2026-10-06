"use server";

import bcrypt from "bcryptjs";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clearFailedAttempts } from "@/lib/loginAttempts";

export async function changePasswordAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < 8) {
    return { error: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل" };
  }
  if (newPassword !== confirmPassword) {
    return { error: "كلمتا المرور غير متطابقتين" };
  }

  const isMember = session.user.role === "member";
  const newHash = await bcrypt.hash(newPassword, 10);

  if (isMember) {
    const member = await prisma.member.findUniqueOrThrow({ where: { id: session.user.id } });
    if (!member.passwordHash || !(await bcrypt.compare(currentPassword, member.passwordHash))) {
      return { error: "كلمة المرور الحالية غير صحيحة" };
    }
    await prisma.member.update({
      where: { id: member.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });
  } else {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return { error: "كلمة المرور الحالية غير صحيحة" };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });
  }

  // أي تعيين جديد لكلمة المرور يصفّر عدّاد المحاولات، وإلا عاد صاحبها من
  // هنا إلى صفحة الدخول ليجد حسابه مقفلاً بكلمة مرور صحيحة
  await clearFailedAttempts((session.user.email ?? "").toLowerCase().trim());

  // الجلسة (JWT) تحمل mustChangePassword القديمة — نسجّل الخروج ليدخل بكلمة المرور
  // الجديدة ويحصل على جلسة نظيفة، بدل محاولة تحديث الـ JWT الموقّع يدوياً
  await signOut({ redirectTo: "/login?passwordChanged=1" });
  return { error: null };
}
