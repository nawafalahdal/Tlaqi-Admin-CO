import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { renderInviteCard, type InviteCardData } from "@/lib/shareCards";
import { departmentColor } from "@/lib/departmentColor";
import { positionTitle } from "@/lib/gender";
import type { EmailAttachment } from "@/lib/emailCapture";

/** **ملصقُ الدعوة — مصدرٌ واحد** لمسار الصورة (`/api/cards/invite/…`) ولرسالة الدعوة نفسها.
 *
 *  **ورسالةُ الدعوة تحمله مضمّناً (`cid:`) لا رابطاً خارجياً** (طلب المؤسس، نوفمبر 2026): كان الملصقُ رابطاً إلى المنصة،
 *  فكلُّ عارضٍ يحجب الصورَ الخارجية — Outlook افتراضياً، وApple Mail بلا «تحميل المحتوى البعيد»، وعارضُ الملفات في التطبيقات —
 *  يرسم مكانه مربّعاً فارغاً؛ السببُ نفسُه الذي أفرغ شعارَ التذييل. فيُرسم وقتَ الإرسال من البيانات نفسها ويُرفق كالبطاقة. */
export const INVITE_CONTENT_ID = "tlaqi-invite";
/** عرضُه في الرسالة (والصورةُ بضعفه لشاشات الجوال) — نسبةُ الملصق 4:5 */
export const INVITE_INLINE_WIDTH = 360;
export const INVITE_INLINE_HEIGHT = 450;

export async function inviteCardData(memberId: string): Promise<InviteCardData | null> {
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      fullName: true,
      jobTitle: true,
      credentialsIssuedAt: true,
      createdAt: true,
      department: { select: { name: true, colorHex: true, parent: { select: { colorHex: true } } } },
      invite: { select: { targetRole: true, invitedBy: { select: { fullName: true } } } },
    },
  });
  if (!m) return null;
  return {
    fullName: m.fullName,
    position: positionTitle(m.invite.targetRole, m.department?.name),
    jobTitle: m.jobTitle,
    departmentName: m.department?.name ?? null,
    colorHex: m.department ? departmentColor(m.department) : null,
    invitedByName: m.invite.invitedBy?.fullName ?? null,
    issuedAt: m.credentialsIssuedAt ?? m.createdAt,
  };
}

/** الملصقُ مرفقاً مضمّناً للرسالة — وإن تعذّر رسمُه تصل الدعوةُ بلا صورة (لا صورةَ مكسورة)، ولا يُوقف الرسمُ الدعوةَ نفسها */
export async function inviteCardAttachment(memberId: string): Promise<EmailAttachment | null> {
  try {
    const data = await inviteCardData(memberId);
    if (!data) return null;
    const png = await renderInviteCard(data);
    const content = await sharp(png).resize({ width: INVITE_INLINE_WIDTH * 2 }).png({ compressionLevel: 9 }).toBuffer();
    return { filename: "TLAQI-invitation.png", content, contentId: INVITE_CONTENT_ID };
  } catch (err) {
    console.error("تعذّر رسمُ ملصق الدعوة للبريد — تُرسَل الدعوة بلا صورة:", err);
    return null;
  }
}
