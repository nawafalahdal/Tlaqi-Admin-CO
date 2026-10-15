import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** الصورةُ الشخصية — تُطلَب مرّةً وتُخزَّن في المتصفّح.
 *
 *  **العطبُ الذي أنشأ هذا المسار، مقيساً لا مُخمَّناً:** الصور كانت
 *  تُرسَل data URL داخل صفحةِ الهيكل نفسِها. فقِستُ الصفحة على بناء
 *  إنتاج: ٣١٩٩ ك.ب، منها **٢٤٥٧ ك.ب وثيقةٌ واحدة** — وصورةٌ واحدةٌ في
 *  القاعدة بـ١٢٠٥ ك.ب. ومعنى ذلك أن كل فتحةٍ للهيكل تُعيد تحميل الصور
 *  كاملةً، ولا يَنفع فيها مخزَنُ المتصفّح لأنها ليست موارد أصلاً.
 *
 *  فصارت مورداً: الصفحةُ تَحمل رابطاً، والصورةُ تُطلَب مرّةً ثم تُقرأ
 *  من المخزَن. والختمُ في الرابط (`?v=`) يَجعل الجوابَ `immutable`:
 *  يُخزَّن سنةً، ومتى استُبدلت الصورةُ تغيّر الختمُ فتغيّر الرابط.
 *
 *  **والحرسُ قائم:** لا تُفتَح بلا جلسة. والهيكلُ يُعرَض لكل من في
 *  المنصة، فصورةُ من فيه تُعرَض لمن فيها — وهذا ما كان يجري حين كانت
 *  مدموجةً في الصفحة، فلا توسيعَ لدائرةِ من يَرى. ومن لا جلسةَ له يُردّ
 *  بـ401، ولا يُفرَّق في الجواب بين معرّفٍ لا وجودَ له ومعرّفٍ لا صورةَ
 *  له: التفريقُ يُخبر من يُجرّب المعرّفات أيُّها قائم.
 *
 *  **و`private` لا `public`:** صورةُ شخصٍ بعينه لا تُحفَظ في وسيطٍ
 *  مشترك يَخدم منها غيرَ صاحب الجلسة.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse("يجب تسجيل الدخول", { status: 401 });

  const { kind, id } = await params;
  if (kind !== "member" && kind !== "user") {
    return new NextResponse("غير موجود", { status: 404 });
  }

  const row =
    kind === "member"
      ? await prisma.member.findUnique({ where: { id }, select: { avatarData: true } })
      : await prisma.user.findUnique({ where: { id }, select: { avatarData: true } });

  const dataUrl = row?.avatarData;
  if (!dataUrl) return new NextResponse("غير موجود", { status: 404 });

  // المخزَّن data URL (كما تُخزَّن التواقيع)، فيُقشَر إلى بايتات.
  // وما لم يكن بالصيغة المنتظَرة لا يُخمَّن له نوع.
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return new NextResponse("غير موجود", { status: 404 });
  const bytes = Buffer.from(match[2], "base64");

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": match[1],
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
