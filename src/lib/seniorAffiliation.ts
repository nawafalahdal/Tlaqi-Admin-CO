import { prisma } from "@/lib/prisma";

/** الإدارة العليا — انتماءٌ يُشتقّ من الدور لا يُسجَّل يدوياً.
 *
 *  **قرارُ المؤسس:** المؤسس والرئيس التنفيذي ومسؤول المتابعة والتشغيل
 *  يُصنَّفون في «الإدارة العليا» مباشرةً. فلا يُسأل أحدهم عن قسمه، ولا يبقى
 *  الرئيس التنفيذي «بلا قسم» لأن أحداً لم يُسجّله.
 *
 *  **ولماذا اشتقاقٌ لا كتابةٌ في `departmentId`؟** لأن عمودَ القسم يحكم
 *  صلاحياتٍ أخرى (إعلانات القسم، تقويمه، طلبات إنهائه). وكتابتُه لهؤلاء
 *  تُدخلهم في نطاقاتٍ لم يُقرَّر إدخالُهم فيها. فالانتماءُ يُقرأ من الدور
 *  حيث يُعرَض — الملف والسجلّ والهيكل — ولا يتغيّر شيءٌ في الصلاحيات ولا
 *  في القاعدة. ومن نُقل من هذه الأدوار خرج منها في القراءة التالية. */
export const SENIOR_ROLES = ["super_admin", "executive", "operations_officer"] as const;

export function isSeniorRole(role: string | null | undefined): boolean {
  return (SENIOR_ROLES as readonly string[]).includes(role ?? "");
}

/** قسمُ الإدارة العليا كما هو في القاعدة — القسمُ الاستثنائي الأصيل */
export async function seniorDepartment() {
  return prisma.department.findFirst({
    where: { leadershipOnly: true, parentId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, colorHex: true, slug: true },
  });
}

/** القسمُ المعروض لصاحب الدور: الإدارة العليا لأهلها، وقسمُه المسجَّل لغيرهم */
export function affiliationFor<D>(role: string | null | undefined, dept: D | null, senior: D | null): D | null {
  return isSeniorRole(role) ? (senior ?? dept) : dept;
}
