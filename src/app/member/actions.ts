"use server";

import { auth } from "@/auth";
import { acknowledgeWarning } from "@/lib/workflow";
import { revalidatePath } from "next/cache";

export async function acknowledgeWarningAction(warningId: string) {
  const session = await auth();
  if (!session || session.user.role !== "member") throw new Error("غير مصرح");
  await acknowledgeWarning(warningId, session.user.id);
  revalidatePath("/member");
}
