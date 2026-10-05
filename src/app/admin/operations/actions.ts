"use server";

import { auth } from "@/auth";
import { remindTicket } from "@/lib/tickets";
import { remindRequest } from "@/lib/workflow";
import { safeErrorMessage } from "@/lib/safeError";

function canRemind(role: string) {
  return role === "super_admin" || role === "executive" || role === "operations_officer";
}

export async function remindTicketAction(ticketId: string): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session || !canRemind(session.user.role)) return { error: "غير مصرح لك بهذا الإجراء" };

  try {
    await remindTicket(ticketId, session.user.name ?? "مسؤول التشغيل");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function remindRequestAction(requestId: string): Promise<{ error: string | null }> {
  const session = await auth();
  if (!session || !canRemind(session.user.role)) return { error: "غير مصرح لك بهذا الإجراء" };

  try {
    await remindRequest(requestId, session.user.name ?? "مسؤول التشغيل");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
