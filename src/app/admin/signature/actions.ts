"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { submitSignature, decideSignature, requestSignature } from "@/lib/signatures";
import { safeErrorMessage } from "@/lib/safeError";

import { getLocale, getDictionary } from "@/i18n/server";
async function requireSession() {
  const L = getDictionary(await getLocale()).rSigActions;
  const session = await auth();
  if (!session) throw new Error(L.youNeedToSign);
  return session;
}

/** يرفع صاحبُ الحساب توقيعه — لنفسه وحده.
 *
 *  المعرّف يُقرأ من الجلسة لا من الواجهة: لو أُخِذ منها لرفع أحدٌ توقيعاً
 *  باسم غيره، وهو انتحالٌ لا خطأ إدخال. */
export async function submitSignatureAction(imageData: string): Promise<{ error: string | null }> {
  const session = await requireSession();
  try {
    const res = await submitSignature({ userId: session.user.id, imageData });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/signature");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** اعتماد توقيعٍ أو رفضه — للمؤسس والتنفيذي، والحرس في `decideSignature` */
export async function decideSignatureAction(
  signatureId: string,
  decision: "approve" | "reject",
  note?: string
): Promise<{ error: string | null }> {
  const session = await requireSession();
  try {
    const res = await decideSignature({
      signatureId,
      decision,
      note,
      actorId: session.user.id,
      actorRole: session.user.role,
      actorName: session.user.name ?? "—",
    });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/signature");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** طلب توقيعٍ من قائدٍ لم يُعتمد له توقيع — يُعاد الطلب إن ضاع بريده */
export async function requestSignatureAction(userId: string): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rSigActions;
  const session = await requireSession();
  if (session.user.role !== "super_admin" && session.user.role !== "executive") {
    return { error: L.requestingSignaturesIsFor };
  }
  try {
    const res = await requestSignature({ userId, reason: `طلبته الإدارة (${session.user.name ?? "—"})` });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/signature");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
