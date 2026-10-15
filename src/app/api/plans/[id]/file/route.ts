import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { planDocFile } from "@/lib/plans";

export const runtime = "nodejs";

/** تنزيلُ مادةٍ من مركز الخطط — خلف الجلسة لا خلف تخمينِ معرّف.
 *
 *  **ولا يُفتَح هذا المسار بلا تسجيل دخول.** وثائقُ الخطة داخليةٌ
 *  للجميع **داخل** المنصة لا للعالم: ومعرّفُ `cuid` ليس حماية، هو
 *  اسمٌ فقط. فمن لا جلسةَ له يُردّ بـ401 ولا يُقال له أكثر.
 *
 *  **والنوعُ المُعلَن هو المُطبَّق:** `nosniff` يمنع المتصفّح من
 *  تخمين نوعٍ آخر لمحتوىً رُفع — ومع قائمة السماح في
 *  `@/lib/plans` (بلا HTML ولا SVG) يُغلَق بابُ تنفيذِ سكربتٍ من ملفٍّ
 *  مرفوعٍ في أصل المنصة نفسِه.
 *
 *  والـPDF والصورُ تُفتَح في التبويب (`inline`) لأن ذلك ما يُنتظَر
 *  منها، وما عداها يُنزَّل باسمه.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse("يجب تسجيل الدخول", { status: 401 });

  const { id } = await params;
  const doc = await planDocFile(id);
  if (!doc) return new NextResponse("غير موجود", { status: 404 });

  // الاسمُ العربي لا يمرّ في ترويسةٍ لاتينية: يُرسَل مُرمَّزاً بـ
  // `filename*` (RFC 5987) مع بديلٍ لاتينيٍّ للعملاء القديمة
  const asciiName = doc.fileName.replace(/[^\x20-\x7E]/g, "_") || "tlaqi-document";
  const encoded = encodeURIComponent(doc.fileName);

  return new NextResponse(new Uint8Array(doc.bytes), {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(doc.bytes.byteLength),
      "Content-Disposition": `${doc.inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
      // وثيقةٌ داخلية: لا تُحفَظ في وسيطٍ مشترك
      "Cache-Control": "private, no-store",
    },
  });
}
