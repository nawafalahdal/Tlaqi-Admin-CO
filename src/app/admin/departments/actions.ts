"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { canCreateDepartment, createDepartment } from "@/lib/departments";
import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
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

/** تغيير لون قسم.
 *
 *  اللون جزء من الهيكل لا من عمل القسم اليومي، فيبقى بيد من يملك الهيكل:
 *  المؤسس والتنفيذي. ولا يُغيَّر اسم القسم من هنا — الاسم يحمله كل سجلّ
 *  سابق في الشيت، وتغييره يفصل السجلّ عن صاحبه. */
export async function updateDepartmentColorAction(
  departmentId: string,
  colorHex: string
): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session) return { error: "يجب تسجيل الدخول" };
  if (!canCreateDepartment(session.user.role)) {
    return { error: "تغيير ألوان الأقسام خاص بالمؤسس والمدير التنفيذي" };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
    return { error: "اللون يجب أن يكون بصيغة #RRGGBB" };
  }

  try {
    const dept = await prisma.department.update({
      where: { id: departmentId },
      data: { colorHex },
    });
    await appendMemberEvent({
      fullName: session.user.name ?? "—",
      email: "",
      roleOrDepartment: dept.name,
      event: "تغيير لون قسم",
      details: `اللون الجديد: ${colorHex}`,
      at: new Date(),
    });
    revalidatePath("/admin/departments");
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
