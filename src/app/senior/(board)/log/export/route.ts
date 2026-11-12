import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { seniorContext } from "@/lib/governance/senior";
import { governanceWorkbook } from "@/lib/governance/sheets";

export const dynamic = "force-dynamic";

/** **تصديرُ الحوكمة إلى Excel** — الأوراقُ نفسُها التي في السجل الحي (الإدارة العليا، اللجان، سجل الحوكمة)
 *  من القاعدة مباشرةً. لمن له قراءةُ سجل الحوكمة وحده؛ والملفُّ لا يُخزَّن في المتصفّح. */
export async function GET() {
  const ctx = await seniorContext(await auth());
  if (!ctx.capabilities.has("governance_log_view")) return NextResponse.json({ error: "غير مصرّح" }, { status: 403 });
  const body = await governanceWorkbook();
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tlaqi-governance-${day}.xlsx"; filename*=UTF-8''${encodeURIComponent(`حوكمة-تلاقي-${day}.xlsx`)}`,
      "Cache-Control": "no-store",
    },
  });
}
