import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";

/** إعادةُ بطاقة الانضمام — سلسلةٌ حوكميّة كاملة (قرار المؤسس).
 *
 *  البطاقةُ تُرسَل وحدها مرّةً عند الاعتماد. وإعادتُها بيد من يعلو صاحبَها
 *  في السلسلة، ولا يُعيدها أحدٌ لنفسه إلا المؤسس:
 *
 *  | صاحبُ البطاقة            | يطلب من / ويُعيدها      |
 *  |--------------------------|--------------------------|
 *  | العضو وقائد القسم        | مسؤول المتابعة والتشغيل  |
 *  | مسؤول المتابعة والتشغيل  | الرئيس التنفيذي          |
 *  | الرئيس التنفيذي          | المؤسس                   |
 *  | المؤسس                   | نفسُه — يُرسلها مباشرة   |
 *
 *  و**لكل شخصٍ إعادةٌ واحدة** (`WELCOME_MAX_SENDS` = بطاقةُ الاعتماد وإعادة).
 *  وقيادةُ التسويق تطلب لغيرها من الأعضاء والقادة فيصل طلبُها مسؤولَ التشغيل.
 *  والسقفُ يُكتَب في شرط الحجز (`welcome.ts`) فلا تتجاوزه ضغطتان متسابقتان،
 *  والشرطُ كلُّه يُفرَض في الخادم عند كل إرسالٍ وطلب؛ الأزرارُ تبعٌ له. */
export const WELCOME_MAX_SENDS = 2;

export type ChainRole = "super_admin" | "executive" | "operations_officer";

/** من يُعيد بطاقةَ صاحب هذا الدور */
export function resenderRoleFor(targetRole: string): ChainRole {
  if (targetRole === "super_admin" || targetRole === "executive") return "super_admin";
  if (targetRole === "operations_officer") return "executive";
  return "operations_officer";
}

/** اسمُ من يُعيدها — لنصّ الزرّ والبلاغ */
export const RESENDER_LABEL: Record<ChainRole, string> = {
  super_admin: "المؤسس",
  executive: "الرئيس التنفيذي",
  operations_officer: "مسؤول المتابعة والتشغيل",
};

/** أيُعيد هذا الحسابُ بطاقةَ صاحب هذا الدور؟ */
export function mayResendTo(session: Session, targetRole: string): boolean {
  return session.user.role === resenderRoleFor(targetRole);
}

/** الأدوارُ التي يُعيد صاحبُ هذا الدور بطاقاتها — لصفحة «بطاقات الانضمام» */
export function resendTargetsFor(role: string): string[] {
  if (role === "operations_officer") return ["department_admin", "member"];
  if (role === "executive") return ["operations_officer"];
  if (role === "super_admin") return ["executive"];
  return [];
}

/** أله في السلسلة من يُعيد له؟ (المؤسس والتنفيذي ومسؤول التشغيل) */
export async function canResendWelcome(session: Session): Promise<boolean> {
  return resendTargetsFor(session.user.role).length > 0;
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
