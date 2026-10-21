"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import type { ImprovementKind, ImprovementState } from "@prisma/client";
import {
  submitImprovement,
  advanceImprovement,
  confirmImprovementFix,
} from "@/lib/improvements";

import { getLocale, getDictionary } from "@/i18n/server";
/** إجراءاتُ مركز التحسين.
 *
 *  **والجلسةُ تُقرأ هنا لا تُمرَّر:** إجراءُ الخادم بابٌ مكشوفٌ لمن يَعرف
 *  اسمَه، فلو أُخذ «من رفعها» من حقلٍ في النموذج لأمكن أن يَنسب أحدٌ
 *  ملاحظةً إلى غيره. فصاحبُ الملاحظة هو صاحبُ الجلسة، لا ما كُتب في
 *  حقلٍ خفيّ.
 */

const KINDS: readonly string[] = ["bug", "confusing", "idea"];

export type ImproveState = { error: string | null; ticketNumber?: number };

export async function submitImprovementAction(
  _prev: ImproveState,
  formData: FormData
): Promise<ImproveState> {
  const L = getDictionary(await getLocale()).rImproveActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  const kind = String(formData.get("kind") ?? "");
  if (!KINDS.includes(kind)) return { error: L.chooseTheTypeOf };

  // السياقُ يأتي من المتصفّح نصّاً، فيُحلَّل هنا ويُنظَّف في المكتبة.
  // وما تعذّر تحليلُه لا يُسقِط الملاحظة: الملاحظةُ أهمُّ من سياقها.
  let context: unknown = null;
  const raw = formData.get("context");
  if (typeof raw === "string" && raw) {
    try {
      context = JSON.parse(raw);
    } catch {
      context = null;
    }
  }

  const result = await submitImprovement({
    kind: kind as ImprovementKind,
    title: String(formData.get("title") ?? ""),
    note: String(formData.get("note") ?? ""),
    context,
    session,
  });
  if (!result.ok) return { error: result.reason };

  revalidatePath("/admin/improvements");
  return { error: null, ticketNumber: result.ticketNumber };
}

export async function advanceImprovementAction(
  _prev: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rImproveActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  const result = await advanceImprovement({
    ticketId: String(formData.get("ticketId") ?? ""),
    to: String(formData.get("to") ?? "") as ImprovementState,
    note: String(formData.get("note") ?? "") || null,
    session,
  });
  if (!result.ok) return { error: result.reason };
  revalidatePath("/admin/improvements");
  return { error: null };
}

export async function confirmImprovementAction(
  _prev: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rImproveActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  const result = await confirmImprovementFix({
    ticketId: String(formData.get("ticketId") ?? ""),
    verified: formData.get("verified") === "yes",
    note: String(formData.get("note") ?? "") || null,
    session,
  });
  if (!result.ok) return { error: result.reason };
  revalidatePath("/admin/improvements");
  revalidatePath("/member");
  revalidatePath("/admin");
  return { error: null };
}
