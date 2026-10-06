"use server";

import { auth } from "@/auth";
import { submitTestAttempt } from "@/lib/workflow";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

/** يُرسل المرشّح اختباره من داخل حسابه — لا رمز دعوة ولا رابط مجهول: هويته
 *  هي جلسته. محاولة واحدة فقط: من اجتاز أو رسب لا يعيد. */
export async function submitCandidateTestAction(answers: Record<string, number>) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "member") {
      return { ok: false as const, error: "يجب تسجيل الدخول" };
    }

    // submitTestAttempt يُطالب بالسجل ذرّياً بشرط not_started، فيعيد null إن
    // كان الاختبار مُسلَّماً مسبقاً (نقرتان متتاليتان أو تبويبان مفتوحان)
    const result = await submitTestAttempt({ memberId: session.user.id, answers });
    if (!result) {
      return { ok: false as const, error: "تم تسليم اختبارك مسبقاً" };
    }
    const { score, passed } = result;

    revalidatePath("/admin");
    revalidatePath("/admin/departments");
    revalidatePath("/member");
    return { ok: true as const, score, passed };
  } catch (err) {
    return { ok: false as const, error: safeErrorMessage(err) };
  }
}
