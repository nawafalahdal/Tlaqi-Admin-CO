import type { Session } from "next-auth";
import type { DeputyPermission, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  /** حسابٌ قياديٌّ قديم على لجنة (نظام اللجان الأول) — يُعامَل قائداً لتلك اللجنة وحدها */
  legacyCommitteeId: string | null;
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
      legacyCommitteeId: null,
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
  const live = !!u && u.isActive;
  const role = live ? u!.role : null;
  const isLead = role === "department_admin" && !!u!.departmentId;
  return {
    kind: "user",
    id: session.user.id,
    name: u?.fullName ?? session.user.name ?? "—",
    role,
    departmentId: live ? u!.departmentId : null,
    isTop: role === "super_admin" || role === "executive",
    isOps: role === "operations_officer",
    leadsDepartmentId: isLead && !u!.department?.parentId ? u!.departmentId : null,
    legacyCommitteeId: isLead && u!.department?.parentId ? u!.departmentId : null,
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
  /** قائدُها — يدير أعمالها */
  lead: boolean;
  /** عضوٌ نشطٌ فيها */
  member: boolean;
  /** يطّلع: كلُّ من سبق، ومسؤولُ التشغيل، وقائدُ القسم ونائبُه بلا تفويض */
  view: boolean;
};

export function committeeRoleFor(
  a: OrgActor | null,
  c: { id: string; parentId: string | null; leadMemberId: string | null },
  isActiveMember: boolean
): CommitteeRole {
  const none = { manage: false, lead: false, member: false, view: false };
  if (!a?.role || !c.parentId) return none;
  const manage = canManageCommitteesOf(a, c.parentId);
  const lead =
    (a.kind === "member" && c.leadMemberId === a.id) ||
    // حسابٌ قياديٌّ قديم على هذه اللجنة — كان يقودها، ويبقى يقودها حتى يُعيَّن غيرُه
    (a.legacyCommitteeId === c.id && !c.leadMemberId);
  const member = a.kind === "member" && isActiveMember;
  const view =
    manage || lead || member || a.isOps || a.leadsDepartmentId === c.parentId || a.deputy?.departmentId === c.parentId;
  return { manage, lead, member, view };
}
