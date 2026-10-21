"use server";

import { auth } from "@/auth";
import { submitTestAttempt } from "@/lib/workflow";
import { safeErrorMessage } from "@/lib/safeError";
import { revalidatePath } from "next/cache";

import { getLocale, getDictionary } from "@/i18n/server";
/** يُرسل المرشّح اختباره من داخل حسابه — لا رمز دعوة ولا رابط مجهول: هويته
 *  هي جلسته. محاولة واحدة فقط: من اجتاز أو رسب لا يعيد. */
export async function submitCandidateTestAction(answers: Record<string, number>) {
  const L = getDictionary(await getLocale()).rMemberTestActions;
  try {
    const session = await auth();
    if (!session || session.user.role !== "member") {
      return { ok: false as const, error: L.youNeedToSign };
    }

    // submitTestAttempt يُطالب بالسجل ذرّياً بشرط not_started، فيعيد null إن
    // كان الاختبار مُسلَّماً مسبقاً (نقرتان متتاليتان أو تبويبان مفتوحان)
    const result = await submitTestAttempt({ memberId: session.user.id, answers });
    if (!result) {
      return { ok: false as const, error: L.yourTestWasAlready };
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
