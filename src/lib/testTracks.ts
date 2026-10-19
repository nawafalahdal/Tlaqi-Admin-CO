import { prisma } from "@/lib/prisma";
import type { InviteTargetRole, TestTrack } from "@prisma/client";
import type { Session } from "next-auth";

/** يحدد بنك الأسئلة الصحيح حسب الدور المستهدف للدعوة:
 *  عضو قسم ← اختبار ذلك القسم (يملكه أدمن القسم)
 *  قائد قسم ← اختبار القادة الموحّد (يملكه التنفيذي)
 *  مسؤول تشغيل ← اختبار موحّد (يملكه المؤسس أو التنفيذي)
 *  تنفيذي ← اختبار التنفيذيين (يملكه المؤسس فقط) */
export async function getTrackForTarget(targetRole: InviteTargetRole, departmentId: string | null) {
  // **لماذا لا `findFirstOrThrow`:** خطأُ «لم يُعثر» من Prisma ليس `Error`
  // عادياً، فتُخفيه `safeErrorMessage` خلف «حدث خطأ غير متوقع». وهو عينُ
  // ما رآه الرئيس التنفيذي حين دعا مسؤول المتابعة والتشغيل: دورُ مسؤول
  // التشغيل أُضيف بترحيلٍ لم يُنشئ بنكَ أسئلته، فلم يكن له صفٌّ في الإنتاج.
  // والآن يُنشئه الترحيل، ويُسمّى النقصُ باسمه إن وقع.
  if (targetRole === "member" && !departmentId) throw new Error("دعوة عضو تتطلب قسماً");
  const scope = targetRole === "member" ? "department_member" : targetRole;
  const track = await prisma.testTrack.findFirst({
    where: targetRole === "member" ? { scope: "department_member", departmentId } : { scope },
    include: { _count: { select: { questions: true } } },
  });
  const label = ROLE_LABELS[targetRole];
  if (!track) {
    throw new Error(`لا يوجد بنكُ أسئلةٍ لمنصب «${label}» بعد. افتح صفحة اختباره وأضف أسئلته أولاً.`);
  }
  // بنكٌ فارغ يُسقط المرشّح آلياً: لا سؤال = ٠٪ = رسوب. فيُرفض قبل أن يُدعى أحد.
  if (track._count.questions === 0) {
    throw new Error(`بنكُ أسئلة «${label}» فارغ — أضف أسئلته من صفحة الاختبار قبل الدعوة، وإلا رسب المرشّح آلياً.`);
  }
  return track;
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
  operations_officer: "مسؤول التشغيل",
  executive: "الإدارة التنفيذية",
};

/** مسمّيات حسابات الدخول.
 *
 *  ROLE_LABELS يغطّي أدوار الدعوات فقط، ولا دعوة تُصدر للفاوندر — فكان
 *  مسمّاه يظهر خاماً (super_admin) في الشيت وفي كل موضع يُسمّي صاحب حساب.
 *  هذا الجدول يغطّي أدوار الحسابات كلها. */
export const ACCOUNT_ROLE_LABELS: Record<string, string> = {
  ...ROLE_LABELS,
  super_admin: "المؤسس",
};

/** مسمّى صاحب حساب أياً كان دوره — بلا خام يتسرّب إلى الواجهة */
export function accountRoleLabel(role: string) {
  return ACCOUNT_ROLE_LABELS[role] ?? role;
}

/** يحدد من يملك صلاحية تعديل أسئلة بنك اختبار معيّن، تطبيقاً لتسلسل الحوكمة:
 *  الفاونڋر يحرر اختبار التنفيذيين، التنفيذي يحرر اختبار القادة ومسؤول
 *  التشغيل، وأدمن كل قسم يحرر اختبار أعضاء قسمه فقط */
export function canEditTrack(session: Session, track: Pick<TestTrack, "scope" | "departmentId">) {
  if (track.scope === "executive") return session.user.role === "super_admin";
  if (track.scope === "department_admin" || track.scope === "operations_officer") {
    return session.user.role === "super_admin" || session.user.role === "executive";
  }
  return (
    session.user.role === "super_admin" ||
    session.user.role === "executive" ||
    (session.user.role === "department_admin" && session.user.departmentId === track.departmentId)
  );
}

/** نسخة السؤال التي تُرسَل للمرشّح — بلا correctIndex. ما يُمرَّر لمكوّن عميل
 *  يُسلسَل كاملاً داخل حمولة الصفحة ويقرؤه أي أحد من مصدرها، فتمرير الإجابة
 *  الصحيحة معه يعني تسليم إجابات الاختبار للممتحَن نفسه. */
export function toCandidateQuestion(q: { id: string; prompt: string; options: unknown }) {
  return {
    id: q.id,
    prompt: q.prompt,
    options: q.options as string[],
  };
}
