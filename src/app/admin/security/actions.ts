"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateTotpSecret, buildTotpEnrollment, verifyTotpCode } from "@/lib/totp";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

async function requireAdminUser() {
  const session = await auth();
  if (!session || session.user.role === "member") throw new Error("غير مصرح");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  return user;
}

export async function startTotpSetupAction(): Promise<
  { ok: true; qrDataUrl: string; secret: string } | { ok: false; error: string }
> {
  try {
    const user = await requireAdminUser();
    const secret = generateTotpSecret();
    // يُخزَّن السر فوراً لكن totpEnabled يبقى false حتى يُؤكَّد برمز صحيح —
    // محاولة إعداد مهجورة لا تُفعّل شيئاً
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    const { qrDataUrl } = await buildTotpEnrollment(secret, user.email);
    return { ok: true, qrDataUrl, secret };
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) };
  }
}

export async function confirmTotpSetupAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  try {
    const user = await requireAdminUser();
    const code = String(formData.get("code") ?? "");
    if (!user.totpSecret) return { error: "ابدأ الإعداد أولاً", success: false };
    if (!verifyTotpCode(user.totpSecret, code, user.email)) {
      return { error: "الرمز غير صحيح، تأكد من المزامنة وحاول مجدداً", success: false };
    }
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    revalidatePath("/admin/security");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function disableTotpAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const user = await requireAdminUser();
    const currentPassword = String(formData.get("currentPassword") ?? "");
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return { error: "كلمة المرور غير صحيحة" };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    revalidatePath("/admin/security");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
