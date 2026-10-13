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

/** يُصدر شهادة التقدير لعضوٍ واحد ويُسلّمها.
 *
 *  والإصدار والتسليم ختمان كشهادة الإنهاء: يُصدَر مرّةً واحدة لهذه
 *  المناسبة، ويُعاد البريد ما لم يصل. */
export async function issueAppreciation(
  memberId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { department: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (member.appreciationSentAt) return { ok: true };

  const start = assignmentStart(member);
  if (!completedThreeMonths(start)) return { ok: false, reason: "لم يُكمل ثلاثة أشهر بعد" };

  // «كُرِّم سابقاً» ليس منعاً هنا: الختم موجودٌ وبريده لم يصل، فيُعاد
  const blocked = ineligibleReason(member);
  if (blocked && blocked !== "كُرِّم سابقاً") return { ok: false, reason: blocked };

  const at = new Date();
  const dueAt = member.appreciationDueAt ?? anniversaryDate(start, 3);
  if (!member.appreciationIssuedAt) {
    await prisma.member.update({
      where: { id: memberId },
      data: { appreciationIssuedAt: at, appreciationDueAt: dueAt },
    });
  }

  const sent = await sendAppreciationEmail({
    to: member.email,
    fullName: member.fullName,
    jobTitle: member.jobTitle,
    departmentName: member.department?.name ?? null,
    certificateUrl: certificateUrl(memberId, appBaseUrl(), "appreciation"),
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
    event: "شهادة تقدير ثلاثة أشهر",
    roleOrDepartment: member.department?.name ?? member.jobTitle ?? "—",
    details: `استحقّها ${dueAt.toISOString().slice(0, 10)} بتوقيت ${ORG_TIME_ZONE} — وصلت برابطها`,
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
