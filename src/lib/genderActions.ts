"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseGender } from "@/lib/gender";

/** يحفظ مخاطبةَ صاحب الجلسة — له وحده.
 *
 *  لا يأخذ معرّفاً من الواجهة: كلٌّ يختار لنفسه، ولا يُعيِّن أحدٌ جنسَ
 *  أحد. وما ليس «male» أو «female» يُرفض. */
export async function setMyGenderAction(
  _prev: { saved: boolean; error: string | null },
  formData: FormData
): Promise<{ saved: boolean; error: string | null }> {
  const session = await auth();
  if (!session) return { saved: false, error: "غير مصرح" };
  const gender = parseGender(formData.get("gender"));
  if (!gender) return { saved: false, error: "اختر أحد الخيارين" };

  if (session.user.role === "member") {
    await prisma.member.update({ where: { id: session.user.id }, data: { gender } });
  } else {
    await prisma.user.update({ where: { id: session.user.id }, data: { gender } });
  }
  revalidatePath("/", "layout");
  return { saved: true, error: null };
}
