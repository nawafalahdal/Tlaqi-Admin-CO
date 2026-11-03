import type { Session } from "next-auth";
import type { DeputyPermission, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCommitteeScopedLeader } from "./legacy";

/** **من يفعل، وما يملك في الهيكل واللجان — من القاعدة في كل طلب، لا من الجلسة.**
 *
 *  الجلسةُ تحمل دوراً وقسماً، لكنها تبقى حيّةً بعد أن يُنحّى صاحبُها أو
 *  يُنقل أو يُسحب تفويضُه. فكلُّ صلاحيةٍ هنا تُقرأ من صفّه الآن: من نُحّي
 *  يفقد أثرَه في الطلب التالي، لا حين تنقضي جلستُه.
 *
 *  والمناصبُ في هذه الطبقة خمسة، ولا يُشتقّ أحدُها من غيره:
 *  - **المؤسس والرئيس التنفيذي** (`isTop`): ملكيةُ الهيكل كما كانت — ينشئان
 *    اللجان في أي قسم ويديرانها، ويعتمدان طلباتها.
 *  - **مسؤول المتابعة والتشغيل** (`isOps`): يطّلع ويتابع، ولا يعتمد ولا يُدير.
 *  - **قائد القسم** (`leadsDepartmentId`): قسمُه الأصيل وحده.
 *  - **نائب قائد القسم** (`deputy`): عضوٌ يحمل ما فُوِّض إليه فقط.
 *  - **العضو**: لجانُه التي هو فيها، ومهامُّه فيها. */
export type OrgActor = {
  kind: "user" | "member";
  id: string;
  name: string;
  /** دورُه الآن — `null` لحسابٍ معطَّل (فلا يملك شيئاً) */
  role: "super_admin" | "executive" | "operations_officer" | "department_admin" | "member" | null;
  /** القسمُ المسجَّل له الآن */
  departmentId: string | null;
  isTop: boolean;
  isOps: boolean;
  /** قائدُ قسمٍ أصيل (لا لجنة) — معرّفُ قسمه */
  leadsDepartmentId: string | null;
  /** نائبُ قائد قسم — وما فُوِّض إليه وحده */
  deputy: { departmentId: string; permissions: DeputyPermission[] } | null;
};

type Db = Prisma.TransactionClient | typeof prisma;

export async function orgActor(session: Session | null, db: Db = prisma): Promise<OrgActor | null> {
  if (!session?.user?.id) return null;
  if (session.user.role === "member") {
    const m = await db.member.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        fullName: true,
        isActive: true,
        approvalStatus: true,
        terminatedAt: true,
        departmentId: true,
        deputyOf: { select: { id: true, deputyPermissions: true, parentId: true } },
      },
    });
    const live = !!m && m.isActive && m.approvalStatus === "approved" && !m.terminatedAt;
    return {
      kind: "member",
      id: session.user.id,
      name: m?.fullName ?? session.user.name ?? "—",
      role: live ? "member" : null,
      departmentId: live ? m!.departmentId : null,
      isTop: false,
      isOps: false,
      leadsDepartmentId: null,
      deputy:
        live && m!.deputyOf && !m!.deputyOf.parentId && m!.deputyOf.id === m!.departmentId
          ? { departmentId: m!.deputyOf.id, permissions: m!.deputyOf.deputyPermissions }
          : null,
    };
  }
  const u = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      fullName: true,
      role: true,
      isActive: true,
      departmentId: true,
      department: { select: { parentId: true } },
    },
  });
  // الحسابُ القياديُّ القديم على لجنة لا يملك شيئاً في الهيكل — مجمَّدٌ حتى يُحوَّل
  // عضواً وقائداً للجنة (`lib/org/legacy`). وقيادةُ القسم للقسم الأصيل وحده
  const live = !!u && u.isActive && !isCommitteeScopedLeader(u);
  const role = live ? u!.role : null;
  const isLead = role === "department_admin" && !!u!.departmentId && !u!.department?.parentId;
  return {
    kind: "user",
    id: session.user.id,
    name: u?.fullName ?? session.user.name ?? "—",
    role,
    departmentId: live ? u!.departmentId : null,
    isTop: role === "super_admin" || role === "executive",
    isOps: role === "operations_officer",
    leadsDepartmentId: isLead ? u!.departmentId : null,
    deputy: null,
  };
}

function deputyHas(a: OrgActor, departmentId: string, p: DeputyPermission) {
  return a.deputy?.departmentId === departmentId && a.deputy.permissions.includes(p);
}

/** إدارةُ لجان قسمٍ بعينه: إنشاءً وتعديلاً وتعييناً وتعليقاً وإغلاقاً.
 *  لقائده، ولنائبه إن فُوِّض، وللمؤسس والرئيس التنفيذي بملكيّتهما للهيكل
 *  (وهو مسارُ التسليم حين يخلو مقعدُ القائد). ولا لأحدٍ غيرهم. */
export function canManageCommitteesOf(a: OrgActor | null, departmentId: string): boolean {
  if (!a?.role) return false;
  return a.isTop || a.leadsDepartmentId === departmentId || deputyHas(a, departmentId, "committees_manage");
}

/** **اقتراحُ لجنةٍ جديدة وإرسالُها للاعتماد** — لقائد القسم ولنائبه المفوَّض وحدهما.
 *  والرئيسُ التنفيذي والمؤسس يعتمدان أو يردّان ولا يقترحان: الاعتمادُ لا يتمّ إلا بعد
 *  اقتراح قائد القسم وإرساله (ملاحظةُ المؤسس الخامسة)، ومن يعتمد لا يعتمد اقتراحَه. */
export function canProposeCommitteesOf(a: OrgActor | null, departmentId: string): boolean {
  if (!a?.role) return false;
  return a.leadsDepartmentId === departmentId || deputyHas(a, departmentId, "committees_manage");
}

/** نظرةُ القسم (القائد والنائب والعدّادات واللجان) */
export function canViewDepartmentOverview(a: OrgActor | null, departmentId: string): boolean {
  if (!a?.role) return false;
  return a.isTop || a.isOps || a.leadsDepartmentId === departmentId || a.deputy?.departmentId === departmentId;
}

/** أعضاءُ القسم ومسؤولياتُهم */
export function canViewDepartmentMembers(a: OrgActor | null, departmentId: string): boolean {
  if (!a?.role) return false;
  return a.isTop || a.leadsDepartmentId === departmentId || deputyHas(a, departmentId, "members_view");
}

/** توزيعُ مسؤوليات أعضاء القسم — للقائد ولنائبه المفوَّض وحدهما */
export function canAssignResponsibilities(a: OrgActor | null, departmentId: string): boolean {
  if (!a?.role) return false;
  return a.leadsDepartmentId === departmentId || deputyHas(a, departmentId, "responsibilities_assign");
}

/** متابعةُ مهامّ القسم المفتوحة والمتأخّرة */
export function canViewDepartmentTasks(a: OrgActor | null, departmentId: string): boolean {
  if (!a?.role) return false;
  return a.isTop || a.isOps || a.leadsDepartmentId === departmentId || deputyHas(a, departmentId, "tasks_view");
}

/** تعيينُ النائب وتفويضُه وسحبُه — لقائد القسم وحده (والنائبُ لا يُنيب) */
export function canAppointDeputy(a: OrgActor | null, departmentId: string): boolean {
  if (!a?.role) return false;
  return a.leadsDepartmentId === departmentId;
}

/** صلةُ صاحب الطلب بلجنةٍ بعينها — تُحسب من صفّها وصفّه معاً */
export type CommitteeRole = {
  /** يملك هيكلَها (قائد قسمها، نائبُه المفوَّض، المؤسس، الرئيس التنفيذي) */
  manage: boolean;
  /** يقترحها ويرسلها للاعتماد (قائدُ قسمها ونائبُه المفوَّض وحدهما) */
  propose: boolean;
  /** قائدُها — يدير أعمالها */
  lead: boolean;
  /** عضوٌ نشطٌ فيها */
  member: boolean;
  /** يطّلع: كلُّ من سبق، ومسؤولُ التشغيل، وقائدُ القسم ونائبُه بلا تفويض */
  view: boolean;
};

/** صفُّ اللجنة كما تحتاجه الصلاحية — ومعه حالةُ قائدها الفعلية من القاعدة (`committeeLeadState`).
 *  و`leadActive` إن غاب يُعدّ «قائدٌ نشط»: الأضيقُ للمؤسس والرئيس، فلا تُوسَّع صلاحيةٌ بنسيان حقل. */
export type CommitteeRow = {
  id: string;
  parentId: string | null;
  leadMemberId: string | null;
  committeeStatus?: string | null;
  leadActive?: boolean;
  actingLeadUserId?: string | null;
};

/** **إدارةُ لجنةٍ بعينها** (ملاحظةُ المؤسس الثانية في المرحلة الثالثة):
 *  - قائدُ قسمها ونائبُه المفوَّض: كما كانت.
 *  - **المؤسس والرئيس التنفيذي: بحسب حالة قائدها.** قائدٌ نشطٌ معتمد ⇐ اطّلاعٌ فقط — لا إدارة ولا أعضاء
 *    ولا تعليق ولا إغلاق. وغادر القائد (أو انتهت عضويتُه أو عُطِّل) ⇐ تُفعَّل الإدارة، للجنةٍ عاملةٍ أو
 *    معلّقة وحدها. ولا تُمنح بمجرد الصفة. */
export function canManageCommittee(a: OrgActor | null, c: CommitteeRow): boolean {
  if (!a?.role || !c.parentId) return false;
  if (canProposeCommitteesOf(a, c.parentId)) return true;
  if (!a.isTop) return false;
  const leadActive = c.leadActive ?? true;
  return !leadActive && (c.committeeStatus === "approved" || c.committeeStatus === "suspended");
}

export function committeeRoleFor(a: OrgActor | null, c: CommitteeRow, isActiveMember: boolean): CommitteeRole {
  const none = { manage: false, propose: false, lead: false, member: false, view: false };
  if (!a?.role || !c.parentId) return none;
  const manage = canManageCommittee(a, c);
  // قائدُها عضوٌ فيها — قيادةُ اللجنة دورٌ في عضويتها لا دورٌ إداري، ولا تمنح شيئاً على القسم.
  // أو القائمُ بقيادتها بالخلافة (الرئيسُ التنفيذي أو المؤسس) حتى يُعيَّن قائدٌ عضو — قائدٌ فعّالٌ واحد
  const lead =
    (a.kind === "member" && c.leadMemberId === a.id) ||
    (a.kind === "user" && !!c.actingLeadUserId && c.actingLeadUserId === a.id);
  const member = a.kind === "member" && isActiveMember;
  const view =
    // والمؤسسُ والرئيسُ يطّلعان دائماً — الإدارةُ وحدها تتبع حالةَ القائد
    manage || lead || member || a.isTop || a.isOps || a.leadsDepartmentId === c.parentId || a.deputy?.departmentId === c.parentId;
  return { manage, propose: canProposeCommitteesOf(a, c.parentId), lead, member, view };
}
