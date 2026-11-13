import { prisma } from "@/lib/prisma";
import { roleTitle } from "@/lib/gender";
import { departmentColor } from "@/lib/departmentColor";
import { seniorDepartment, affiliationFor } from "@/lib/seniorAffiliation";
import { defaultPortrait } from "@/lib/defaultPortraits";
import { renderBusinessCard, type BusinessCardData } from "@/lib/shareCards";
import { cardFingerprint, type BannerSubject } from "@/lib/bannerToken";
import { firstName } from "@/lib/personName";

/** **بيانات البطاقة الرسمية من السجلّ** — مصدرٌ واحدٌ لرسالة الترحيب و«بطاقتي» معاً، فلا تختلف البطاقةُ بين موضعين.
 *
 *  لا يُكتب فيها إلا ما في السجلّ: الاسم، والمنصبُ كما تقوله المنصة، والمهمّةُ (المسمّى الوظيفي)، والقسمُ ولونُه
 *  (الإدارةُ العليا لأهلها، واللجنةُ بلون قسمها) — والصورةُ التي رفعها، وإلا الهيئةُ الافتراضية بجنسه (`defaultPortraits`). */

/** صورةُ الحساب المخزَّنة (`data:image/…;base64,…`) بايتاتٍ — أو `null` */
function avatarBytes(dataUrl: string | null | undefined): Buffer | null {
  const m = dataUrl ? /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl) : null;
  return m ? Buffer.from(m[2], "base64") : null;
}

/** بصمةُ ما يُرسم في البطاقة — رابطُها يتجدّد إن تغيّر شيءٌ منه، وإلا خُزِّن.
 *  من الحقول لا من الصورة نفسها: الصفحةُ تحسبها مما حمّلته دون أن تجلب بايتات الصورة */
export function businessCardVersion(parts: {
  fullName: string;
  jobTitle: string | null;
  role: string;
  departmentName: string | null;
  colorHex: string | null;
  gender: string | null;
  avatarVersion: Date | null;
}): string {
  return cardFingerprint([
    "biz1",
    parts.fullName,
    parts.jobTitle,
    parts.role,
    parts.departmentName,
    parts.colorHex,
    parts.gender,
    parts.avatarVersion?.toISOString(),
    // إضافةُ الهيئة الافتراضية لاحقاً تُجدّد بطاقاتِ من لا صورة لهم
    String(defaultPortrait(parts.gender)?.length ?? 0),
  ]);
}

export async function businessCardData(
  subject: BannerSubject
): Promise<{ data: BusinessCardData; version: string } | null> {
  const deptSelect = { select: { name: true, colorHex: true, parent: { select: { colorHex: true } } } } as const;
  let row: {
    fullName: string;
    jobTitle: string | null;
    gender: string | null;
    avatarData: string | null;
    avatarVersion: Date | null;
    role: string;
    department: { name: string; colorHex: string; parent?: { colorHex: string } | null } | null;
  } | null = null;

  if (subject.kind === "member") {
    const m = await prisma.member.findUnique({
      where: { id: subject.id },
      select: { fullName: true, jobTitle: true, gender: true, avatarData: true, avatarVersion: true, department: deptSelect, invite: { select: { targetRole: true } } },
    });
    if (m) row = { ...m, role: m.invite.targetRole };
  } else {
    const u = await prisma.user.findUnique({
      where: { id: subject.id },
      select: { fullName: true, jobTitle: true, gender: true, avatarData: true, avatarVersion: true, role: true, department: deptSelect },
    });
    if (u) {
      // الإدارةُ العليا لأهلها بدورهم — قسمٌ أصيلٌ لا أبَ له
      const senior = await seniorDepartment();
      row = { ...u, department: affiliationFor(u.role, u.department, senior ? { name: senior.name, colorHex: senior.colorHex, parent: null } : null) };
    }
  }
  if (!row) return null;

  const deptName = row.department?.name ?? null;
  const colorHex = row.department ? departmentColor(row.department) : null;
  const position = roleTitle(row.role, row.gender as never, row.role === "department_admin" ? deptName : null);
  const data: BusinessCardData = {
    fullName: row.fullName,
    position,
    task: row.jobTitle,
    departmentName: deptName,
    colorHex,
    photo: avatarBytes(row.avatarData) ?? defaultPortrait(row.gender),
  };
  const version = businessCardVersion({
    fullName: row.fullName,
    jobTitle: row.jobTitle,
    role: row.role,
    departmentName: deptName,
    colorHex,
    gender: row.gender,
    avatarVersion: row.avatarVersion,
  });
  return { data, version };
}

/** اسمُ ملفّ البطاقة حين تُحفظ أو تُرفق: `TLAQI-<الاسم الأول>.png` */
export function businessCardFileName(fullName: string): string {
  return `TLAQI-${firstName(fullName)}.png`;
}

/** البطاقةُ مرسومةً مرفقاً للبريد — أو `null` إن لم يوجد السجلّ */
export async function businessCardAttachment(subject: BannerSubject): Promise<{ filename: string; content: Buffer } | null> {
  const card = await businessCardData(subject);
  if (!card) return null;
  return { filename: businessCardFileName(card.data.fullName), content: await renderBusinessCard(card.data) };
}
