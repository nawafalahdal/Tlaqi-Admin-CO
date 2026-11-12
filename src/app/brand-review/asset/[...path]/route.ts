import { readFile } from "node:fs/promises";
import { join, resolve, sep, extname } from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { brandContext } from "@/lib/brandReview";

export const dynamic = "force-dynamic";

/** **أصولُ الهوية الجديدة قبل اعتمادها** — تُخدَم لمركز المراجعة وحده (بجلسةٍ وصلاحية)، لا علناً:
 *  الخطُّ رخصتُه لم تُؤكَّد (ق1)، والهويةُ لا تُنشر قبل اعتماد المؤسس. والمسارُ محصورٌ في مجلّد الحزمة،
 *  والامتداداتُ ثلاثة. */
const ROOT = resolve(process.cwd(), "brand-assets/2026");
const TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".otf": "font/otf" };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const ctx = await brandContext(await auth());
  if (!ctx.canView) return new NextResponse("غير مصرّح", { status: 403 });
  const { path } = await params;
  if (!path?.length || path.some((p) => !/^[A-Za-z0-9._-]+$/.test(p) || p.startsWith("."))) return new NextResponse("غير موجود", { status: 404 });
  const file = resolve(join(ROOT, ...path));
  const type = TYPES[extname(file).toLowerCase()];
  if (!file.startsWith(ROOT + sep) || !type) return new NextResponse("غير موجود", { status: 404 });
  try {
    const body = await readFile(file);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=600",
        "X-Content-Type-Options": "nosniff",
        ...(type === "image/svg+xml" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
      },
    });
  } catch {
    return new NextResponse("غير موجود", { status: 404 });
  }
}
