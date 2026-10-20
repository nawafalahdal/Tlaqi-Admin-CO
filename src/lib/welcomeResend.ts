import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

/** إعادةُ بطاقة الانضمام — قرارُ المؤسس.
 *
 *  البطاقةُ تُرسَل وحدها مرّةً عند الاعتماد. وإعادتُها عملٌ تشغيليٌّ بيدٍ
 *  واحدة: **مسؤول المتابعة والتشغيل** وحده يُعيدها. وقيادةُ التسويق لا
 *  تُرسل، بل **تطلب** منه الإعادة بتذكرةٍ تصل إليه. ولا يملكها غيرُهما —
 *  ولا المؤسس ولا الرئيس التنفيذي — بنصّ القرار.
 *
 *  **وللإعادة فرصةٌ واحدة لكل شخص** (`WELCOME_MAX_SENDS` = بطاقةُ الاعتماد
 *  وإعادةٌ واحدة). ولا يُرسل أحدٌ البطاقةَ لنفسه: من لم تصله يُبلغ مسؤولَ
 *  التشغيل بتذكرة، فيتأكّد ثم يُعيدها. والسقفُ يُكتَب في شرط الحجز
 *  (`welcome.ts`) فلا تتجاوزه ضغطتان متسابقتان.
 *
 *  والشرطُ يُفرَض في الخادم عند كل إرسال؛ إخفاءُ الزرّ تبعٌ له. */
export const WELCOME_MAX_SENDS = 2;

export async function canResendWelcome(session: Session): Promise<boolean> {
  return session.user.role === "operations_officer";
}

/** قيادةُ قسم التسويق — تطلب الإعادة ولا تُرسلها.
 *
 *  والقسمُ يُقرأ من القاعدة لا من الجلسة: من نُقل من التسويق تسقط عنه
 *  الصلاحية في الطلب التالي. ويُعرَف القسم بمعرِّفه `marketing` أو باسمه. */
export async function canRequestWelcomeResend(session: Session): Promise<boolean> {
  if (session.user.role !== "department_admin") return false;
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, department: { select: { slug: true, name: true } } },
  });
  if (!me?.isActive || !me.department) return false;
  return me.department.slug === "marketing" || me.department.name.trim() === "التسويق";
}

/** لمن تُعاد: القادةُ والأعضاء — لا حسابُ المؤسس.
 *
 *  بطاقةُ المؤسس بابُ دخولٍ إلى أعلى حسابٍ في المنصة، فلا يُعيدها إليه
 *  غيرُه. */
export function canResendTo(target: { kind: "user" | "member"; role?: string }) {
  return target.kind === "member" || target.role !== "super_admin";
}
