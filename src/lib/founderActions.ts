import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendWelcomePack } from "@/lib/welcome";
import { syncMemberLifecycleRow } from "@/lib/workflow";

/** تصرّفات المؤسس وحده — وتُحرَس في الخادم لا بإخفاء زرّ.
 *
 *  إخفاءُ الزرّ تجميلٌ لا حماية: من يعرف اسم الإجراء يُناديه من طرفه.
 *  فكلّ دالّة هنا تتحقّق من الدور بنفسها، ولا تثق بأن من ناداها فحص.
 */

/** الحقول التي يُسمح بتصحيحها — قائمةٌ بيضاء لا سوداء.
 *
 *  لو أُخِذ اسم الحقل من الواجهة بلا حصر، أمكن تمرير `passwordHash`
 *  أو `isActive` إلى نفس التحديث. فلا يُقبل إلا ما في هذه القائمة. */
const EDITABLE_DATES = {
  orgJoinDate: "تاريخ الانضمام التنظيمي",
} as const;

export type EditableDateField = keyof typeof EDITABLE_DATES;

function assertFounder(role: string) {
  if (role !== "super_admin") throw new Error("هذا الإجراء للمؤسس وحده");
}

/** تصحيح تاريخ انضمامٍ تنظيمي.
 *
 *  **ولا يمسّ بداية التكليف الإداري.** وهذا شرطٌ صريح: من انضمّ
 *  للمنظمة سنة ٢٠٢٤ وتولّى قيادة قسمه سنة ٢٠٢٦ له تاريخان، وتصحيحُ
 *  الأول لا يُقدّم الثاني — ولو خُلطا لاستحقّ شهادة الثلاثة أشهر عن
 *  مدّةٍ لم يكن فيها قائداً. */
export async function correctMemberDate(opts: {
  memberId: string;
  field: EditableDateField;
  /** `null` يُفرِغ التاريخ — لمن سُجِّل له تاريخٌ خاطئ ولا يُعرف الصحيح */
  value: Date | null;
  note?: string | null;
  actorRole: string;
  actorId: string;
  actorName: string;
}): Promise<{ ok: true; previous: Date | null } | { ok: false; reason: string }> {
  assertFounder(opts.actorRole);
  if (!(opts.field in EDITABLE_DATES)) return { ok: false, reason: "حقل غير مسموح" };

  const member = await prisma.member.findUnique({
    where: { id: opts.memberId },
    select: { id: true, fullName: true, email: true, orgJoinDate: true, decidedAt: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };

  // تاريخٌ في المستقبل ليس تصحيحاً تاريخياً
  if (opts.value && opts.value.getTime() > Date.now()) {
    return { ok: false, reason: "تاريخ الانضمام لا يكون في المستقبل" };
  }

  const previous = member[opts.field] ?? null;
  const same =
    (previous === null && opts.value === null) ||
    (previous !== null && opts.value !== null && previous.getTime() === opts.value.getTime());
  if (same) return { ok: true, previous };

  const assignmentBefore = member.decidedAt;

  await prisma.$transaction([
    prisma.member.update({
      where: { id: opts.memberId },
      // الحقل من القائمة البيضاء وحدها، فلا يُبنى مفتاحٌ من مُدخَل حرّ
      data: { [opts.field]: opts.value } as { orgJoinDate: Date | null },
    }),
    prisma.memberDateEdit.create({
      data: {
        memberId: opts.memberId,
        field: opts.field,
        previous,
        next: opts.value,
        editedById: opts.actorId,
        editedByName: opts.actorName,
        note: opts.note?.trim() || null,
      },
    }),
  ]);

  // حارسٌ صريح: بداية التكليف لم تتحرّك
  const after = await prisma.member.findUniqueOrThrow({
    where: { id: opts.memberId },
    select: { decidedAt: true },
  });
  if ((after.decidedAt?.getTime() ?? null) !== (assignmentBefore?.getTime() ?? null)) {
    throw new Error("تصحيح تاريخ الانضمام حرّك بداية التكليف — أُلغي");
  }

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "تصحيح تاريخ",
    roleOrDepartment: EDITABLE_DATES[opts.field],
    details:
      `${EDITABLE_DATES[opts.field]}: ` +
      `${previous ? previous.toISOString().slice(0, 10) : "—"} ← ` +
      `${opts.value ? opts.value.toISOString().slice(0, 10) : "—"} — ` +
      `صحّحه ${opts.actorName}${opts.note?.trim() ? ` (${opts.note.trim()})` : ""}`,
    at: new Date(),
  });
  await syncMemberLifecycleRow(opts.memberId);

  return { ok: true, previous };
}

/** إرسال بطاقة الانضمام لعضوٍ بعينه — بقرار المؤسس.
 *
 *  لا تُنشئ حساباً ولا تُغيّر حالة عضوية ولا تُصفّر تاريخاً: ترسل
 *  الرسالة نفسها التي تصل عند الاعتماد، بالقالب نفسه ولون قسمه.
 *
 *  **ولا تُرسَل لمن عُطِّل أو انتهت تجربته:** الرسالة تحمل رابط دخول،
 *  وإرسالُه لحسابٍ مُعطَّل يَعِد بوصولٍ لا يقع — أو أسوأ، يُقرأ دعوةً
 *  للعودة لمن وُدِّع. و`sendWelcomePack` يفرض هذا أيضاً، وهذه طبقةٌ
 *  قبله تُسمّي السبب للمؤسس بدل رفضٍ غامض. */
export async function sendWelcomeToMember(opts: {
  memberId: string;
  actorRole: string;
  actorName: string;
}): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  assertFounder(opts.actorRole);

  const member = await prisma.member.findUnique({
    where: { id: opts.memberId },
    select: {
      id: true,
      fullName: true,
      email: true,
      isActive: true,
      noFurtherEmail: true,
      decidedAt: true,
      offboardingClosedAt: true,
    },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (!member.decidedAt) return { ok: false, reason: "لم يُعتمد بعد — البطاقة تصل عند الاعتماد" };
  if (member.noFurtherEmail || member.offboardingClosedAt) {
    return { ok: false, reason: "أُغلقت تجربته — الوداع وعدٌ بألّا نراسله بعده" };
  }
  if (!member.isActive) return { ok: false, reason: "الحساب غير نشط — لا يُرسَل رابط دخول لحسابٍ مُعطَّل" };

  const res = await sendWelcomePack({ kind: "member", id: opts.memberId }, "resend");
  if (!res.ok) return { ok: false, reason: res.reason };

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "إرسال بطاقة الانضمام يدوياً",
    roleOrDepartment: "بقرار المؤسس",
    details: `أرسلها ${opts.actorName}`,
    at: new Date(),
  });

  return { ok: true, to: res.to };
}
