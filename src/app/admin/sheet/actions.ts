"use server";

import { auth } from "@/auth";
import { backfillSheets } from "@/lib/sheetBackfill";
import { safeErrorMessage } from "@/lib/safeError";

export type BackfillState = {
  error: string | null;
  counts: { lifecycle: number; tickets: number; testResults: number; events: number } | null;
};

/** تشغيل التعبئة الرجعية — الفاونڈر وحده، لأنها تكتب عشرات الأسطر في ملف
 *  حيّ يقرأه الفريق، ولا يصح أن تُشغَّل بالخطأ. */
export async function backfillSheetsAction(
  _prev: BackfillState,
  formData: FormData
): Promise<BackfillState> {
  const session = await auth();
  if (!session || session.user.role !== "super_admin") {
    return { error: "هذا الإجراء خاص بالفاونڈر فقط", counts: null };
  }

  try {
    const counts = await backfillSheets({
      includeAppendOnlyTabs: formData.get("includeEvents") === "1",
    });
    return { error: null, counts };
  } catch (err) {
    return { error: safeErrorMessage(err), counts: null };
  }
}
