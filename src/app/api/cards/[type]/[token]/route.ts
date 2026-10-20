import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyBannerToken } from "@/lib/bannerToken";
import { renderInviteCard, renderWelcomeCard } from "@/lib/shareCards";
import { forms, gx, positionTitle, roleTitle } from "@/lib/gender";

/** sharp يحتاج Node لا Edge */
export const runtime = "nodejs";

/** صورتا المشاركة: `invite` (ملصق الدعوة) و`welcome` (بطاقة العضوية).
 *
 *  تُولَّد حين يطلبها عميل البريد، والرابط موقَّعٌ لصاحبه بالتوقيع نفسه
 *  الذي يحرس اللوحة الترحيبية — لولاه لأمكن تخمينُ معرّفٍ وقراءةُ اسم
 *  صاحبه وقسمه ومن دعاه من صورةٍ مفتوحة. ولا جلسة هنا لأن عميل البريد
 *  لا يحملها؛ فالتوقيعُ يقوم مقامها.
 *
 *  ولا يُكتب في الصورة إلا ما في السجلّ لحظة الطلب. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; token: string }> }
) {
  const { type, token } = await params;
  if (type !== "invite" && type !== "welcome") return new NextResponse("غير موجود", { status: 404 });
  const subject = verifyBannerToken(decodeURIComponent(token));
  if (!subject) return new NextResponse("غير موجود", { status: 404 });

  try {
    let png: Buffer;
    if (type === "invite") {
      // الدعوة للمرشّح وحده: له سجلُّ عضوٍ منذ لحظة دعوته
      if (subject.kind !== "member") return new NextResponse("غير موجود", { status: 404 });
      const m = await prisma.member.findUnique({
        where: { id: subject.id },
        select: {
          fullName: true,
          jobTitle: true,
          credentialsIssuedAt: true,
          createdAt: true,
          department: { select: { name: true, colorHex: true } },
          invite: { select: { targetRole: true, invitedBy: { select: { fullName: true } } } },
        },
      });
      if (!m) return new NextResponse("غير موجود", { status: 404 });
      png = await renderInviteCard({
        fullName: m.fullName,
        position: positionTitle(m.invite.targetRole, m.department?.name),
        jobTitle: m.jobTitle,
        departmentName: m.department?.name ?? null,
        colorHex: m.department?.colorHex ?? null,
        invitedByName: m.invite.invitedBy?.fullName ?? null,
        issuedAt: m.credentialsIssuedAt ?? m.createdAt,
      });
    } else {
      const row =
        subject.kind === "member"
          ? await prisma.member.findUnique({
              where: { id: subject.id },
              select: {
                fullName: true,
                jobTitle: true,
                gender: true,
                decidedAt: true,
                joinDate: true,
                department: { select: { name: true, colorHex: true } },
                invite: { select: { targetRole: true } },
              },
            })
          : null;
      const user =
        subject.kind === "user"
          ? await prisma.user.findUnique({
              where: { id: subject.id },
              select: {
                fullName: true,
                jobTitle: true,
                gender: true,
                role: true,
                createdAt: true,
                department: { select: { name: true, colorHex: true } },
              },
            })
          : null;
      const s = row ?? user;
      if (!s) return new NextResponse("غير موجود", { status: 404 });
      const role = row ? row.invite.targetRole : user!.role;
      const title = roleTitle(role, s.gender, s.department?.name);
      png = await renderWelcomeCard({
        fullName: s.fullName,
        greeting: `أهلاً ${forms(s.gender).you}`,
        title: s.jobTitle?.trim() || title,
        roleTitle: role === "department_admin" ? gx(s.gender, "قائد قسم", "قائدة قسم") : title,
        joinedLabel: gx(s.gender, "انضمّ في", "انضمّت في", "تاريخ الانضمام"),
        joinedAt: row ? (row.decidedAt ?? row.joinDate) : user!.createdAt,
        departmentName: s.department?.name ?? null,
        colorHex: s.department?.colorHex ?? null,
      });
    }
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // الرابط يحمل ختمَ الإصدار (`?v=`)، فما تغيّر بعده يأخذ رابطاً جديداً
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(png.length),
      },
    });
  } catch (err) {
    console.error("تعذّر توليد صورة المشاركة:", err);
    return new NextResponse("تعذّر التوليد", { status: 500 });
  }
}
