import { prisma } from "@/lib/prisma";
import type { InviteTargetRole, TestTrack } from "@prisma/client";
import type { Session } from "next-auth";

/** يحدد بنك الأسئلة الصحيح حسب الدور المستهدف للدعوة:
 *  عضو قسم ← اختبار ذلك القسم (يملكه أدمن القسم)
 *  قائد قسم ← اختبار القادة الموحّد (يملكه التنفيذي)
 *  تنفيذي ← اختبار التنفيذيين (يملكه الفاونڈر فقط) */
export async function getTrackForTarget(targetRole: InviteTargetRole, departmentId: string | null) {
  if (targetRole === "member") {
    if (!departmentId) throw new Error("دعوة عضو تتطلب قسماً");
    return prisma.testTrack.findUniqueOrThrow({
      where: { scope_departmentId: { scope: "department_member", departmentId } },
    });
  }
  // department_admin/executive: صف وحيد بلا قسم — NULL في Postgres لا يصلح
  // لمفتاح upsert/findUnique المركّب، فنبحث بـ scope فقط (findFirst آمن هنا)
  if (targetRole === "department_admin") {
    return prisma.testTrack.findFirstOrThrow({ where: { scope: "department_admin" } });
  }
  return prisma.testTrack.findFirstOrThrow({ where: { scope: "executive" } });
}

/** حقل options مخزّن كـ Json في Prisma — هذا يحوّله لمصفوفة نصوص مكتوبة للواجهة */
export function toQuestionViewModel(q: {
  id: string;
  prompt: string;
  options: unknown;
  correctIndex: number;
}) {
  return {
    id: q.id,
    prompt: q.prompt,
    options: q.options as string[],
    correctIndex: q.correctIndex,
  };
}

export function scoreAnswers(
  questions: { id: string; correctIndex: number }[],
  answers: Record<string, number>
) {
  if (questions.length === 0) return 0;
  let correct = 0;
  for (const q of questions) {
    if (answers[q.id] === q.correctIndex) correct += 1;
  }
  return Math.round((correct / questions.length) * 100);
}

export const ROLE_LABELS: Record<InviteTargetRole, string> = {
  member: "عضو",
  department_admin: "قائد قسم",
  executive: "الإدارة التنفيذية",
};

/** يحدد من يملك صلاحية تعديل أسئلة بنك اختبار معيّن، تطبيقاً لتسلسل الحوكمة:
 *  الفاونڈر يحرر اختبار التنفيذيين، التنفيذي يحرر اختبار القادة، وأدمن كل
 *  قسم يحرر اختبار أعضاء قسمه فقط */
export function canEditTrack(session: Session, track: Pick<TestTrack, "scope" | "departmentId">) {
  if (track.scope === "executive") return session.user.role === "super_admin";
  if (track.scope === "department_admin") {
    return session.user.role === "super_admin" || session.user.role === "executive";
  }
  return (
    session.user.role === "super_admin" ||
    session.user.role === "executive" ||
    (session.user.role === "department_admin" && session.user.departmentId === track.departmentId)
  );
}
