import { NextResponse } from "next/server";
import { HEX_RE, tintedMarkPng } from "@/lib/brand2026/markTint";

/** sharp يحتاج Node لا Edge */
export const runtime = "nodejs";

/** علامةُ الشعار بلون القسم — للتذييل في رسائل البريد (عملاءُ البريد لا يلوّنون الصور). عامّةٌ بلا جلسة: لا تحمل
 *  إلا لوناً، ولا يُقبل إلا لونٌ سداسيٌّ صريح. وتُخزَّن مؤقتاً للأبد لأن اللون نفسُه هو المفتاح. */
export async function GET(_request: Request, { params }: { params: Promise<{ hex: string }> }) {
  const { hex } = await params;
  const clean = hex.replace(/\.png$/i, "");
  if (!HEX_RE.test(clean)) return new NextResponse("غير موجود", { status: 404 });
  try {
    const png = await tintedMarkPng(clean);
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "Content-Length": String(png.length) },
    });
  } catch (err) {
    console.error("تعذّر توليد علامة القسم:", err);
    return new NextResponse("تعذّر التوليد", { status: 500 });
  }
}
