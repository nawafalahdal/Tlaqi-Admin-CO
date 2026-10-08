import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { sendExitEmail, sendCertificateEmail, sendFarewellEmail } from "@/lib/email";
import { syncMemberLifecycleRow } from "@/lib/workflow";
import { accountRoleLabel } from "@/lib/testTracks";

/** حوكمة التنحي.
 *
 *  لا ينتهي أحد فجأة ولا يبقى معلّقاً بلا تاريخ. التنحي يُوقف العمل
 *  ويُحدِّد تاريخ الانتهاء، لكنه **لا يُغلق التجربة**: تبقى مفتوحة حتى
 *  تُسلَّم الشهادة ويُصنع الوداع. وعند اكتمالهما تُرسل رسالة الشكر
 *  الأخيرة ويتوقّف البريد نهائياً.
 *
 *  هذا الفصل بين «توقّف العمل» و«انتهاء التجربة» هو جوهر المسألة:
 *  إنهاءٌ بلا شهادة ولا وداع ليس إنهاءً منظّماً، بل انقطاعاً.
 */

/** مراحل الخروج كما تُعرض وتُسجَّل */
export type OffboardingStage =
  | "active"
  | "stepped_down"
  | "certificate_pending"
  | "farewell_pending"
  | "ready_to_close"
  | "closed";

export function offboardingStage(member: {
  stepDownAt: Date | null;
  certificateIssuedAt: Date | null;
  farewellDesignAt: Date | null;
  offboardingClosedAt: Date | null;
}): OffboardingStage {
  if (member.offboardingClosedAt) return "closed";
  if (!member.stepDownAt) return "active";
  const hasCert = Boolean(member.certificateIssuedAt);
  const hasFarewell = Boolean(member.farewellDesignAt);
  if (hasCert && hasFarewell) return "ready_to_close";
  if (!hasCert && !hasFarewell) return "stepped_down";
  return hasCert ? "farewell_pending" : "certificate_pending";
}

async function scopeOf(member: { departmentId: string | null; inviteId: string }) {
  const [dept, invite] = await Promise.all([
    member.departmentId
      ? prisma.department.findUnique({ where: { id: member.departmentId } })
      : null,
    prisma.invite.findUnique({ where: { id: member.inviteId } }),
  ]);
  return dept?.name ?? (invite ? accountRoleLabel(invite.targetRole) : "—");
}

/** تنحية عضو: يتوقّف عمله ويُحدَّد تاريخ انتهائه.
 *
 *  التاريخ مطلوب صراحةً لا مفترضاً باليوم: قد يُتَّفق على انتهاءٍ بعد
 *  أسبوع لتسليم ما بيده، وكتابته تجعل الاتفاق مُلزِماً ومسجَّلاً. */
export async function stepDownMember(opts: {
  memberId: string;
  byName: string;
  reason: string;
  endDate: Date;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await prisma.member.findUnique({ where: { id: opts.memberId } });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (member.stepDownAt) return { ok: false, reason: "تمّت تنحيته سابقاً" };

  const at = new Date();
  await prisma.member.update({
    where: { id: member.id },
    data: {
      stepDownAt: at,
      stepDownByName: opts.byName,
      endDate: opts.endDate,
      isActive: false,
      terminatedAt: at,
      exitReason: opts.reason,
    },
  });

  await sendExitEmail({ to: member.email, fullName: member.fullName, reason: opts.reason });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "تنحٍّ عن المنصب",
    roleOrDepartment: await scopeOf(member),
    details: `${opts.reason} — نفّذها ${opts.byName} — تاريخ الانتهاء ${opts.endDate.toISOString().slice(0, 10)} — التنبيهات ${member.warningsCount}/3`,
    at,
  });
  await syncMemberLifecycleRow(member.id);
  return { ok: true };
}

/** تسليم شهادة الإنهاء — خطوة من خطوتين قبل إغلاق التجربة */
export async function markCertificateShared(memberId: string, byName: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (member.certificateIssuedAt) return { ok: true as const };

  const at = new Date();
  await prisma.member.update({
    where: { id: memberId },
    data: { certificateIssuedAt: at },
  });
  await sendCertificateEmail({ to: member.email, fullName: member.fullName });
  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "تسليم شهادة الإنهاء",
    roleOrDepartment: await scopeOf(member),
    details: `سجّلها ${byName}`,
    at,
  });
  await syncMemberLifecycleRow(memberId);
  return { ok: true as const };
}

/** تصميم الوداع — الخطوة الثانية. لا يرسل بريداً: هو عملٌ يُنجَز خارج
 *  المنصة ويُسجَّل فيها، والعضو يراه حين يُنشر لا حين يُعلَّم. */
export async function markFarewellDesigned(memberId: string, byName: string) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (member.farewellDesignAt) return { ok: true as const };

  const at = new Date();
  await prisma.member.update({ where: { id: memberId }, data: { farewellDesignAt: at } });
  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "تصميم وداع",
    roleOrDepartment: await scopeOf(member),
    details: `سجّله ${byName}`,
    at,
  });
  await syncMemberLifecycleRow(memberId);
  return { ok: true as const };
}

/** إغلاق التجربة نهائياً.
 *
 *  لا يُغلق إلا بعد الشهادة والوداع معاً — وهذا الشرط هو ما يمنع أن يصير
 *  الإغلاق طريقاً مختصراً للتخلّص من السجل. وبعده يُرفع `noFurtherEmail`
 *  فلا تصل صاحبه رسالة من المنصة أبداً، لا إعلاناً ولا تذكيراً.
 *
 *  والترتيب مقصود: تُرسل رسالة الوداع **قبل** رفع العلم، وإلا حجب
 *  العلمُ الرسالةَ التي تُعلنه. */
export async function closeOffboarding(
  memberId: string,
  byName: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { invite: true, department: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (member.offboardingClosedAt) return { ok: false, reason: "التجربة مُغلقة أصلاً" };
  if (!member.stepDownAt) return { ok: false, reason: "لم تُسجَّل تنحيته بعد" };
  if (!member.certificateIssuedAt) return { ok: false, reason: "لم تُسلَّم شهادته بعد" };
  if (!member.farewellDesignAt) return { ok: false, reason: "لم يُسجَّل تصميم وداعه بعد" };

  const at = new Date();
  await sendFarewellEmail({
    to: member.email,
    fullName: member.fullName,
    roleLabel: accountRoleLabel(member.invite.targetRole),
    departmentName: member.department?.name ?? null,
    joinDate: member.joinDate,
    endDate: member.endDate ?? member.stepDownAt,
  });

  await prisma.member.update({
    where: { id: memberId },
    data: { offboardingClosedAt: at, noFurtherEmail: true },
  });

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "ختام التجربة",
    roleOrDepartment: member.department?.name ?? accountRoleLabel(member.invite.targetRole),
    details: `أُرسلت رسالة الشكر وأُغلقت التجربة — أغلقها ${byName}. لا تصله رسائل بعد اليوم.`,
    at,
  });
  await syncMemberLifecycleRow(memberId);
  return { ok: true };
}
