"use server";

import { auth } from "@/auth";
import { backfillSheets } from "@/lib/sheetBackfill";
import { prepareAllTabs } from "@/lib/googleSheets";
import { safeErrorMessage } from "@/lib/safeError";

export type BackfillState = {
  error: string | null;
  counts: { lifecycle: number; adminAccounts: number; tickets: number; testResults: number; events: number } | null;
};

/** تشغيل التعبئة الرجعية — المؤسس وحده، لأنها تكتب عشرات الأسطر في ملف
 *  حيّ يقرأه الفريق، ولا يصح أن تُشغَّل بالخطأ. */
export async function backfillSheetsAction(
  _prev: BackfillState,
  formData: FormData
): Promise<BackfillState> {
  const session = await auth();
  if (!session || session.user.role !== "super_admin") {
    return { error: "هذا الإجراء خاص بالمؤسس فقط", counts: null };
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

export type PrepareState = { error: string | null; prepared: string[] | null };

/** تجهيز القوالب الأربعة منسّقةً قبل وصول أي بيانات — المؤسس وحده.
 *  آمن للتكرار: لا يُنشئ تبويباً قائماً ولا يمس تنسيقه ولا بياناته. */
export async function prepareTabsAction(): Promise<PrepareState> {
  const session = await auth();
  if (!session || session.user.role !== "super_admin") {
    return { error: "هذا الإجراء خاص بالمؤسس فقط", prepared: null };
  }
  try {
    return { error: null, prepared: await prepareAllTabs() };
  } catch (err) {
    return { error: safeErrorMessage(err), prepared: null };
  }
}
