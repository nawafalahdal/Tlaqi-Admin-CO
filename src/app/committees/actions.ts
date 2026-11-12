"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { safeErrorMessage } from "@/lib/safeError";
import { getLocale, getDictionary } from "@/i18n/server";
import { orgActor } from "@/lib/org/actor";
import type { OrgResult } from "@/lib/org/audit";
import {
  createCommittee,
  updateCommitteeDetails,
  submitCommittee,
  changeCommitteeStatus,
  restoreCommittee,
  appointCommitteeLead,
  addCommitteeMembers,
  removeCommitteeMember,
  setCommitteeResponsibility,
  proposeMembershipChange,
  decideProposal,
  appointDeputy,
  setDeputyPermission,
  revokeDeputy,
  assignMemberResponsibility,
  type CommitteeInput,
} from "@/lib/org/committeeService";
import {
  createCommitteeTask,
  updateCommitteeTaskStatus,
  updateCommitteeTask,
  scheduleCommitteeMeeting,
  cancelCommitteeMeeting,
  recordCommitteeMeeting,
  addCommitteeDecision,
  submitCommitteeReport,
  reviewCommitteeReport,
} from "@/lib/org/committeeWork";
import type { CommitteeStatus } from "@prisma/client";
import { queueGovernanceSync } from "@/lib/governance/sheets";

/** أبوابُ صفحات اللجان.
 *
 *  **ولا يُقرَّر هنا شيء:** كلُّ إجراءٍ يمرّ إلى طبقة `lib/org` التي تقرأ
 *  صاحبَ الطلب من القاعدة وتفحص صلاحيته ونطاقه وتكتب السجلّ. فما يأتي من
 *  النموذج — معرّفُ لجنةٍ أو عضوٍ أو صفة — مُدخَلٌ يُفحص، لا إذنٌ يُصدَّق. */

export type FormState = { error: string | null; success: boolean; message?: string };

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const opt = (fd: FormData, k: string) => s(fd, k).trim() || null;
/** أوقاتُ النماذج بلا منطقة تُقرأ بتوقيت الرياض — توقيتِ المنصة — لا بتوقيت الخادم */
const riyadhDateTime = (v: string | null) => (v ? `${v.length === 16 ? v + ":00" : v}+03:00` : null);
/** الاستحقاقُ بتاريخٍ وحده: آخرُ ذلك اليوم في الرياض */
const riyadhDayEnd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:00+03:00` : v);

async function actor() {
  return orgActor(await auth());
}

async function run(paths: string[], fn: () => Promise<OrgResult>): Promise<FormState> {
  try {
    const res = await fn();
    if (!res.ok) return { error: res.reason, success: false };
    for (const p of paths) revalidatePath(p);
    await queueGovernanceSync("إجراءٌ على لجنة");
    const L = getDictionary(await getLocale()).org;
    return { error: null, success: true, message: L.done };
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
}

function details(fd: FormData): CommitteeInput {
  return {
    name: s(fd, "name"),
    description: opt(fd, "description"),
    purpose: s(fd, "purpose"),
    scope: opt(fd, "scope"),
    responsibilities: opt(fd, "responsibilities"),
    expectedOutputs: opt(fd, "expectedOutputs"),
    kpis: opt(fd, "kpis"),
    kind: s(fd, "kind") === "temporary" ? "temporary" : "permanent",
    startDate: opt(fd, "startDate"),
    endDate: opt(fd, "endDate"),
  };
}

const committeePaths = (id: string) => ["/committees", `/committees/${id}`, "/structure", "/calendar"];

// ── الإنشاء والتعديل والحالة ────────────────────────────────────────

export async function createCommitteeAction(_p: FormState, fd: FormData): Promise<FormState> {
  let id: string | null = null;
  try {
    const a = await actor();
    const res = await createCommittee(a, s(fd, "departmentId"), {
      ...details(fd),
      leadMemberId: s(fd, "leadMemberId"),
      memberIds: fd.getAll("memberIds").map(String),
      submit: s(fd, "intent") === "submit",
    });
    if (!res.ok) return { error: res.reason, success: false };
    id = res.id;
    await queueGovernanceSync("إنشاء لجنة");
    revalidatePath("/committees");
    revalidatePath("/admin/departments");
  } catch (err) {
    return { error: safeErrorMessage(err), success: false };
  }
  redirect(`/committees/${id}`);
}

export async function updateCommitteeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () => updateCommitteeDetails(await actor(), id, details(fd)));
}

export async function submitCommitteeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run([...committeePaths(id), "/admin/departments"], async () => submitCommittee(await actor(), id));
}

/** استرجاعُ لجنةٍ مؤرشفة — بسببٍ مكتوب، وبلا فقدٍ لشيءٍ من سجلّها */
export async function restoreCommitteeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run([...committeePaths(id), "/admin/departments"], async () => restoreCommittee(await actor(), id, opt(fd, "note")));
}

export async function changeCommitteeStatusAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    changeCommitteeStatus(await actor(), id, s(fd, "to") as CommitteeStatus, opt(fd, "note"))
  );
}

// ── القائد والأعضاء ─────────────────────────────────────────────────

export async function appointLeadAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    appointCommitteeLead(await actor(), id, s(fd, "memberId"), opt(fd, "note"), { reassignOpenTasks: s(fd, "reassignOpenTasks") === "on" })
  );
}

export async function addMembersAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () => addCommitteeMembers(await actor(), id, fd.getAll("memberIds").map(String)));
}

export async function removeMemberAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () => removeCommitteeMember(await actor(), id, s(fd, "memberId"), opt(fd, "note")));
}

export async function committeeResponsibilityAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    setCommitteeResponsibility(await actor(), id, s(fd, "memberId"), opt(fd, "responsibility"))
  );
}

export async function proposeChangeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  const kind = s(fd, "kind");
  if (kind !== "add_member" && kind !== "remove_member" && kind !== "replace_member") {
    return { error: getDictionary(await getLocale()).org.members.proposalKind, success: false };
  }
  return run(committeePaths(id), async () =>
    proposeMembershipChange(await actor(), id, {
      kind,
      memberId: s(fd, "memberId"),
      replacementMemberId: opt(fd, "replacementMemberId"),
      note: opt(fd, "note"),
    })
  );
}

export async function decideProposalAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    decideProposal(await actor(), s(fd, "proposalId"), s(fd, "decision") === "accept", opt(fd, "note"))
  );
}

// ── العمل: المهامّ والاجتماعات والقرارات والتقارير ─────────────────────

export async function createTaskAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    createCommitteeTask(await actor(), id, {
      title: s(fd, "title"),
      description: opt(fd, "description"),
      assigneeMemberId: opt(fd, "assigneeMemberId"),
      dueAt: riyadhDayEnd(opt(fd, "dueAt")),
      priority: s(fd, "priority") || "normal",
      meetingId: opt(fd, "meetingId"),
    })
  );
}

export async function taskStatusAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run([...committeePaths(id), "/member"], async () => updateCommitteeTaskStatus(await actor(), s(fd, "taskId"), s(fd, "status")));
}

export async function updateTaskAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    updateCommitteeTask(await actor(), s(fd, "taskId"), {
      assigneeMemberId: opt(fd, "assigneeMemberId"),
      dueAt: riyadhDayEnd(opt(fd, "dueAt")),
      priority: s(fd, "priority") || undefined,
    })
  );
}

export async function scheduleMeetingAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    scheduleCommitteeMeeting(await actor(), id, {
      title: s(fd, "title"),
      startsAt: riyadhDateTime(opt(fd, "startsAt")) ?? "",
      durationMinutes: s(fd, "durationMinutes") || 60,
      location: opt(fd, "location"),
      meetingUrl: opt(fd, "meetingUrl"),
      agenda: opt(fd, "agenda"),
    })
  );
}

export async function cancelMeetingAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () => cancelCommitteeMeeting(await actor(), s(fd, "meetingId"), opt(fd, "reason")));
}

export async function recordMeetingAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  // حضورُ كل عضوٍ في حقلٍ باسم `att:<memberId>` — والخادمُ يقبل النشطين وحدهم
  const attendance: { memberId: string; status: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("att:") && typeof v === "string") attendance.push({ memberId: k.slice(4), status: v });
  }
  return run(committeePaths(id), async () =>
    recordCommitteeMeeting(await actor(), s(fd, "meetingId"), { attendance, minutes: opt(fd, "minutes") })
  );
}

export async function addDecisionAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    addCommitteeDecision(await actor(), id, { kind: s(fd, "kind"), text: s(fd, "text"), meetingId: opt(fd, "meetingId") })
  );
}

export async function submitReportAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () =>
    submitCommitteeReport(await actor(), id, {
      periodLabel: s(fd, "periodLabel"),
      summary: s(fd, "summary"),
      achievements: opt(fd, "achievements"),
      challenges: opt(fd, "challenges"),
      nextSteps: opt(fd, "nextSteps"),
    })
  );
}

export async function reviewReportAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = s(fd, "committeeId");
  return run(committeePaths(id), async () => reviewCommitteeReport(await actor(), s(fd, "reportId"), opt(fd, "note")));
}

// ── القسم: النائب والمسؤوليات ─────────────────────────────────────────

const deptPaths = ["/committees", "/structure", "/admin/departments"];

export async function appointDeputyAction(_p: FormState, fd: FormData): Promise<FormState> {
  const deptId = s(fd, "departmentId");
  const perms = fd.getAll("permissions").map(String);
  return run(deptPaths, async () => appointDeputy(await actor(), deptId, s(fd, "memberId"), perms));
}

/** صلاحيةٌ واحدة تُمنح أو تُسحب — ولكلّ تغييرٍ حدثُه في السجلّ */
export async function deputyPermissionAction(_p: FormState, fd: FormData): Promise<FormState> {
  const deptId = s(fd, "departmentId");
  return run(deptPaths, async () =>
    setDeputyPermission(await actor(), deptId, s(fd, "permission"), s(fd, "granted") === "1", opt(fd, "note"))
  );
}

export async function revokeDeputyAction(_p: FormState, fd: FormData): Promise<FormState> {
  const deptId = s(fd, "departmentId");
  return run(deptPaths, async () => revokeDeputy(await actor(), deptId, opt(fd, "note")));
}

export async function memberResponsibilityAction(_p: FormState, fd: FormData): Promise<FormState> {
  const deptId = s(fd, "departmentId");
  return run(deptPaths, async () =>
    assignMemberResponsibility(await actor(), deptId, s(fd, "memberId"), opt(fd, "responsibility"))
  );
}
