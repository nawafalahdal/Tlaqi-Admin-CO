import { NextResponse } from "next/server";
import { deploymentEnv } from "@/lib/deploymentEnv";
import { marketingArchiveStore } from "@/lib/marketing/archiveSheet";
import { runArchiveSelfTest } from "@/lib/marketing/archiveSelfTest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** فحصُ تكامل ملف أرشيف التسويق الحقيقي — في نشرات المعاينة وحدها، وعلى ملف الاختبار وحده
 *  (`MARKETING_ARCHIVE_SPREADSHEET_ID_PREVIEW`). لا قاعدةَ ولا حذف: صفوفٌ مصطنعةٌ موسومة تُكتب
 *  ثم تُقرأ وتُطابَق ويُبحث عنها (`runArchiveSelfTest`). وفي الإنتاج وأي بيئةٍ أخرى: غير موجود. */
export async function GET() {
  if (deploymentEnv() !== "preview") return new NextResponse("Not found", { status: 404 });
  const store = marketingArchiveStore();
  if (!store) return NextResponse.json({ ok: false, reason: "archive_unavailable" }, { status: 503 });
  const report = await runArchiveSelfTest(store);
  return NextResponse.json(report, { status: report.ok ? 200 : 500, headers: { "cache-control": "no-store" } });
}
