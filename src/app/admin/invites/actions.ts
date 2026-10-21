"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { deleteUnusedInvite } from "@/lib/founderActions";
import { safeErrorMessage } from "@/lib/safeError";

import { getLocale, getDictionary } from "@/i18n/server";
/** حذفُ دعوةٍ لم تُستعمَل — للمؤسس وحده، والشرطُ في `deleteUnusedInvite` */
export async function deleteUnusedInviteAction(inviteId: string): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rInvitesActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  try {
    const res = await deleteUnusedInvite({
      inviteId,
      actorRole: session.user.role,
      actorName: session.user.name ?? "—",
    });
    if (!res.ok) return { error: res.reason };
    revalidatePath("/admin/invites");
    revalidatePath("/admin/people");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
