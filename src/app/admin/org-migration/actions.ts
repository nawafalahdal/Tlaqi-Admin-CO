"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { applyLegacyCase, applyAllLegacy } from "@/lib/org/legacyConversion";
import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
import { safeErrorMessage } from "@/lib/safeError";
import type { FormState } from "@/app/committees/actions";

/** تطبيقُ الترحيل — للمؤسس وحده، ودورُه يُقرأ من القاعدة في `legacyConversion` أيضاً */
async function founder() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "super_admin") return null;
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, fullName: true, role: true, isActive: true } });
  return u?.isActive && u.role === "super_admin" ? { kind: "user" as const, id: u.id, name: u.fullName } : null;
}

export async function applyLegacyCaseAction(_p: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await founder();
    if (!actor) return { error: "تطبيقُ الترحيل للمؤسس وحده", success: false };
    const res = await applyLegacyCase(actor, String(fd.get("key") ?? ""));
    revalidatePath("/admin/org-migration");
    if (!res.ok) return { error: res.reason, success: false };
    return { error: null, success: true, message: res.note ?? getDictionary(await getLocale()).org.done };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function applyAllLegacyAction(prev: FormState): Promise<FormState> {
  void prev; // واجهةُ `useActionState`: الحالةُ السابقة لا تُقرأ هنا
  try {
    const actor = await founder();
    if (!actor) return { error: "تطبيقُ الترحيل للمؤسس وحده", success: false };
    const results = await applyAllLegacy(actor);
    revalidatePath("/admin/org-migration");
    const L = getDictionary(await getLocale()).org.migration;
    const applied = results.filter((r) => r.ok && r.done === "applied").length;
    const already = results.filter((r) => r.ok && r.done === "already").length;
    const failed = results.filter((r) => !r.ok);
    const msg = fmt(L.applied, applied, already, failed.length);
    if (failed.length) return { error: `${msg} ${failed.map((f) => (f.ok ? "" : `${f.key}: ${f.reason}`)).join(" · ")}`, success: false };
    return { error: null, success: true, message: msg };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}
