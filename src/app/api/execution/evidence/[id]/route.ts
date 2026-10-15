import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { submissionEvidence } from "@/lib/tasks";
import { canReviewWork, canPlanDepartment } from "@/lib/execution";

export const runtime = "nodejs";

/** دليلُ تسليمٍ مرفوع — ولمن يحقّ له وحده.
 *
 *  **والصلاحيةُ تُفحَص على المهمّة لا على وجود الجلسة:** الدليلُ قد
 *  يحمل عملاً داخلياً لا يخصّ كلَّ عضو. فيُقرأ لمن يُراجِع، ولقائد
 *  القسم، ولصاحب المهمّة نفسِه — ولا أحدَ سواهم، ولو خمّن المعرّف.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return new NextResponse("يجب تسجيل الدخول", { status: 401 });

  const { id } = await params;
  const doc = await submissionEvidence(id);
  if (!doc) return new NextResponse("غير موجود", { status: 404 });

  const task = await prisma.planTask.findUnique({
    where: { id: doc.taskId },
    select: { ownerUserId: true, ownerMemberId: true, departmentId: true },
  });
  if (!task) return new NextResponse("غير موجود", { status: 404 });

  const mine =
    (task.ownerUserId && task.ownerUserId === session.user.id) ||
    (task.ownerMemberId && task.ownerMemberId === session.user.id);
  const allowed =
    canReviewWork(session.user.role) ||
    Boolean(mine) ||
    (task.departmentId ? canPlanDepartment(session, task.departmentId) : false);
  if (!allowed) return new NextResponse("لا تملك قراءة هذا الدليل", { status: 403 });

  const ascii = doc.fileName.replace(/[^\x20-\x7E]/g, "_") || "evidence";
  return new NextResponse(new Uint8Array(doc.bytes), {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(doc.bytes.byteLength),
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
