import { NextResponse } from "next/server";
import { deploymentEnv } from "@/lib/deploymentEnv";
import { runAiSelfTest } from "@/lib/marketing/ai/aiSelfTest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** فحصُ Claude الحقيقي — في نشرات المعاينة وحدها (وهي خلف حماية Vercel)، بمفتاح المعاينة، برسالتين
 *  قصيرتين موسومتين «تجربة — لا تُنشر». وفي الإنتاج وأي بيئةٍ أخرى: غير موجود. لا قاعدةَ ولا كتابة. */
export async function GET() {
  if (deploymentEnv() !== "preview") return new NextResponse("Not found", { status: 404 });
  const report = await runAiSelfTest();
  return NextResponse.json(report, { status: report.ok ? 200 : 500, headers: { "cache-control": "no-store" } });
}
