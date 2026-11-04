import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendAppreciationEmail } from "@/lib/email";
import { certificateUrl } from "@/lib/certificate";
import { appBaseUrl } from "@/lib/emailBrand";
import { completedThreeMonths, anniversaryDate, ORG_TIME_ZONE } from "@/lib/anniversary";

/** مرساة عدّ الثلاثة أشهر: **بداية التكليف الإداري** لا الانضمام التنظيمي.
 *
 *  وهذا فرقٌ يُغيّر الاستحقاق. من انضمّ لتَـــلاقِ سنة ٢٠٢٤ وتولّى
 *  تكليفه سنة ٢٠٢٦ له تاريخان: الشهادة تُكرّمه على ثلاثة أشهرٍ **في
 *  تكليفه**، فلو عُدَّت من انضمامه استحقّها يوم تكليفه الأول — تكريمٌ
 *  على مدّةٍ لم يكن فيها مُكلَّفاً.
 *
 *  ولهذا لا يُقرأ `orgJoinDate` هنا أبداً: تصحيحُ المؤسس لتاريخ انضمامٍ
 *  تنظيميّ (لمن سبق المنصة) لا يجوز أن يُقدّم استحقاقاً أو يُؤخّره.
 *  و`joinDate` بديلٌ أخير لمن لا `decidedAt` له — وهو سجلٌّ قديم. */
function assignmentStart(m: { decidedAt: Date | null; joinDate: Date }): Date {
  return m.decidedAt ?? m.joinDate;
}

/** شهادة تقدير الثلاثة أشهر — تُصدر نفسها في موعدها.
 *
 *  لا تنتظر أن يفتح أحدٌ اللوحة يوم الذكرى، ولا أن يتذكّر قائدٌ تاريخ
 *  انضمام عضوه. الكنس اليومي يسأل كل يوم: من أكمل ثلاثةَ أشهرٍ ولم
 *  يُكرَّم؟ فتُصدر شهادته وتُرسل.
 *
 *  ومرساة العدّ `decidedAt` — يوم اعتماده — وإلا `joinDate`. وهي ثابتة
 *  لا تتحرّك بتعديل حقلٍ في ملفّه: تغييرُ تخصّصه أو هاتفه لا يُعيد
 *  عدّادَه إلى الصفر، وهذا شرطٌ صريح في المواصفة.
 */

/** من لا يستحقّ — ويُذكر صريحاً ليُقرأ لا ليُستنتج من شروطٍ متناثرة */
function ineligibleReason(member: {
  isActive: boolean;
  noFurtherEmail: boolean;
  stepDownAt: Date | null;
  offboardingClosedAt: Date | null;
  appreciationIssuedAt: Date | null;
}): string | null {
  if (member.appreciationIssuedAt) return "كُرِّم سابقاً";
  // من انتهت إدارته قبل الذكرى لا يُكرَّم على مدّةٍ لم يكملها فيها
  if (member.stepDownAt || member.offboardingClosedAt) return "انتهت إدارته";
  if (!member.isActive) return "حسابه غير نشط";
  // الوداع وعدٌ بألّا نراسله بعده — ولا استثناء عليه ولو كان تكريماً
  if (member.noFurtherEmail) return "أُغلقت تجربته";
  return null;
}

/** حالُ شهادة التقدير لعضوٍ واحد — تُقرأ لصفحة «الترحيب والتكريم».
 *
 *  - `sent`: صدرت ووصلت.
 *  - `undelivered`: صدرت ولم يصل بريدها — تُعاد بلا شهادةٍ ثانية.
 *  - `due`: أكمل ثلاثة أشهر ولم تصدر بعد (الكنس اليومي لم يمرّ عليه) — تُصدَر الآن.
 *  - `upcoming`: لم يحن موعدها — لا تُصدَر قبله إلا بقرارٍ إداريٍّ مكتوب.
 *  - `blocked`: لا تُصدَر له، والسببُ مكتوب. */
export type AppreciationState =
  | { kind: "sent"; at: Date }
  | { kind: "undelivered"; at: Date }
  | { kind: "due"; dueAt: Date }
  | { kind: "upcoming"; dueAt: Date }
  | { kind: "blocked"; reason: string };

export function appreciationState(
  m: {
    isActive: boolean;
    noFurtherEmail: boolean;
    stepDownAt: Date | null;
    offboardingClosedAt: Date | null;
    appreciationIssuedAt: Date | null;
    appreciationSentAt: Date | null;
    decidedAt: Date | null;
    joinDate: Date;
  },
  now = new Date()
): AppreciationState {
  if (m.appreciationSentAt) return { kind: "sent", at: m.appreciationSentAt };
  if (m.appreciationIssuedAt) return { kind: "undelivered", at: m.appreciationIssuedAt };
  const blocked = ineligibleReason(m);
  if (blocked) return { kind: "blocked", reason: blocked };
  const start = assignmentStart(m);
  const dueAt = anniversaryDate(start, 3);
  return completedThreeMonths(start, now) ? { kind: "due", dueAt } : { kind: "upcoming", dueAt };
}

/** أقصرُ قرارٍ إداريٍّ يُقبل سبباً للإصدار المبكر — لا يُكتفى بكلمة */
export const EARLY_REASON_MIN = 5;

/** يُصدر شهادة التقدير لعضوٍ واحد ويُسلّمها.
 *
 *  والإصدار والتسليم ختمان كشهادة الإنهاء: يُصدَر مرّةً واحدة لهذه
 *  المناسبة، ويُعاد البريد ما لم يصل.
 *
 *  **ويدوياً** (`by`): يُصدرها مسؤولُ المتابعة والتشغيل أو الرئيس التنفيذي
 *  أو المؤسس من صفحة «الترحيب والتكريم» دون انتظار الكنس اليومي. و**قبل
 *  موعدها** لا تصدر إلا بقرارٍ إداريٍّ مكتوب (`earlyReason`) يُسجَّل بنصّه
 *  واسم صاحبه. والمبكرةُ تُختم مدّتُها بيوم إصدارها لا بموعدٍ لم يأتِ —
 *  فلا تقول الشهادة «ثلاثة أشهر» عن مدّةٍ أقصر (`certificateHeading`). */
export async function issueAppreciation(
  memberId: string,
  by?: { name: string; earlyReason?: string | null }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { department: true, invite: { select: { targetRole: true } } },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (member.appreciationSentAt) return { ok: true };
  // شهادةُ «ثلاثة أشهر عضواً» للعضو وحده — الحكمُ نفسُه في الكنس أدناه
  if (member.invite.targetRole !== "member" || member.convertedAt) {
    return { ok: false, reason: "شهادة التقدير للأعضاء وحدهم — والقادة تُختم مسيرتهم بشهادة الشكر والخبرة" };
  }

  const start = assignmentStart(member);
  const earlyReason = by?.earlyReason?.trim() || null;
  const early = !member.appreciationIssuedAt && !completedThreeMonths(start);
  if (early && !earlyReason) return { ok: false, reason: "لم يُكمل ثلاثة أشهر بعد" };
  if (early && earlyReason!.length < EARLY_REASON_MIN) {
    return { ok: false, reason: "اكتب القرار الإداري الذي يُصدِر الشهادة قبل موعدها" };
  }

  // «كُرِّم سابقاً» ليس منعاً هنا: الختم موجودٌ وبريده لم يصل، فيُعاد
  const blocked = ineligibleReason(member);
  if (blocked && blocked !== "كُرِّم سابقاً") return { ok: false, reason: blocked };

  const at = new Date();
  const dueAt = member.appreciationDueAt ?? (early ? at : anniversaryDate(start, 3));
  if (!member.appreciationIssuedAt) {
    // الختمُ شرطيّ: ضغطتان متسابقتان لا تُصدران شهادتين
    const stamped = await prisma.member.updateMany({
      where: { id: memberId, appreciationIssuedAt: null },
      data: { appreciationIssuedAt: at, appreciationDueAt: dueAt },
    });
    if (stamped.count === 0) return { ok: false, reason: "صدرت للتوّ من نافذةٍ أخرى — حدّث الصفحة" };
    if (by) {
      // من أصدرها ومتى ولمن — يُسجَّل عند الإصدار ولو تعذّر البريد بعده
      await appendMemberEvent({
        fullName: member.fullName,
        email: member.email,
        event: early ? "إصدار شهادة تقدير مبكرة" : "إصدار شهادة تقدير",
        roleOrDepartment: member.department?.name ?? member.jobTitle ?? "—",
        details: early
          ? `قبل موعدها (${anniversaryDate(start, 3).toISOString().slice(0, 10)}) بقرارٍ إداري: «${earlyReason}» — أصدرها ${by.name}`
          : `أصدرها ${by.name} يدوياً`,
        at,
      });
    }
  }

  const sent = await sendAppreciationEmail({
    to: member.email,
    fullName: member.fullName,
    jobTitle: member.jobTitle,
    departmentName: member.department?.name ?? null,
    certificateUrl: certificateUrl(memberId, appBaseUrl(), "appreciation"),
    fullTerm: completedThreeMonths(start, dueAt),
  });

  if (sent.skipped) {
    return { ok: false, reason: "صدرت الشهادة ولم يصل بريدها — تُعاد المحاولة" };
  }

  await prisma.member.update({
    where: { id: memberId },
    data: { appreciationSentAt: at },
  });
  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: completedThreeMonths(start, dueAt) ? "شهادة تقدير ثلاثة أشهر" : "تسليم شهادة تقدير مبكرة",
    roleOrDepartment: member.department?.name ?? member.jobTitle ?? "—",
    details:
      `استحقّها ${dueAt.toISOString().slice(0, 10)} بتوقيت ${ORG_TIME_ZONE} — وصلت برابطها` +
      (by ? ` — سلّمها ${by.name}` : ""),
    at,
  });
  const { syncMemberLifecycleRow } = await import("@/lib/workflow");
  await syncMemberLifecycleRow(memberId);
  return { ok: true };
}

/** الكنس: من أكمل ثلاثةَ أشهرٍ ولم تصله شهادته.
 *
 *  يُلتقط هنا من لم يُختم له، ومن خُتم ولم يصل بريده — فالمحاولة
 *  الفاشلة تُعاد في الكنس التالي بلا شهادةٍ ثانية. */
export async function sweepThreeMonthAppreciation(): Promise<number> {
  const candidates = await prisma.member.findMany({
    where: {
      appreciationSentAt: null,
      isActive: true,
      noFurtherEmail: false,
      stepDownAt: null,
      offboardingClosedAt: null,
      // شهادةُ «ثلاثة أشهر عضواً» للعضو وحده — لا لصفِّ مرشّحٍ قياديٍّ اعتُمد،
      // ولا لقائد لجنةٍ قديمٍ حُوِّل عضواً: أشهرُه الأولى كانت قيادةً لا عضوية،
      // فلا تصله شهادةٌ مفاجئة يوم تحويله
      invite: { targetRole: "member" },
      convertedAt: null,
    },
    select: { id: true, decidedAt: true, joinDate: true },
  });

  let issued = 0;
  for (const m of candidates) {
    if (!completedThreeMonths(assignmentStart(m))) continue;
    const res = await issueAppreciation(m.id);
    if (res.ok) issued += 1;
  }
  return issued;
}
