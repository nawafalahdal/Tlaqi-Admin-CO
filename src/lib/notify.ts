import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

/** مصفوفة «الحدث ← من يُخبَر» — موضعٌ واحد يُقرأ ويُراجَع.
 *
 *  كانت كل دالةٍ من اثنتين وعشرين تختار مستلميها في سطرٍ داخلها. فلا
 *  أحد يستطيع أن يجيب عن سؤالٍ بسيط: «من يصله بريدٌ عند كذا؟» إلا بقراءة
 *  اثنين وعشرين موضعاً — ولا أحد يلاحظ أن حدثاً يُراسل من لا شأن له،
 *  لأن لا موضع يُقارَن فيه.
 *
 *  فصارت القاعدة مكتوبةً هنا بثلاثة أجزاء لكل حدث: **من يُخبَر، ولماذا،
 *  ومتى لا يُخبَر أحد**. والدوال تسأل هذا الملفّ ولا تجتهد.
 *
 *  والمبدأ الحاكم: **البريد لمن يلزمه أن يفعل، لا لمن يَسُرّه أن يعلم.**
 *  من يرى الخبر على شاشته لحظة وقوعه لا يحتاج بريداً يُكرّره — ولهذا
 *  لا تأكيدَ لرافع تذكرة، ولا «نجحتَ في الاختبار» لمن قرأ نتيجته على
 *  الشاشة. والحالات الداخلية تُعرض في المنصة ولا تُبثّ.
 */

/** الأحداث التي تستدعي بريداً — ولا بريد خارج هذه القائمة */
export type NotifyEvent =
  /** دعوة للتسجيل — للمدعوّ وحده */
  | "invite.issued"
  /** اكتمل تسجيلُ مرشّحٍ واجتاز اختباره، وينتظر الاعتماد — للمعتمِد وحده */
  | "registration.awaiting_approval"
  /** لم يجتز الاختبار — له (ليعرف خطوته) ولقادة قسمه (لأنهم ينفّذون الاجتماع) */
  | "test.failed"
  /** اعتُمدت عضويته — له وحده: بطاقة الانضمام */
  | "membership.approved"
  /** تذكرة جديدة — لصاحب المرحلة الأولى وحده */
  | "ticket.created"
  /** صُعِّدت — لصاحب المرحلة الجديدة وحده */
  | "ticket.escalated"
  /** حُلّت — لرافعها وأصحاب المصلحة المعيَّنين صراحةً */
  | "ticket.resolved"
  /** تذكير يدوي — لصاحب المرحلة الحالية وحده */
  | "ticket.reminder"
  /** طلب إنهاء فترة إدارة — للمسؤول المختصّ */
  | "termination.requested"
  /** شهادة — لصاحبها وحده */
  | "certificate.issued";

export type Recipients = {
  /** البريد الذي يُرسَل إليه فعلاً */
  to: string[];
  /** لماذا هؤلاء — يُسجَّل ويُراجَع، ولا يبقى في ذهن من كتبه */
  because: string;
};

const NONE = (because: string): Recipients => ({ to: [], because });

function emails<T extends { email: string }>(rows: T[]): string[] {
  // التفرّد مقصود: من كان قائد قسمٍ وصاحبَ تذكرةٍ معاً لا تصله نسختان
  return [...new Set(rows.map((r) => r.email).filter(Boolean))];
}

async function activeByRole(role: UserRole, departmentId?: string | null) {
  return prisma.user.findMany({
    where: { role, isActive: true, ...(departmentId ? { departmentId } : {}) },
    select: { email: true },
  });
}

/** من يملك اعتماد هذا المرشّح.
 *
 *  هو نفسه من تسمح له `canManageDepartment`: قائد قسمه. فإن لم يكن
 *  لقسمه قائد — أو كان مرشّحاً قيادياً لا قسم له — فالتنفيذي، فالمؤسس.
 *  والسلسلة تنتهي عند أحد دائماً: طلبٌ لا معتمِدَ له يبقى معلّقاً أبداً. */
export async function approverFor(departmentId: string | null): Promise<Recipients> {
  if (departmentId) {
    const leads = await activeByRole("department_admin", departmentId);
    if (leads.length > 0) return { to: emails(leads), because: "قائد القسم يعتمد أعضاءه" };
  }
  const execs = await activeByRole("executive");
  if (execs.length > 0) {
    return {
      to: emails(execs),
      because: departmentId ? "لا قائد نشط للقسم — فالتنفيذي" : "مرشّح قيادي يعتمده التنفيذي",
    };
  }
  const founders = await activeByRole("super_admin");
  return { to: emails(founders), because: "لا تنفيذي نشط — فالإدارة العليا" };
}

/** أصحاب المصلحة عند حلّ تذكرة: رافعها، ومن عُيِّن صراحةً.
 *
 *  رافعُها يُخبَر دائماً — فاوندراً كان أو عضواً. وهذا ليس «بريداً
 *  تشغيلياً للفاوندر»: هو صاحب الطلب، وإخبارُه بحلّ ما طلبه هو الغرض.
 *  والفرق الذي اشتكى منه صاحب المنصة أن الفاوندر كان يُعَدّ طرفاً في كل
 *  تذكرة لأنه المؤسس — لا لأنه رفعها. فالقاعدة هنا: **الصفة لا تُدخِل
 *  أحداً، والدور في التذكرة يُدخِله.** */
export function resolvedRecipients(ticket: {
  member: { email: string } | null;
  raisedByUser: { email: string } | null;
  /** من عُيِّن صاحب مصلحة صراحةً — لا من استُنتج من رتبته */
  stakeholderEmails?: string[];
}): Recipients {
  const author = ticket.member?.email ?? ticket.raisedByUser?.email ?? "";
  const to = [...new Set([author, ...(ticket.stakeholderEmails ?? [])].filter(Boolean))];
  if (to.length === 0) return NONE("لا رافع لها ببريد");
  return { to, because: "رافع التذكرة وأصحاب المصلحة المعيَّنون" };
}

/** الحالات التي يُمنع فيها البريد مهما كان الحدث.
 *
 *  هذه ليست تحسيناً للحجم: هي وعودٌ قُطعت. من أُغلقت تجربته وُعِد بألّا
 *  نراسله بعدها، ومن عُطِّل حسابه لم يبقَ له شأن. والفلترة النهائية في
 *  `withoutClosedRecipients` داخل `send` — وهذه طبقةٌ قبلها تمنع بناء
 *  الرسالة من أصلها. */
export async function suppressed(email: string): Promise<string | null> {
  const member = await prisma.member.findFirst({
    where: { email },
    select: { noFurtherEmail: true },
  });
  if (member?.noFurtherEmail) return "أُغلقت تجربته — لا مراسلة بعد الوداع";
  return null;
}

/** الأحداث التي **لا** تُراسَل عنها أحداً — مكتوبةً لتُراجَع لا لتُنسى.
 *
 *  كل سطرٍ هنا بريدٌ كان يُرسَل أو كان سيُرسَل، ومعه سبب الامتناع. فمن
 *  يسأل غداً «لماذا لا يصل بريدٌ عند كذا؟» يجد الجواب مكتوباً بدل أن
 *  يُعيد إضافته ظانّاً أنه نُسي. */
export const DELIBERATELY_SILENT: Record<string, string> = {
  "ticket.created→author":
    "رآها على الشاشة لحظة رفعها، وتكرارها بريداً إخبارٌ لأحدٍ بما يعلمه",
  "test.passed→candidate":
    "قرأ نتيجته على الشاشة، والخبر الحقيقي هو الاعتماد — وله بريده",
  "registration.submitted→candidate":
    "لا يُراسَل وهو ينتظر الاعتماد: حالتُه معروضة في بوابته، والبريد يَعِد بما لم يُقرَّر",
  "ticket.status→author":
    "«قيد المعالجة» حالةٌ داخلية تُعرض في المنصة ولا تُبثّ بريداً",
  "ticket.reopened→author":
    "إعادة الفتح تُعرض في لوحته، ومن يُعيد الفتح يُخبره إن لزم",
  "certificate.issued→leadership":
    "الشهادة وثيقةُ صاحبها — والإدارة تراها في السجل لا في بريدها",
  "appreciation→leadership":
    "تكريمُ عضوٍ شأنه وشأن قائده في اللوحة، لا بريدٌ يُعمّم",
};
