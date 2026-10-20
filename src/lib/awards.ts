import { prisma } from "@/lib/prisma";
import { sendAwardEmail } from "@/lib/email";
import { appendMemberEvent } from "@/lib/googleSheets";
import { roleTitle } from "@/lib/gender";
import { accountRoleLabel } from "@/lib/testTracks";
import { appBaseUrl } from "@/lib/emailBrand";

/** التكريم على الإنجاز — من يملكه ولمن.
 *
 *  **المؤسس والتنفيذي وحدهما.** التكريم تصرّفٌ قياديٌّ يُنسَب لصاحبه،
 *  ولو ملكه كلُّ إداريٍّ لفقد معناه. وقائد القسم يرفع لأعضائه تقديرَه
 *  عبر قائده — وهذا قرارُ صاحب المنصة لا اجتهاد.
 *
 *  ويُسجَّل في السجل الحي: التكريم حدثٌ في مسيرة العضو يُرجَع إليه عند
 *  الشهادة وعند التجديد، لا رسالةً تضيع في بريد.
 */
export function canAward(role: string): boolean {
  return role === "super_admin" || role === "executive";
}

export type AwardTarget = { kind: "member" | "user"; id: string };

export async function sendAward(opts: {
  target: AwardTarget;
  achievement: string;
  award?: string | null;
  note?: string | null;
  actorRole: string;
  actorName: string;
}): Promise<{ ok: true; to: string } | { ok: false; reason: string }> {
  if (!canAward(opts.actorRole)) {
    return { ok: false, reason: "التكريم للمؤسس والرئيس التنفيذي" };
  }
  const achievement = opts.achievement.trim();
  if (achievement.length < 5) {
    return { ok: false, reason: "اكتب الإنجاز — التكريم بلا سببٍ مكتوب لا يُقرأ تكريماً" };
  }

  const person =
    opts.target.kind === "member"
      ? await prisma.member.findUnique({
          where: { id: opts.target.id },
          select: {
            fullName: true, email: true, isActive: true, noFurtherEmail: true,
            department: { select: { name: true } },
          },
        })
      : await prisma.user.findUnique({
          where: { id: opts.target.id },
          select: {
            fullName: true, email: true, isActive: true, role: true,
            department: { select: { name: true } },
          },
        });

  if (!person) return { ok: false, reason: "السجل غير موجود" };
  if (!person.isActive) return { ok: false, reason: "الحساب غير نشط" };
  if ("noFurtherEmail" in person && person.noFurtherEmail) {
    return { ok: false, reason: "أُغلقت تجربته — الوداع وعدٌ بألّا نراسله بعده" };
  }

  // المُكرِّم يُنسَب بصفته وجنسه: «الرئيسة التنفيذية» لا «الرئيس التنفيذي»
  const actor = await prisma.user.findFirst({
    where: { role: opts.actorRole as "super_admin" | "executive", isActive: true, fullName: opts.actorName },
    select: { gender: true },
  });
  const sent = await sendAwardEmail({
    to: person.email,
    fullName: person.fullName,
    achievement,
    award: opts.award ?? null,
    note: opts.note ?? null,
    fromName: opts.actorName,
    fromRole: roleTitle(opts.actorRole, actor?.gender),
    portalUrl: `${appBaseUrl()}/${opts.target.kind === "member" ? "member" : "admin"}`,
  });
  if (sent.skipped) return { ok: false, reason: "تعذّر إرسال البريد الآن" };

  await appendMemberEvent({
    fullName: person.fullName,
    email: person.email,
    event: "تكريم على إنجاز",
    roleOrDepartment: person.department?.name ?? "—",
    details:
      `${achievement}` +
      `${opts.award?.trim() ? ` — الجائزة: ${opts.award.trim()}` : ""}` +
      ` — كرّمه ${opts.actorName} (${accountRoleLabel(opts.actorRole)})`,
    at: new Date(),
  });

  return { ok: true, to: person.email };
}
