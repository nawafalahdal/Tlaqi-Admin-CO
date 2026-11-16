import type { UserRole, InviteTargetRole } from "@prisma/client";

/** **من يحسم أمرَ مرشّح — اعتماداً أو رفضاً أو إعادةَ فتح اختباره** (قرار المؤسس، نوفمبر 2026 — ق١ وق٢).
 *
 *  **المؤسسُ والرئيسُ التنفيذيُّ يطّلعان ولا يحسمان** — في كل منصبٍ وكل قسمٍ ولجنة، بلا استثناءٍ مبنيٍّ على المنصب
 *  ولا صلاحيةٍ احتياطية عند غياب الجهة. والاطّلاعُ صلاحيةٌ مستقلة (`canViewCandidateResults`).
 *
 *  | المرشّح                                          | يحسمه                                       |
 *  |---------------------------------------------------|---------------------------------------------|
 *  | عضوٌ في قسمٍ له قائدٌ نشط                          | قائدُ ذلك القسم                              |
 *  | عضوٌ في قسمٍ بلا قائد، أو في الإدارة العليا        | جهةُ الاعتماد المستقلة («اعتماد العضوية»)   |
 *  | مرشّحٌ لمنصبٍ قيادي (قائد قسم، تشغيل، تنفيذي)      | جهةُ الاعتماد المستقلة                       |
 *
 *  **وجهةُ الاعتماد المستقلة** من يحمل «اعتماد العضوية» في تكليفٍ نشطٍ بالإدارة العليا — ولا تسري لمؤسسٍ ولا لرئيسٍ
 *  تنفيذي ولو كُتبت لهما (`lib/candidateDecision`). فإن لم يحملها أحدٌ انتظر المرشّحُ جهتَه: لا يحسمه غيرُها.
 *
 *  والمنعُ الافتراضيّ: ما لا يرد هنا لا يحسمه أحد. */
export type DecisionAuthority = "department_lead" | "designated_approver";

/** **مرشّحٌ ينتظر قرارَ جهة الاعتماد** — اختبارُه انتهى (اجتاز أو لم يجتز) ولم يُحسم أمرُه بعد.
 *  الحذفُ النهائيُّ لسجلّه في هذه الحال **ردٌّ بطريقٍ آخر**: ينهي ترشّحه بلا قرار المخوَّل. فيُمنع على الجميع —
 *  المؤسسُ والرئيسُ التنفيذيُّ للاطّلاع وحده (قرار المؤسس ق١ والبند ١١) — ويُحسم أولاً قبولاً أو رفضاً. */
export function awaitingCandidateDecision(m: { approvalStatus: string; testStatus: string }): boolean {
  return m.approvalStatus === "pending_review" && (m.testStatus === "passed" || m.testStatus === "failed");
}
export const AWAITING_DECISION_REFUSAL =
  "هذا مرشّحٌ انتهى اختبارُه وينتظر قرارَ جهة الاعتماد — الحذفُ ليس طريقَ الرد. يحسمه المخوَّل (قبولاً أو رفضاً) أولاً";

/** جهةُ الحسم لمرشّحٍ بعينه — من منصبه وحال قسمه (قائدُه النشط، وهل هو الإدارة العليا) */
export function decisionAuthorityFor(
  candidate: { targetRole: InviteTargetRole; departmentId: string | null },
  department: { leadershipOnly: boolean; hasActiveLead: boolean } | null
): DecisionAuthority {
  if (candidate.targetRole !== "member") return "designated_approver";
  if (!candidate.departmentId || !department || department.leadershipOnly || !department.hasActiveLead) {
    return "designated_approver";
  }
  return "department_lead";
}

export type DecisionViewer = {
  role: UserRole | "member";
  departmentId?: string | null;
  /** يحمل «اعتماد العضوية» في تكليفٍ نشط — يحسبه الخادم (`lib/candidateDecision`)، ولا يُصدَّق من الواجهة */
  designatedApprover?: boolean;
};

export function canDecideCandidate(
  viewer: DecisionViewer,
  candidate: { departmentId: string | null; authority: DecisionAuthority }
): boolean {
  // اطّلاعٌ لا حسم — في كل الأحوال
  if (viewer.role === "super_admin" || viewer.role === "executive") return false;
  if (candidate.authority === "department_lead") {
    return viewer.role === "department_admin" && !!candidate.departmentId && viewer.departmentId === candidate.departmentId;
  }
  return viewer.designatedApprover === true;
}

/** **الاطّلاعُ على النتائج غيرُ الحسم:** المؤسسُ والرئيسُ التنفيذيُّ على مرشّحي الأقسام واللجان كلِّها (للمتابعة
 *  والإشراف وحدهما)، وكلُّ جهةِ حسمٍ على من تحسمهم. ولا يتغيّر بهذا اطّلاعُ بقية الأدوار. */
export function canViewCandidateResults(
  viewer: DecisionViewer,
  candidate: { departmentId: string | null; authority: DecisionAuthority }
): boolean {
  if (viewer.role === "super_admin" || viewer.role === "executive") return true;
  return canDecideCandidate(viewer, candidate);
}

/** من يدعو عضواً جديداً إلى قسم: قائدُ ذلك القسم وحده — حتى المؤسس لا يملكه مباشرة
 *  (`createMemberInviteAction`). والدورُ والقسم من الجلسة، والجلسةُ تُراجَع من القاعدة. */
export function canInviteMemberTo(
  viewer: { role: UserRole | "member"; departmentId?: string | null },
  departmentId: string
): boolean {
  return viewer.role === "department_admin" && !!departmentId && viewer.departmentId === departmentId;
}
