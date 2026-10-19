import type { UserRole, InviteTargetRole } from "@prisma/client";

/** من يَحسم أمرَ مرشّح — اعتماداً أو رفضاً أو إعادةَ فتح.
 *
 *  **العطبُ الذي يُصلحه:** كان الشرطُ يسأل عن **قسم** المرشّح وحده
 *  (`canManageDepartment`) ولا يسأل عن **المنصب** الذي يُمنَح. والمرشّح
 *  التنفيذيُّ بلا قسم، فكان الرئيسُ التنفيذيُّ القائم يستطيع اعتمادَ من
 *  يَخلُفه — وهو قرارٌ للمؤسس وحده، كما أن دعوته للمؤسس وحده.
 *
 *  فالقاعدة: **لا يَحسم أحدٌ منصباً لا يملك منحَه.**
 *
 *  | المنصب المطلوب          | يَحسمه                                   |
 *  |-------------------------|------------------------------------------|
 *  | رئيس تنفيذي             | المؤسس                                   |
 *  | مسؤول المتابعة والتشغيل | المؤسس، الرئيس التنفيذي                  |
 *  | قائد قسم                | المؤسس، الرئيس التنفيذي                  |
 *  | عضو                     | المؤسس، الرئيس التنفيذي، قائدُ قسمه هو   |
 *
 *  والمنعُ الافتراضيّ: منصبٌ لا يرد هنا لا يَحسمه أحد. */
export function canDecideCandidate(
  viewer: { role: UserRole | "member"; departmentId?: string | null },
  candidate: { targetRole: InviteTargetRole; departmentId: string | null }
): boolean {
  switch (candidate.targetRole) {
    case "executive":
      return viewer.role === "super_admin";
    case "operations_officer":
    case "department_admin":
      return viewer.role === "super_admin" || viewer.role === "executive";
    case "member":
      if (viewer.role === "super_admin" || viewer.role === "executive") return true;
      return (
        viewer.role === "department_admin" &&
        candidate.departmentId !== null &&
        viewer.departmentId === candidate.departmentId
      );
    default:
      return false;
  }
}
