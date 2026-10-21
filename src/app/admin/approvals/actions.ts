"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  requestApproval,
  decideApproval,
  resubmitApproval,
  advanceExecution,
  type ApprovalDecisionInput,
} from "@/lib/approvals";
import type { ApprovalKind } from "@prisma/client";
import { safeErrorMessage } from "@/lib/safeError";

import { getLocale, getDictionary } from "@/i18n/server";
const KINDS: ApprovalKind[] = [
  "marketing_plan",
  "financial_plan",
  "initiative",
  "resources",
  "operational",
  "other",
];

const DECISIONS: ApprovalDecisionInput[] = ["reviewing", "approved", "returned", "rejected"];

function touch() {
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/tickets");
  revalidatePath("/admin");
}

/** تعليق طلبِ اعتمادٍ على تذكرة — لصاحبها.
 *
 *  والهويّة من الجلسة لا من الواجهة: `requesterUserId` لا يُؤخَذ مُعامِلاً
 *  أبداً، وإلا رفع أحدٌ طلباً باسم غيره.
 */
export async function requestApprovalAction(
  ticketId: string,
  kind: string,
  approverUserId: string,
  chain: string[]
): Promise<{ error: string | null; done?: boolean }> {
  const L = getDictionary(await getLocale()).rApprActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  if (!KINDS.includes(kind as ApprovalKind)) return { error: L.unknownRequestType };

  try {
    const res = await requestApproval({
      ticketId,
      requesterUserId: session.user.id,
      kind: kind as ApprovalKind,
      approverUserId,
      chain,
    });
    if (!res.ok) return { error: res.reason };
    touch();
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** قرارُ المعتمِد — والتصريح يُفرض في `decideApproval` نفسها بشرطٍ في
 *  `where`، لا بفحصٍ في هذه الطبقة. */
export async function decideApprovalAction(
  ticketId: string,
  decision: string,
  note: string
): Promise<{ error: string | null; state?: string; nextApproverName?: string | null }> {
  const L = getDictionary(await getLocale()).rApprActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  if (!DECISIONS.includes(decision as ApprovalDecisionInput)) {
    return { error: L.unknownDecision };
  }

  try {
    const res = await decideApproval({
      ticketId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? "—",
      decision: decision as ApprovalDecisionInput,
      note,
    });
    if (!res.ok) return { error: res.reason };
    touch();
    return { error: null, state: res.state, nextApproverName: res.nextApproverName };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** صاحبُ الطلب يُعيده بعد التعديل */
export async function resubmitApprovalAction(
  ticketId: string,
  note: string
): Promise<{ error: string | null; done?: boolean }> {
  const L = getDictionary(await getLocale()).rApprActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  try {
    const res = await resubmitApproval({
      ticketId,
      requesterUserId: session.user.id,
      note,
    });
    if (!res.ok) return { error: res.reason };
    touch();
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** الانتقال إلى التنفيذ ثم الإكمال — لصاحب الطلب المعتمَد */
export async function advanceExecutionAction(
  ticketId: string,
  to: "executing" | "completed"
): Promise<{ error: string | null; done?: boolean }> {
  const L = getDictionary(await getLocale()).rApprActions;
  const session = await auth();
  if (!session) return { error: L.youNeedToSign };
  if (to !== "executing" && to !== "completed") return { error: L.unknownStage };
  try {
    const res = await advanceExecution({ ticketId, requesterUserId: session.user.id, to });
    if (!res.ok) return { error: res.reason };
    touch();
    return { error: null, done: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** تذاكري التي لم يُعلَّق عليها طلبُ اعتمادٍ بعد — لأُعلّقه */
export async function myTicketsWithoutApproval() {
  const session = await auth();
  if (!session) return [];
  return prisma.ticket.findMany({
    where: { raisedByUserId: session.user.id, approvalState: null, status: { not: "resolved" } },
    select: { id: true, ticketNumber: true, subject: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}
