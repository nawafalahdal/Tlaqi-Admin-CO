"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { changeDepartmentLeader } from "@/lib/org/departmentLeadership";
import { terminateMembership, suspendMember, reinstateMember } from "@/lib/org/membership";
import { safeErrorMessage } from "@/lib/safeError";
import { getLocale, getDictionary } from "@/i18n/server";
import type { FormState } from "@/app/committees/actions";

/** أبوابُ قرارات الحوكمة — **ولا يُقرَّر هنا شيء:** الدورُ يُقرأ من القاعدة في `lib/org` ثانيةً،
 *  فطلبٌ مباشرٌ بجلسةِ غير المؤسس والرئيس يُرفض هناك ولو تجاوز الواجهة. */
const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

async function run(paths: string[], fn: (actorId: string) => Promise<{ ok: true } | { ok: false; reason: string }>): Promise<FormState> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { error: "سجّل الدخول أولاً", success: false };
    const res = await fn(session.user.id);
    if (!res.ok) return { error: res.reason, success: false };
    for (const p of paths) revalidatePath(p);
    return { error: null, success: true, message: getDictionary(await getLocale()).org.done };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

export async function changeLeaderAction(_p: FormState, fd: FormData): Promise<FormState> {
  const slug = s(fd, "slug");
  return run([`/admin/departments/${slug}`, `/admin/departments/${slug}/leader`, "/structure"], (actorId) =>
    changeDepartmentLeader(actorId, s(fd, "departmentId"), s(fd, "memberId"), s(fd, "reason"), s(fd, "confirm") === "1")
  );
}

export async function terminateMembershipAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "memberId");
  return run([`/admin/people/member/${id}`, `/admin/people/member/${id}/membership`, "/admin/people"], (actorId) =>
    terminateMembership(actorId, id, { reason: s(fd, "reason"), replacementMemberId: s(fd, "replacementId") || null, confirm: s(fd, "confirm") === "1" })
  );
}

export async function suspendMemberAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "memberId");
  return run([`/admin/people/member/${id}`, `/admin/people/member/${id}/membership`], (actorId) => suspendMember(actorId, id, s(fd, "reason")));
}

export async function reinstateMemberAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "memberId");
  return run([`/admin/people/member/${id}`, `/admin/people/member/${id}/membership`], (actorId) => reinstateMember(actorId, id, s(fd, "note") || null));
}
