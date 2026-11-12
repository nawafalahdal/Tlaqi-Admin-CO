/** **مصفوفةُ الصلاحيات (RBAC) — المرجعُ الموثَّق لما يُنفَّذ فعلاً.**
 *
 *  ليست مصدرَ القرار: القرارُ في الخادم والقاعدة (الدالةُ المذكورة في `enforcedBy` لكل صف، والقيودُ في
 *  `prisma/migrations/…_governance_restructure`). وهذه المصفوفةُ تصفه كما هو، وتُعرض في «سجل الحوكمة»،
 *  ويطابقها فحصٌ آلي (`scripts/check-permission-matrix.ts`) بالدوال نفسها — فلا وثيقةَ تَعِد بما لا يُنفَّذ.
 *
 *  - `yes`: يملكها صاحبُ الدور.  `scoped`: في نطاقه وحده (قسمُه، لجنتُه، نفسُه).  `cond`: بشرطٍ مكتوب في `note`.
 *  - `no`: مرفوضةٌ في الخادم (والمحاولةُ المرفوضة للإجراء الحساس تُسجَّل بنتيجة «مرفوضة»). */

export type Grant = "yes" | "scoped" | "cond" | "no";

export const MATRIX_ROLES = [
  { key: "founder", label: "المؤسس" },
  { key: "ceo", label: "الرئيس التنفيذي" },
  { key: "ops", label: "مسؤول التشغيل" },
  { key: "deptLead", label: "قائد القسم" },
  { key: "deputy", label: "نائب قائد القسم" },
  { key: "committeeLead", label: "قائد اللجنة" },
  { key: "seniorHolder", label: "عضو الإدارة العليا (بتكليف)" },
  { key: "member", label: "العضو" },
] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number]["key"];

export type MatrixRow = {
  area: string;
  action: string;
  grants: Record<MatrixRole, Grant>;
  note?: string;
  enforcedBy: string;
};

const all = (g: Grant): Record<MatrixRole, Grant> => ({ founder: g, ceo: g, ops: g, deptLead: g, deputy: g, committeeLead: g, seniorHolder: g, member: g });
const g = (o: Partial<Record<MatrixRole, Grant>>): Record<MatrixRole, Grant> => ({ ...all("no"), ...o });

export const PERMISSION_MATRIX: MatrixRow[] = [
  // ── القيادة
  {
    area: "القيادة",
    action: "قيادةُ الإدارة العليا",
    grants: g({ ceo: "yes", founder: "cond" }),
    note: "قائدٌ فعليٌّ واحد: الرئيسُ التنفيذي النشط، وإلا المؤسسُ بالخلافة آلياً — وكلُّ انتقالٍ مسجَّل",
    enforcedBy: "lib/governance/leadership.ts › reconcileSeniorLeadership + قيد User_single_active_executive",
  },
  {
    area: "القيادة",
    action: "تعيينُ رئيسٍ تنفيذي (دعوةٌ ثم اعتماد)",
    grants: g({ founder: "yes" }),
    note: "مقعدٌ واحدٌ في القاعدة؛ محاولةُ رئيسٍ ثانٍ ترفضها القاعدة ولو تزامنت",
    enforcedBy: "lib/workflow.ts › finishLeadershipPromotion + قيد User_single_active_executive",
  },
  {
    area: "القيادة",
    action: "تنحيةُ حسابٍ قياديّ",
    grants: g({ founder: "yes", ceo: "cond" }),
    note: "الرئيسُ لا يُنحّي المؤسسَ ولا نفسَه؛ والقيادةُ تنتقل آلياً بعدها",
    enforcedBy: "lib/workflow.ts › removeLeadershipUser",
  },
  // ── الإدارة العليا
  {
    area: "الإدارة العليا",
    action: "عرضُ لوحة الإدارة العليا",
    grants: g({ founder: "yes", ceo: "yes", ops: "yes", seniorHolder: "yes" }),
    enforcedBy: "lib/governance/senior.ts › seniorContext (board_view)",
  },
  {
    area: "الإدارة العليا",
    action: "دعوةُ عضوٍ وتحديدُ مسمّاه وصلاحياته",
    grants: g({ ceo: "cond", founder: "cond" }),
    note: "لقائد الإدارة العليا الفعلي وحده (الرئيس، أو المؤسس حين يقود بالخلافة)",
    enforcedBy: "lib/governance/senior.ts › requireLeader",
  },
  {
    area: "الإدارة العليا",
    action: "تعديلُ تكليفٍ أو صلاحياته / إيقافُه / إنهاؤه",
    grants: g({ ceo: "cond", founder: "cond" }),
    note: "للقائد الفعلي — ولا يعدّل أحدٌ تكليفَه هو؛ والصلاحياتُ من قائمةٍ مضبوطة بلا صلاحيةٍ قيادية",
    enforcedBy: "lib/governance/senior.ts › updateSeniorPosition / setSeniorPositionStatus",
  },
  {
    area: "الإدارة العليا",
    action: "قبولُ الدعوة",
    grants: g({ seniorHolder: "scoped", member: "scoped", deptLead: "scoped", ops: "scoped" }),
    note: "صاحبُ البريد المدعوّ وحده، برابطٍ لمرّةٍ واحدة؛ ولا يقبلها حسابُ المؤسس أو الرئيس",
    enforcedBy: "lib/governance/senior.ts › acceptSeniorInvitation",
  },
  // ── اللجان
  {
    area: "اللجان",
    action: "إنشاءُ لجنة (اقتراح) — بقائدٍ أو بلا قائد",
    grants: g({ deptLead: "scoped", deputy: "cond", ceo: "cond", founder: "cond" }),
    note: "قائدُ القسم لقسمه، ونائبُه بتفويض؛ ولجانُ الإدارة العليا لقائدها الفعلي",
    enforcedBy: "lib/org/actor.ts › canProposeCommitteesOf",
  },
  {
    area: "اللجان",
    action: "اعتمادُ لجنة",
    grants: g({ ceo: "yes", founder: "yes" }),
    note: "لا يعتمد أحدٌ اقتراحَه — إلا المرجعيةَ الوحيدة (المؤسس يقود ولا معتمِدَ غيرُه)، صراحةً ومسجَّلة",
    enforcedBy: "lib/committees.ts › decideCommittee",
  },
  {
    area: "اللجان",
    action: "تعيينُ قائدٍ لها (ولو لاحقاً، ولو مؤرشفة)",
    grants: g({ deptLead: "scoped", deputy: "cond", ceo: "cond", founder: "cond" }),
    note: "لا يُستبدل قائدٌ نشطٌ معتمد؛ والرئيسُ والمؤسس حين يخلو مقعدُ قائد القسم",
    enforcedBy: "lib/org/committeeService.ts › appointCommitteeLead",
  },
  {
    area: "اللجان",
    action: "إضافةُ أعضاء / إزالتُهم",
    grants: g({ deptLead: "scoped", deputy: "cond", committeeLead: "cond", ceo: "cond", founder: "cond" }),
    note: "من أعضاء القسم المعتمَدين؛ وقائدُ اللجنة يقترح فيعتمد قائدُ القسم؛ ولا يُخرَج القائدُ قبل بديله",
    enforcedBy: "lib/org/committeeService.ts › addCommitteeMembers / removeCommitteeMember / proposeMembershipChange",
  },
  {
    area: "اللجان",
    action: "تعديلُ بياناتها",
    grants: g({ deptLead: "scoped", deputy: "cond", ceo: "cond", founder: "cond" }),
    note: "ما لم تُغلق أو تُؤرشف",
    enforcedBy: "lib/org/committeeService.ts › updateCommitteeDetails",
  },
  {
    area: "اللجان",
    action: "أرشفتُها / إغلاقُها / تعليقُها",
    grants: g({ deptLead: "scoped", deputy: "cond", ceo: "cond", founder: "cond" }),
    note: "بسببٍ مكتوب، وبانتقالاتٍ معرَّفة (STATUS_TRANSITIONS)؛ والأرشفةُ ليست حذفاً",
    enforcedBy: "lib/org/committeeService.ts › changeCommitteeStatus",
  },
  {
    area: "اللجان",
    action: "استرجاعُها",
    grants: g({ deptLead: "scoped", deputy: "cond", ceo: "cond", founder: "cond" }),
    note: "بسببٍ مكتوب، بلا فقد؛ وبلا قائدٍ نشط تعود «بانتظار تعيين قائد»",
    enforcedBy: "lib/org/committeeService.ts › restoreCommittee",
  },
  {
    area: "اللجان",
    action: "حذفُ لجنة",
    grants: all("no"),
    note: "لا حذف — الأرشفةُ بديلُه، والسجلّ يبقى",
    enforcedBy: "لا دالةَ حذفٍ للجان في الخادم",
  },
  {
    area: "اللجان",
    action: "مهامُ اللجنة واجتماعاتُها وقراراتُها وتقاريرُها",
    grants: g({ committeeLead: "scoped", deptLead: "scoped", deputy: "cond", member: "cond" }),
    note: "في اللجنة العاملة وحدها؛ والعضوُ في مهامه واجتماعاته",
    enforcedBy: "lib/org/committeeWork.ts",
  },
  // ── السجلّ
  {
    area: "سجل الحوكمة",
    action: "قراءتُه",
    grants: g({ founder: "yes", ceo: "yes", ops: "yes", seniorHolder: "cond" }),
    note: "لصاحب التكليف بصلاحية «سجل الحوكمة»",
    enforcedBy: "app/senior/log › seniorContext (governance_log_view)",
  },
  {
    area: "سجل الحوكمة",
    action: "تعديلُه أو حذفُه",
    grants: all("no"),
    note: "مرفوضٌ في القاعدة نفسها (APPEND_ONLY) — لأي حسابٍ وأي أداة",
    enforcedBy: "قيد tlaqi_append_only على OrgAuditEvent",
  },
  // ── الاتفاقيات
  {
    area: "الاتفاقيات",
    action: "قراءةُ اتفاقيته وتوقيعُها وتنزيلُ نسخته",
    grants: all("scoped"),
    enforcedBy: "lib/governance/agreements.ts › signAgreement",
  },
  {
    area: "الاتفاقيات",
    action: "إصدارُ نسخةٍ جديدة / طلبُ التوقيع وإعادتُه / مراجعةُ البلاغات",
    grants: g({ founder: "yes", ceo: "yes", seniorHolder: "cond" }),
    note: "لصاحب التكليف بصلاحية «الاتفاقيات (إدارة)»؛ والبلاغُ يُراجعه إنسان ولا حكمَ آلي",
    enforcedBy: "lib/governance/agreements.ts › requireAgreementsManager",
  },
  {
    area: "الاتفاقيات",
    action: "تعديلُ توقيعٍ أو حذفُه",
    grants: all("no"),
    note: "مرفوضٌ في القاعدة (APPEND_ONLY)؛ والنسخةُ المنشورة مجمَّدة",
    enforcedBy: "قيود tlaqi_append_only و AgreementTemplate_frozen",
  },
  // ── الحسابات
  {
    area: "الحسابات",
    action: "تغييرُ دوره هو أو رفعُ صلاحياته",
    grants: all("no"),
    enforcedBy: "لا مسارَ في الخادم يعدّل دورَ صاحبه؛ وتعديلُ التكليف لغير صاحبه",
  },
  {
    area: "الحسابات",
    action: "حذفُ قسم",
    grants: g({ founder: "cond" }),
    note: "فارغاً إلا من قائده؛ والأرشفةُ لما فيه سجلّ",
    enforcedBy: "lib/departments.ts",
  },
];

export const GRANT_LABEL: Record<Grant, string> = { yes: "نعم", scoped: "في نطاقه", cond: "بشرط", no: "لا" };
