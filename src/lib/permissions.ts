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
/** `senior_leader`: **عضوٌ في الإدارة العليا يحسمه قائدُها** (طلبُ المؤسس، 19 نوفمبر 2026 — «الرئيسُ التنفيذي قائدُ الإدارة
 *  العليا فيعتمد أعضاءها»). المناصبُ القيادية وأعضاءُ قسمٍ بلا قائد باقون لجهة الاعتماد المستقلة. */
export type DecisionAuthority = "department_lead" | "designated_approver" | "senior_leader";

/** **مرشّحٌ ينتظر قرارَ جهة الاعتماد** — اختبارُه انتهى (اجتاز أو لم يجتز) ولم يُحسم أمرُه بعد.
 *  الحذفُ النهائيُّ لسجلّه في هذه الحال **ردٌّ بطريقٍ آخر**: ينهي ترشّحه بلا قرار المخوَّل. فيُمنع على الجميع —
 *  المؤسسُ والرئيسُ التنفيذيُّ للاطّلاع وحده (قرار المؤسس ق١ والبند ١١) — ويُحسم أولاً قبولاً أو رفضاً. */
export function awaitingCandidateDecision(m: { approvalStatus: string; testStatus: string }): boolean {
  return m.approvalStatus === "pending_review" && (m.testStatus === "passed" || m.testStatus === "failed");
}
export const AWAITING_DECISION_REFUSAL =
  "هذا المرشّح أنهى اختبارَه وما زال ينتظر قرارَ جهة اعتماده (قبولاً أو رفضاً أو إعادةَ اختبار). لحذفه الآن علّم خانةَ «أحذفه قبل حسم أمره» في نموذج الحذف (الأعضاء ← الانضمام) — ويُسجَّل الحذفُ وسببُه في سجل التدقيق.";

/** **الحذفُ النهائيُّ لسجلّات الأعضاء والمرشّحين** — للمؤسس والرئيس التنفيذي (طلبُ المؤسس، 24 نوفمبر 2026).
 *  وحذفُ الحسابات القيادية باقٍ للمؤسس وحده (`permanentlyDeleteAccount`، النوع `user`). */
export function canPurgeMembers(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "executive";
}

/** جهةُ الحسم لمرشّحٍ بعينه — من منصبه وحال قسمه (قائدُه النشط، وهل هو الإدارة العليا) */
export function decisionAuthorityFor(
  candidate: { targetRole: InviteTargetRole; departmentId: string | null },
  department: { leadershipOnly: boolean; hasActiveLead: boolean } | null
): DecisionAuthority {
  if (candidate.targetRole !== "member") return "designated_approver";
  if (candidate.departmentId && department?.leadershipOnly) return "senior_leader";
  if (!candidate.departmentId || !department || !department.hasActiveLead) {
    return "designated_approver";
  }
  return "department_lead";
}

export type DecisionViewer = {
  role: UserRole | "member";
  departmentId?: string | null;
  /** يحمل «اعتماد العضوية» في تكليفٍ نشط — يحسبه الخادم (`lib/candidateDecision`)، ولا يُصدَّق من الواجهة */
  designatedApprover?: boolean;
  /** **قائدُ الإدارة العليا الآن وهو الرئيسُ التنفيذي** — يحسبه الخادم (`isSeniorLeader`). والمؤسسُ لا يحسم ولو قادها (ق١) */
  seniorLeader?: boolean;
};

export function canDecideCandidate(
  viewer: DecisionViewer,
  candidate: { departmentId: string | null; authority: DecisionAuthority }
): boolean {
  // أعضاءُ الإدارة العليا: قائدُها (الرئيسُ التنفيذي)، أو حاملُ «اعتماد العضوية» كما كان
  if (candidate.authority === "senior_leader") {
    if (viewer.role === "super_admin") return false;
    return (viewer.role === "executive" && viewer.seniorLeader === true) || viewer.designatedApprover === true;
  }
  // وما سواهم اطّلاعٌ لا حسم للمؤسس والرئيس التنفيذي (ق١)
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
