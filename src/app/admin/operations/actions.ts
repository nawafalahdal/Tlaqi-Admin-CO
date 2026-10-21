"use server";

import { auth } from "@/auth";
import { remindTicket } from "@/lib/tickets";
import { remindRequest } from "@/lib/workflow";
import { safeErrorMessage } from "@/lib/safeError";

import { getLocale, getDictionary } from "@/i18n/server";
function canRemind(role: string) {
  return role === "super_admin" || role === "executive" || role === "operations_officer";
}

export async function remindTicketAction(ticketId: string): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rOpsActions;
  const session = await auth();
  if (!session || !canRemind(session.user.role)) return { error: L.youAreNotAllowed };

  try {
    await remindTicket(ticketId, session.user.name ?? "مسؤول التشغيل");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function remindRequestAction(requestId: string): Promise<{ error: string | null }> {
  const L = getDictionary(await getLocale()).rOpsActions;
  const session = await auth();
  if (!session || !canRemind(session.user.role)) return { error: L.youAreNotAllowed };

  try {
    await remindRequest(requestId, session.user.name ?? "مسؤول التشغيل");
    return { error: null };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
