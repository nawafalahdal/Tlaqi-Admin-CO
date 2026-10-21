"use server";

import { revalidatePath } from "next/cache";
import { avatarUrl } from "@/lib/avatarUrl";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveAvatar, clearAvatar } from "@/lib/avatars";
import { safeErrorMessage } from "@/lib/safeError";

import { getLocale, getDictionary } from "@/i18n/server";
/** رفع الصورة الشخصية — **لنفسه وحده**.
 *
 *  والهويّة تُقرأ من الجلسة لا من الحقل: لو أُخِذ `id` من الواجهة لأمكن
 *  لأيِّ عضوٍ أن يُبدّل صورة غيره في الهيكل. فلا مُعامِل هوية هنا أصلاً.
 *
 *  **وهذا ليس تعديلاً للهيكل.** الهيكل يُحسَب من المناصب والأقسام، ولا
 *  تُغيّر الصورةُ موضعَ أحدٍ فيه ولا تبعيّته — تُغيّر ما يُرى في بطاقته
 *  هو. فمنعُ تحرير الهيكل باقٍ: لا أحد يَنقل بطاقةً ولا يُعيد ترتيباً.
 *
 *  والعضو له سجلّ `Member`، والقيادي له `User`، وكلٌّ يكتب في سجلّه.
 */
export async function uploadMyAvatarAction(
  formData: FormData
): Promise<{ error: string | null; done?: boolean; bytes?: number; transparent?: boolean | null }> {
  const L = getDictionary(await getLocale()).rStructureActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: L.chooseAnImageFirst };

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const subject =
      session.user.role === "member"
        ? ({ kind: "member", id: session.user.id } as const)
        : ({ kind: "user", id: session.user.id } as const);

    const res = await saveAvatar(subject, buf);
    if (!res.ok) return { error: res.reason };

    revalidatePath("/structure");
    revalidatePath("/admin/profile");
    revalidatePath("/member");
    return { error: null, done: true, bytes: res.bytes, transparent: res.transparent };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** حذف صورته — فيعود العنصر الافتراضي في بطاقته */
export async function clearMyAvatarAction(): Promise<{ error: string | null; done?: boolean }> {
  const L = getDictionary(await getLocale()).rStructureActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };

  try {
    await clearAvatar(
      session.user.role === "member"
        ? { kind: "member", id: session.user.id }
        : { kind: "user", id: session.user.id }
    );
    revalidatePath("/structure");
    revalidatePath("/admin/profile");
    revalidatePath("/member");
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** صورتي الحالية — رابطُها لا بياناتُها.
 *
 *  كانت تُعيد data URL فيُرسَل ميجابايتٌ في جوابِ إجراءِ خادمٍ لمجرّد
 *  معاينةٍ بعد الرفع. والرابطُ يَكفي، والصورةُ في مخزَن المتصفّح أصلاً. */
export async function myAvatar(): Promise<string | null> {
  const session = await auth();
  if (!session) return null;
  const kind = session.user.role === "member" ? "member" : "user";
  const row =
    kind === "member"
      ? await prisma.member.findUnique({
          where: { id: session.user.id },
          select: { avatarVersion: true },
        })
      : await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { avatarVersion: true },
        });
  return avatarUrl(kind, session.user.id, row?.avatarVersion ?? null);
}
