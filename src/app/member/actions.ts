"use server";

import { auth } from "@/auth";
import { acknowledgeWarning } from "@/lib/workflow";
import { raiseTicket } from "@/lib/tickets";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

export async function acknowledgeWarningAction(warningId: string) {
  const session = await auth();
  if (!session || session.user.role !== "member") throw new Error("غير مصرح");
  await acknowledgeWarning(warningId, session.user.id);
  revalidatePath("/member");
}

export async function raiseTicketAction(
  _prevState: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  const session = await auth();
  if (!session || session.user.role !== "member") return { error: "غير مصرح", success: false };

  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const targetDepartmentId = String(formData.get("targetDepartmentId") ?? "");

  if (!subject || !description || !targetDepartmentId) {
    return { error: "جميع الحقول مطلوبة", success: false };
  }

  try {
    await raiseTicket({ memberId: session.user.id, targetDepartmentId, subject, description });
    revalidatePath("/member");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
