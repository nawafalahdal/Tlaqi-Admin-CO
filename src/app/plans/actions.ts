"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  savePlanIntro,
  addPlanDoc,
  renamePlanDoc,
  movePlanDoc,
  removePlanDoc,
} from "@/lib/plans";
import { safeErrorMessage } from "@/lib/safeError";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
/** إجراءاتُ مركز الخطط.
 *
 *  والتصريحُ يُفرَض في `@/lib/plans` نفسها لا هنا: هذه أبوابٌ تُنادى من
 *  أي مكان، فالحرسُ عند الحقيقة لا عند الواجهة. وكلُّ إجراءٍ هنا
 *  يُعيد رسالةً تُقرأ — لا `throw` يبلغ حاجزَ الأخطاء العام فيُقال
 *  «تعذّر إتمام العملية» بلا سبب. */

function revalidate() {
  revalidatePath("/plans");
  revalidatePath("/admin");
  revalidatePath("/member");
}

export async function savePlanIntroAction(
  _prev: { error: string | null; success: boolean },
  formData: FormData
): Promise<{ error: string | null; success: boolean }> {
  const L = getDictionary(await getLocale()).rPlansActions;
  try {
    const session = await auth();
    if (!session) return { error: L.youNeedToSign, success: false };
    const res = await savePlanIntro({
      heading: String(formData.get("heading") ?? ""),
      intro: String(formData.get("intro") ?? ""),
      session,
    });
    if (!res.ok) return { error: res.reason, success: false };
    revalidate();
    return { error: null, success: true };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function addPlanDocAction(
  _prev: { error: string | null; success: boolean; message?: string },
  formData: FormData
): Promise<{ error: string | null; success: boolean; message?: string }> {
  const L = getDictionary(await getLocale()).rPlansActions;
  try {
    const session = await auth();
    if (!session) return { error: L.youNeedToSign, success: false };

    const upload = formData.get("file");
    // الملفُّ يُقرأ بايتاتٍ هنا لا في الطبقة الأدنى: `File` كائنُ ويب
    // لا تعرفه القاعدةُ ولا ينبغي أن تعرفه
    const file =
      upload instanceof File && upload.size > 0
        ? {
            name: upload.name,
            type: upload.type,
            bytes: new Uint8Array(await upload.arrayBuffer()),
          }
        : null;

    const res = await addPlanDoc({
      title: String(formData.get("title") ?? ""),
      note: String(formData.get("note") ?? ""),
      linkUrl: String(formData.get("linkUrl") ?? ""),
      file,
      session,
    });
    if (!res.ok) return { error: res.reason, success: false };
    revalidate();
    return { error: null, success: true, message: fmt(L.wasAddedAtThe, res.title) };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function renamePlanDocAction(
  id: string,
  title: string,
  note: string
): Promise<{ error: string | null; done?: boolean }> {
  const L = getDictionary(await getLocale()).rPlansActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  try {
    const res = await renamePlanDoc({ id, title, note, session });
    if (!res.ok) return { error: res.reason };
    revalidate();
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function movePlanDocAction(
  id: string,
  direction: "up" | "down"
): Promise<{ error: string | null; done?: boolean }> {
  const L = getDictionary(await getLocale()).rPlansActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  try {
    const res = await movePlanDoc({ id, direction, session });
    if (!res.ok) return { error: res.reason };
    revalidate();
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function removePlanDocAction(
  id: string
): Promise<{ error: string | null; done?: boolean; title?: string }> {
  const L = getDictionary(await getLocale()).rPlansActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  try {
    const res = await removePlanDoc({ id, session });
    if (!res.ok) return { error: res.reason };
    revalidate();
    return { error: null, done: true, title: res.title };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
