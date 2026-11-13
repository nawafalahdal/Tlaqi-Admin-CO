import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyBannerToken } from "@/lib/bannerToken";
import { renderBusinessCard, renderInviteCard, renderWelcomeCard } from "@/lib/shareCards";
import { businessCardData } from "@/lib/businessCardData";
import { departmentColor } from "@/lib/departmentColor";
import { forms, gx, positionTitle, roleTitle } from "@/lib/gender";

/** sharp يحتاج Node لا Edge */
export const runtime = "nodejs";

/** صورُ المشاركة: `invite` (ملصق الدعوة) و`welcome` (بطاقة العضوية) و`business` (البطاقة الرسمية في «بطاقتي»).
 *
 *  تُولَّد حين يطلبها عميل البريد، والرابط موقَّعٌ لصاحبه بالتوقيع نفسه
 *  الذي يحرس اللوحة الترحيبية — لولاه لأمكن تخمينُ معرّفٍ وقراءةُ اسم
 *  صاحبه وقسمه ومن دعاه من صورةٍ مفتوحة. ولا جلسة هنا لأن عميل البريد
 *  لا يحملها؛ فالتوقيعُ يقوم مقامها.
 *
 *  ولا يُكتب في الصورة إلا ما في السجلّ لحظة الطلب. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string; token: string }> }
) {
  const { type, token } = await params;
  if (type !== "invite" && type !== "welcome" && type !== "business") return new NextResponse("غير موجود", { status: 404 });
  const subject = verifyBannerToken(decodeURIComponent(token));
  if (!subject) return new NextResponse("غير موجود", { status: 404 });

  try {
    let png: Buffer;
    if (type === "business") {
      // البطاقةُ الرسمية («بطاقتي») — من مصدرها الواحد الذي ترسمه رسالةُ الترحيب أيضاً
      const card = await businessCardData(subject);
      if (!card) return new NextResponse("غير موجود", { status: 404 });
      png = await renderBusinessCard(card.data);
    } else if (type === "invite") {
      // الدعوة للمرشّح وحده: له سجلُّ عضوٍ منذ لحظة دعوته
      if (subject.kind !== "member") return new NextResponse("غير موجود", { status: 404 });
      const m = await prisma.member.findUnique({
        where: { id: subject.id },
        select: {
          fullName: true,
          jobTitle: true,
          credentialsIssuedAt: true,
          createdAt: true,
          department: { select: { name: true, colorHex: true, parent: { select: { colorHex: true } } } },
          invite: { select: { targetRole: true, invitedBy: { select: { fullName: true } } } },
        },
      });
      if (!m) return new NextResponse("غير موجود", { status: 404 });
      png = await renderInviteCard({
        fullName: m.fullName,
        position: positionTitle(m.invite.targetRole, m.department?.name),
        jobTitle: m.jobTitle,
        departmentName: m.department?.name ?? null,
        colorHex: m.department ? departmentColor(m.department) : null,
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
                department: { select: { name: true, colorHex: true, parent: { select: { colorHex: true } } } },
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
                department: { select: { name: true, colorHex: true, parent: { select: { colorHex: true } } } },
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
        colorHex: s.department ? departmentColor(s.department) : null,
      });
    }
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // «حفظ البطاقة» في صفحة «بطاقتي» (`?download=اسم`): يُحفَظ الملفُّ باسمه — سمةُ `download` وحدها
        // لا يحترمها كلُّ متصفّح، والاسمُ العربي يصل بترميز RFC 5987 مع بديلٍ لاتينيّ
        ...downloadHeader(new URL(request.url).searchParams.get("download")),
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

/** ترويسةُ الحفظ باسمٍ مهذَّب — حروفٌ وأرقامٌ وشرطاتٌ فقط، وطولٌ محدود */
function downloadHeader(name: string | null): Record<string, string> {
  if (!name) return {};
  const clean = name.replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim().slice(0, 60) || "TLAQI";
  return { "Content-Disposition": `attachment; filename="TLAQI-card.png"; filename*=UTF-8''${encodeURIComponent(clean)}.png` };
}
