import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { marketingActor } from "@/lib/marketing/access";
import { readCampaignFile } from "@/lib/marketing/design";

export const runtime = "nodejs";

/** ملفاتُ وكيل التسويق (التصاميمُ والمرفقات) — لمن يرى حملتها وحده.
 *
 *  - **لا جلسة ← 401**، ومن لا يرى الحملة ← 404 (لا يُقال إن الملف موجود).
 *  - **النوعُ المُعلَن هو المُطبَّق:** `nosniff`، وأنواعُ الرفع مقيّدةٌ في الخدمة
 *    (صورُ التصميم يُقرأ نوعُها من محتواها؛ والمرفقاتُ بلا HTML ولا SVG).
 *  - **ولا يُخزَّن في وسيطٍ مشترك:** `private, no-store` — ملفُّ حملةٍ داخلي. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse(null, { status: 401 });
  const actor = await marketingActor(session);
  const { id } = await params;
  const file = actor ? await readCampaignFile(actor, id) : null;
  if (!file) return new NextResponse(null, { status: 404 });

  const inline = file.kind === "design" || file.mimeType === "application/pdf" || file.mimeType.startsWith("image/");
  const download = new URL(request.url).searchParams.get("download") === "1";
  const asciiName = file.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "tlaqi-file";
  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": `${inline && !download ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      // ملفٌّ يُفتح وحده لا يُشغّل شيئاً — ولو أفلت نوعٌ من القائمة
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
