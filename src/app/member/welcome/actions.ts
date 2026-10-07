"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncMemberLifecycleRow } from "@/lib/workflow";
import { appendMemberEvent } from "@/lib/googleSheets";
import { ROLE_LABELS } from "@/lib/testTracks";
import { safeErrorMessage } from "@/lib/safeError";

/** يسجّل بيانات المرشّح قبل بدء اختباره.
 *
 *  البيانات تُكتب في الشيت فور حفظها، لا بعد الاختبار ولا بعد الاعتماد:
 *  من يرسب أو تسقط مهلته يبقى سجله كاملاً، وهذا هو الفرق بين سجل حوكمة
 *  وقائمة ناجحين. */
export async function saveCandidateProfileAction(
  _prev: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session || session.user.role !== "member") return { error: "غير مصرح" };

  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const specialization = String(formData.get("specialization") ?? "").trim();
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();
  const section = String(formData.get("section") ?? "").trim();

  if (!fullName || !phone || !specialization || !jobTitle) {
    return { error: "الاسم ورقم الجوال والتخصص والمسمى الوظيفي مطلوبة" };
  }

  try {
    const member = await prisma.member.update({
      where: { id: session.user.id },
      data: {
        fullName,
        phone,
        specialization,
        jobTitle,
        section: section || null,
        profileCompletedAt: new Date(),
      },
      include: { department: true, invite: true },
    });

    await appendMemberEvent({
      fullName: member.fullName,
      email: member.email,
      roleOrDepartment:
        member.department?.name ?? (ROLE_LABELS[member.invite.targetRole] ?? "—"),
      event: "استكمال البيانات قبل الاختبار",
      details: `التخصص: ${specialization} — المسمى: ${jobTitle}${section ? ` — Section: ${section}` : ""}`,
      at: new Date(),
    });

    await syncMemberLifecycleRow(member.id);
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }

  redirect("/member/test");
}
