"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safeError";
import { brandContext, transitionItem, commentItem, activateVersion, type BrandAction } from "@/lib/brandReview";
import type { FormState } from "../committees/actions";

/** أبوابُ مركز الهوية — الصلاحيةُ والحالةُ والسجلُّ كلُّها في `lib/brandReview`، وما يأتي من النموذج مُدخَلٌ يُفحص */
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const ACTIONS = new Set(["submit", "start_review", "request_changes", "approve", "revise", "publish"]);

export async function brandTransitionAction(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const action = s(fd, "action");
    if (!ACTIONS.has(action)) return { error: "إجراءٌ غير معروف", success: false };
    const res = await transitionItem(await brandContext(await auth()), s(fd, "itemId"), action as BrandAction, s(fd, "note"));
    if (!res.ok) return { error: res.reason, success: false };
    revalidatePath("/brand-review");
    revalidatePath(`/brand-review/${s(fd, "key")}`);
    return { error: null, success: true, message: "تمّ" };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function brandCommentAction(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const res = await commentItem(await brandContext(await auth()), s(fd, "itemId"), s(fd, "note"));
    if (!res.ok) return { error: res.reason, success: false };
    revalidatePath(`/brand-review/${s(fd, "key")}`);
    return { error: null, success: true, message: "أُضيفت الملاحظة" };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function brandActivateAction(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const res = await activateVersion(await brandContext(await auth()), s(fd, "versionId"));
    if (!res.ok) return { error: res.reason, success: false };
    revalidatePath("/brand-review");
    return { error: null, success: true, message: "فُعِّلت الهوية الرسمية" };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
