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
  // الوجهة قيمة واحدة مسبوقة بنوعها: قسم، أو زميل، أو حساب إداري. هذا ما
  // يجعل مسار العمل الفعلي ممكناً — كاتب المحتوى يرسل للمصمّم باسمه.
  const target = String(formData.get("target") ?? "");

  if (!subject || !description || !target) {
    return { error: "جميع الحقول مطلوبة", success: false };
  }

  const [kind, id] = target.split(":");

  try {
    await raiseTicket({
      memberId: session.user.id,
      targetDepartmentId: kind === "dept" ? id : undefined,
      targetUserId: kind === "user" ? id : undefined,
      targetMemberId: kind === "member" ? id : undefined,
      subject,
      description,
    });
    revalidatePath("/member");
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
