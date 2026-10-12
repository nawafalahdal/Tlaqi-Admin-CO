import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { verifyBannerToken } from "@/lib/bannerToken";
import { renderWelcomeBanner, STATIC_BANNER_PATH } from "@/lib/welcomeBanner";

/** sharp يحتاج Node لا Edge: الأخير بلا وصولٍ للملفات ولا مكتباتٍ أصلية */
export const runtime = "nodejs";

/** اللوحة المتحرّكة المُخصَّصة — تُولَّد حين يطلبها عميل البريد.
 *
 *  لم تُولَّد عند الإرسال ثم تُخزَّن لأن لا مخزن ملفّاتٍ في هذه المنصة.
 *  وتوليدُها عند الطلب لا يُكلّف مرّتين: الرابط ثابتٌ لصاحبه ومحتواه لا
 *  يتبدّل، فيُعلَن `immutable` — وGmail يُمرّر الصور عبر وسيطه ويحفظها،
 *  فتُولَّد فعلياً مرّةً واحدة لكل عضو.
 *
 *  والرابط موقَّع: لولا التوقيع لأمكن تخمينُ معرّفٍ وقراءةُ اسم صاحبه
 *  ومسمّاه وقسمه من صورةٍ مفتوحة. والرابط يُفتح بلا تسجيل دخول لأن
 *  عميل البريد لا يحمل جلسة — فالتوقيع هو ما يقوم مقامها.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const verified = verifyBannerToken(decodeURIComponent(token));
  if (!verified) return new NextResponse("غير موجود", { status: 404 });

  const member =
    verified.kind === "member"
      ? await prisma.member.findUnique({
          where: { id: verified.id },
          include: { department: true },
        })
      : null;
  const user =
    verified.kind === "user"
      ? await prisma.user.findUnique({
          where: { id: verified.id },
          include: { department: true },
        })
      : null;

  const subject = member ?? user;
  if (!subject) return new NextResponse("غير موجود", { status: 404 });

  const data = {
    fullName: subject.fullName,
    role: subject.jobTitle ?? null,
    team: subject.department?.name ?? null,
    colorHex: subject.department?.colorHex ?? null,
  };

  try {
    const gif = await renderWelcomeBanner(data);
    return new NextResponse(new Uint8Array(gif), {
      headers: {
        "Content-Type": "image/gif",
        // ثابتٌ لصاحبه: يُحفَظ سنةً ولا يُعاد توليده عند كل فتحة
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(gif.length),
      },
    });
  } catch (err) {
    // لا رسالةٌ بصورةٍ مكسورة: تُرجَع اللوحة الأصلية بلا اسم. والاسم
    // والمسمّى والقسم مكتوبون في متن الرسالة نصّاً حيّاً، فلا تُفقَد
    // المعلومة — تُفقَد زينتها فقط.
    console.error("تعذّر توليد اللوحة الترحيبية:", err);
    try {
      const fallback = readFileSync(join(process.cwd(), "public", STATIC_BANNER_PATH));
      return new NextResponse(new Uint8Array(fallback), {
        headers: {
          "Content-Type": "image/gif",
          // البديل لا يُحفَظ طويلاً: لعلّ العطب يُصلَح فتصل اللوحة الصحيحة
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch {
      return new NextResponse("تعذّر التوليد", { status: 500 });
    }
  }
}
