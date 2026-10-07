"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { canCreateDepartment, createDepartment } from "@/lib/departments";
import { safeErrorMessage } from "@/lib/safeError";

export async function createDepartmentAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول", success: false };
  if (!canCreateDepartment(session.user.role)) {
    return { error: "إنشاء الأقسام خاص بالفاوندر والمدير التنفيذي", success: false };
  }

  const name = String(formData.get("name") ?? "");
  const colorHex = String(formData.get("colorHex") ?? "");

  try {
    await createDepartment({ name, colorHex, createdByName: session.user.name ?? "—" });
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
