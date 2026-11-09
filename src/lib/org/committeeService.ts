import type { CommitteeKind, CommitteeStatus, DeputyPermission, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { appendMemberEvent } from "@/lib/googleSheets";
import {
  sendCommitteeRequestEmail,
  sendCommitteeLeadAppointedEmail,
  appointerTitle,
  sendCommitteeMemberAddedEmail,
  sendDeputyAppointedEmail,
} from "@/lib/email";
import { newCommitteeSlug, committeeApprover } from "@/lib/committees";
import {
  canAppointDeputy,
  canAssignResponsibilities,
  canManageCommittee,
  canProposeCommitteesOf,
  committeeRoleFor,
  type CommitteeRow,
  type OrgActor,
} from "./actor";
import { diffFields, fail, recordOrgEvent, type OrgResult } from "./audit";
import { committeeGaps, GAP_LABELS } from "./completeness";
import { committeeLeadState, ensureCommitteeSuccession, LEAD_REQUIRED, succeedCommitteesLedBy } from "./committeeLeadership";

type Db = Prisma.TransactionClient | typeof prisma;

function baseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

/** حدودُ الحقول — نصوصٌ تُقرأ لا مقالاتٌ تُخزَّن */
export const LIMITS = { name: 80, short: 200, long: 2000, responsibility: 80 } as const;

export const DEPUTY_PERMISSIONS: DeputyPermission[] = [
  "committees_manage",
  "members_view",
  "responsibilities_assign",
  "tasks_view",
];

/** الحالاتُ التي لا يُعدَّل فيها شيءٌ من بنية اللجنة — سجلٌّ يُقرأ */
const FROZEN: CommitteeStatus[] = ["closed", "archived"];

/** انتقالاتُ الحالة المسموحة لمن يدير اللجنة (الاعتمادُ والردّ ليسا هنا: هما للرئيس التنفيذي والمؤسس) */
export const STATUS_TRANSITIONS: Partial<Record<CommitteeStatus, CommitteeStatus[]>> = {
  draft: ["closed"],
  pending_review: ["draft"],
  rejected: ["draft", "closed"],
  approved: ["suspended", "completed", "closed"],
  suspended: ["approved", "closed"],
  completed: ["approved", "closed"],
  closed: ["archived"],
};
/** انتقالاتٌ لا تقع بلا سببٍ مكتوب */
const NEEDS_NOTE: CommitteeStatus[] = ["suspended", "closed"];

/** أعضاءُ القسم الذين يجوز ضمُّهم إلى لجانه: المعتمَدون النشطون في القسم نفسه،
 *  أو في إحدى لجانه من نظام اللجان الأول (قسمُهم المسجَّل اللجنةُ نفسُها). */
export function departmentPeopleWhere(departmentId: string): Prisma.MemberWhereInput {
  return {
    ...ROSTER_MEMBER_WHERE,
    terminatedAt: null,
    OR: [{ departmentId }, { department: { parentId: departmentId } }],
  };
}

async function eligibleIds(db: Db, departmentId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.member.findMany({
    where: { id: { in: ids }, ...departmentPeopleWhere(departmentId) },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

function text(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

function day(v: unknown): Date | null | "invalid" {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "invalid";
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export type CommitteeInput = {
  name: string;
  description?: string | null;
  purpose: string;
  scope?: string | null;
  responsibilities?: string | null;
  expectedOutputs?: string | null;
  kpis?: string | null;
  kind: CommitteeKind;
  startDate?: string | null;
  endDate?: string | null;
};

type CleanDetails = {
  name: string;
  description: string | null;
  purpose: string;
  scope: string | null;
  responsibilities: string | null;
  expectedOutputs: string | null;
  kpis: string | null;
  committeeKind: CommitteeKind;
  startDate: Date | null;
  endDate: Date | null;
};

function cleanDetails(input: CommitteeInput): OrgResult<{ data: CleanDetails }> {
  const name = text(input.name, LIMITS.name);
  if (!name) return fail("اسم اللجنة مطلوب");
  const purpose = text(input.purpose, LIMITS.long);
  if (!purpose) return fail("الهدفُ والغرض من اللجنة مطلوبان — لجنةٌ بلا غرضٍ مكتوب لا تُحاسَب على أثر");
  if (input.kind !== "permanent" && input.kind !== "temporary") return fail("نوعُ اللجنة: دائمة أو مؤقّتة");
  const start = day(input.startDate);
  const end = day(input.endDate);
  if (start === "invalid" || end === "invalid") return fail("التاريخُ بصيغة يوم/شهر/سنة صحيحة");
  if (input.kind === "temporary" && !end) return fail("اللجنةُ المؤقّتة لها تاريخُ انتهاء إلزامي");
  if (start && end && end < start) return fail("تاريخُ الانتهاء لا يسبق تاريخَ البداية");
  return {
    ok: true,
    data: {
      name,
      description: text(input.description, LIMITS.long),
      purpose,
      scope: text(input.scope, LIMITS.long),
      responsibilities: text(input.responsibilities, LIMITS.long),
      expectedOutputs: text(input.expectedOutputs, LIMITS.long),
      kpis: text(input.kpis, LIMITS.long),
      committeeKind: input.kind,
      startDate: start,
      // الدائمةُ لا تاريخَ انتهاءٍ لها — يُحفظ للمؤقّتة وحدها
      endDate: input.kind === "temporary" ? end : null,
    },
  };
}

/** قائدُ هذه اللجنة؟ — من صفّها وصفّه، لا من قولِ المنادي */
function isCommitteeLead(actor: OrgActor | null, c: CommitteeRow) {
  return committeeRoleFor(actor, c, false).lead;
}

/** صفُّ اللجنة كما يحتاجه كلُّ إجراء — ومعه قسمُها الأصيل وحالةُ قائدها الفعلية.
 *
 *  **ويُصلح نفسَه قبل أي إجراء:** لجنةٌ عاملةٌ أو معلّقةٌ غادر قائدُها ولم تُخلَف بعد (مسارُ مغادرةٍ لم
 *  ينادِ الخلافة) تُخلَف أولاً في معاملتها — فلا يقع إجراءٌ على لجنةٍ بلا قائد. */
async function loadCommittee(db: Db, id: string) {
  const read = () =>
    db.department.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        parentId: true,
        committeeStatus: true,
        leadMemberId: true,
        actingLeadUserId: true,
        leadMember: { select: { id: true, fullName: true, email: true } },
        parent: { select: { id: true, name: true, parentId: true } },
      },
    });
  let c = await read();
  if (!c || !c.parentId || !c.committeeStatus) return null;
  let state = await committeeLeadState(db, c);
  if (LEAD_REQUIRED.includes(c.committeeStatus) && !state.leadActive && !state.actingLeadUserId) {
    await ensureCommitteeSuccession(id, { reason: "قائدٌ غيرُ نشط عند إجراءٍ على اللجنة", source: "automatic", byName: "المنصة — خلافة آلية" });
    c = (await read())!;
    state = await committeeLeadState(db, c);
  }
  return { ...c, leadActive: state.leadActive, actingLeadUserId: state.actingLeadUserId, actingLeadName: state.actingLeadName };
}

// ═════════════════════════════════════════════════════════════════════
//  الإنشاء
// ═════════════════════════════════════════════════════════════════════

/** ينشئ لجنةً في قسمٍ أصيل — باسمها وغرضها وقائدها وأعضائها، أو لا تُنشأ.
 *
 *  - **في قسمٍ أصيل وحده:** لا لجنةَ داخل لجنة — اللجانُ تابعةٌ للأقسام مباشرة.
 *  - **القائدُ والأعضاءُ من القسم نفسه:** لا يُضَمّ أحدٌ من قسمٍ آخر.
 *  - **مسودّةٌ أو طلبُ اعتماد:** لا تعمل لجنةٌ قبل أن يعتمدها الرئيسُ التنفيذي
 *    أو المؤسس — مسارُ الاعتماد القائم لم يُلغَ. */
export async function createCommittee(
  actor: OrgActor | null,
  departmentId: string,
  input: CommitteeInput & { leadMemberId: string; memberIds: string[]; submit: boolean }
): Promise<OrgResult<{ id: string; status: CommitteeStatus }>> {
  if (!actor?.role) return fail("سجّل الدخول أولاً");
  if (!canProposeCommitteesOf(actor, departmentId)) {
    return fail(
      actor.isTop
        ? "اقتراحُ اللجنة لقائد القسم (أو نائبه المفوَّض) — والرئيسُ التنفيذي والمؤسس يعتمدان ما يُرسَل إليهما"
        : "إنشاءُ لجان القسم لقائده (ولنائبه إن فُوِّض) — لا لجنةَ في قسمٍ آخر"
    );
  }
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, colorHex: true, parentId: true, committeeStatus: true, leadershipOnly: true },
  });
  if (!dept) return fail("القسم غير موجود");
  if (dept.parentId || dept.committeeStatus) return fail("اللجانُ تُنشأ في قسمٍ أصيل — لا لجنةَ داخل لجنة");
  // والإدارةُ العليا (القسمُ الاستثنائي) تُنشأ فيها لجانٌ بالنظام نفسه — يقترحها الرئيسُ التنفيذي
  // والمؤسس (`canProposeCommitteesOf`)، وأعضاؤها من أهلها المسجَّلين فيها كأيّ قسم

  const details = cleanDetails(input);
  if (!details.ok) return details;
  if (await prisma.department.findUnique({ where: { name: details.data.name } })) {
    return fail("يوجد قسمٌ أو لجنةٌ بهذا الاسم بالفعل");
  }
  const leadId = String(input.leadMemberId ?? "");
  if (!leadId) return fail("قائدُ اللجنة مطلوب");
  const memberIds = [...new Set(input.memberIds.filter((m) => m && m !== leadId))];
  if (memberIds.length === 0) return fail("أضِف عضواً واحداً على الأقل غيرَ القائد");
  const eligible = await eligibleIds(prisma, departmentId, [leadId, ...memberIds]);
  if (!eligible.has(leadId)) return fail("قائدُ اللجنة يُختار من أعضاء القسم المعتمَدين");
  const foreign = memberIds.filter((m) => !eligible.has(m));
  if (foreign.length) return fail("كلُّ أعضاء اللجنة من أعضاء القسم المعتمَدين — ولا يُضَمّ أحدٌ من قسمٍ آخر");

  const status: CommitteeStatus = input.submit ? "pending_review" : "draft";
  const now = new Date();
  const slug = await newCommitteeSlug(details.data.name);
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.department.create({
      data: {
        ...details.data,
        slug,
        colorHex: dept.colorHex,
        parentId: dept.id,
        committeeStatus: status,
        statusChangedAt: now,
        leadMemberId: leadId,
        requestedById: actor.id,
        requestedByName: actor.name,
        requestedAt: input.submit ? now : null,
      },
      select: { id: true },
    });
    await tx.committeeMembership.createMany({
      data: [leadId, ...memberIds].map((memberId) => ({ committeeId: row.id, memberId, addedByName: actor.name })),
    });
    await recordOrgEvent(tx, {
      scope: "committee",
      entityId: row.id,
      departmentId: dept.id,
      action: "committee.created",
      actor,
      after: {
        ...details.data,
        startDate: details.data.startDate?.toISOString().slice(0, 10) ?? null,
        endDate: details.data.endDate?.toISOString().slice(0, 10) ?? null,
        status,
        leadMemberId: leadId,
        memberIds,
      },
    });
    return row;
  });
  if (input.submit) await notifyApprover(details.data.name, dept.name, actor.name, actor.id);
  return { ok: true, id: created.id, status };
}

async function notifyApprover(committeeName: string, parentName: string, byName: string, proposerId?: string) {
  // من اقترح لا يعتمد اقتراحَه — فيُبلَّغ الآخرُ من الرئيس التنفيذي والمؤسس
  const approver = await committeeApprover(proposerId);
  await appendMemberEvent({
    fullName: byName,
    email: "",
    roleOrDepartment: `${parentName} ← ${committeeName}`,
    event: "طلب اعتماد لجنة",
    details: `بانتظار اعتماد ${approver?.label ?? "الإدارة"}`,
    at: new Date(),
  });
  if (approver) {
    await sendCommitteeRequestEmail({
      to: approver.email,
      approverName: approver.fullName,
      committeeName,
      parentName,
      leadTitle: `قائد لجنة ${committeeName}`,
      requestedByName: byName,
      reviewUrl: `${baseUrl()}/admin/departments`,
    });
  }
}

// ═════════════════════════════════════════════════════════════════════
//  البيانات والحالة
// ═════════════════════════════════════════════════════════════════════

export async function updateCommitteeDetails(
  actor: OrgActor | null,
  committeeId: string,
  input: CommitteeInput
): Promise<OrgResult<{ changed: number }>> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!canManageCommittee(actor, c)) return fail("تعديلُ بيانات اللجنة لقائد قسمها ومن فُوِّض");
  if (FROZEN.includes(c.committeeStatus!)) return fail("اللجنةُ مغلقة — سجلُّها يُقرأ ولا يُعدَّل");
  const details = cleanDetails(input);
  if (!details.ok) return details;
  const current = await prisma.department.findUniqueOrThrow({
    where: { id: committeeId },
    select: {
      name: true, description: true, purpose: true, scope: true, responsibilities: true,
      expectedOutputs: true, kpis: true, committeeKind: true, startDate: true, endDate: true,
    },
  });
  if (details.data.name !== current.name && (await prisma.department.findUnique({ where: { name: details.data.name } }))) {
    return fail("يوجد قسمٌ أو لجنةٌ بهذا الاسم بالفعل");
  }
  const diff = diffFields(current as Record<string, unknown>, details.data as Record<string, unknown>);
  if (!diff) return { ok: true, changed: 0 };
  await prisma.$transaction(async (tx) => {
    await tx.department.update({ where: { id: committeeId }, data: details.data });
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: c.parentId!, action: "committee.updated",
      actor: actor!, before: diff.before as Prisma.InputJsonValue, after: diff.after as Prisma.InputJsonValue,
    });
  });
  return { ok: true, changed: Object.keys(diff.after).length };
}

/** يُرسل مسودّةً (أو مردودةً عُدِّلت) لاعتماد الرئيس التنفيذي أو المؤسس */
export async function submitCommittee(actor: OrgActor | null, committeeId: string): Promise<OrgResult> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!canProposeCommitteesOf(actor, c.parentId!)) return fail("إرسالُ اللجنة للاعتماد لقائد قسمها ونائبه المفوَّض وحدهما");
  if (c.committeeStatus !== "draft" && c.committeeStatus !== "rejected") {
    return fail("تُرسَل للاعتماد المسودّةُ أو المردودة وحدها");
  }
  const gaps = await committeeGaps(prisma, committeeId);
  if (gaps?.length) return fail(`لا تُرسَل لجنةٌ ناقصة — ينقصها: ${gaps.map((g) => GAP_LABELS[g]).join("، ")}`);
  const now = new Date();
  const written = await prisma.$transaction(async (tx) => {
    const w = await tx.department.updateMany({
      where: { id: committeeId, committeeStatus: c.committeeStatus! },
      data: { committeeStatus: "pending_review", statusChangedAt: now, requestedAt: now, requestedById: actor!.id, requestedByName: actor!.name },
    });
    if (w.count) {
      await recordOrgEvent(tx, {
        scope: "committee", entityId: committeeId, departmentId: c.parentId!, action: "committee.submitted",
        actor: actor!, before: { status: c.committeeStatus }, after: { status: "pending_review" },
      });
    }
    return w.count;
  });
  if (!written) return fail("تغيّرت حالةُ اللجنة للتوّ — أعِد فتح الصفحة");
  await notifyApprover(c.name, c.parent!.name, actor!.name);
  return { ok: true };
}

/** تعليقٌ، إعادةُ تفعيل، اكتمال، إغلاق، أرشفة — بانتقالاتٍ مكتوبة وسببٍ حيث يلزم.
 *  **ولا حذف:** اللجنةُ المغلقة تبقى بسجلّها ومهامّها وقراراتها. */
export async function changeCommitteeStatus(
  actor: OrgActor | null,
  committeeId: string,
  to: CommitteeStatus,
  note?: string | null
): Promise<OrgResult> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!canManageCommittee(actor, c)) return fail("تغييرُ حالة اللجنة لقائد قسمها ومن فُوِّض");
  const from = c.committeeStatus!;
  if (!(STATUS_TRANSITIONS[from] ?? []).includes(to)) return fail("هذا الانتقال غير مسموح من حالتها الحالية");
  const why = text(note, LIMITS.short);
  if (NEEDS_NOTE.includes(to) && !why) return fail("التعليقُ والإغلاقُ لا يقعان بلا سببٍ مكتوب");
  // لا تعود لجنةٌ إلى العمل بلا قائدٍ نشط
  if (to === "approved") {
    const gaps = await committeeGaps(prisma, committeeId);
    if (gaps?.includes("lead")) return fail("عيّن قائداً نشطاً للجنة قبل إعادة تفعيلها");
    if (gaps?.length) return fail(`لا تعود لجنةٌ ناقصةٌ للعمل — ينقصها: ${gaps.map((g) => GAP_LABELS[g]).join("، ")}`);
  }
  const written = await prisma.$transaction(async (tx) => {
    const w = await tx.department.updateMany({
      where: { id: committeeId, committeeStatus: from },
      data: { committeeStatus: to, statusChangedAt: new Date(), statusNote: why },
    });
    if (w.count) {
      await recordOrgEvent(tx, {
        scope: "committee", entityId: committeeId, departmentId: c.parentId!, action: "committee.status",
        actor: actor!, before: { status: from }, after: { status: to }, note: why,
      });
    }
    return w.count;
  });
  return written ? { ok: true } : fail("تغيّرت حالةُ اللجنة للتوّ — أعِد فتح الصفحة");
}

// ═════════════════════════════════════════════════════════════════════
//  القائد والأعضاء
// ═════════════════════════════════════════════════════════════════════

/** هل خلا مقعدُ قائد هذا القسم الأصيل؟ — شرطُ تدخّل الرئيس التنفيذي والمؤسس في تعيين قائد لجنة */
async function departmentLeaderVacant(departmentId: string) {
  const lead = await prisma.user.findFirst({
    where: { isActive: true, role: "department_admin", departmentId },
    select: { id: true },
  });
  return !lead;
}

/** **يعيّن قائدَ اللجنة — ولا يُبدَّل قائدٌ نشطٌ معتمدٌ أبداً** (ملاحظةُ المؤسس الرابعة، المرحلة الثالثة).
 *
 *  - **مرحلةُ الاقتراح** (مسودّة أو مردودة): يختار مقترحُها (قائدُ القسم أو نائبُه المفوَّض) قائدَها المقترح.
 *  - **لجنةٌ عاملةٌ أو معلّقة:** يُعيَّن قائدٌ **فقط** إن لم يكن لها قائدٌ نشطٌ معتمد — أي بعد أن غادر قائدُها
 *    أو انتهت عضويتُه أو عُطِّل حسابُه (وتكون حينها بيد القائم بالخلافة). والمنعُ يشمل الجميع: قائدَ القسم
 *    والمؤسسَ والرئيسَ التنفيذي، من الواجهة أو أي طلبٍ مباشر.
 *  - **من يعيّن بعد المغادرة:** قائدُ القسم ونائبُه المفوَّض؛ والمؤسسُ أو الرئيسُ حين يخلو مقعدُ قائد القسم وحده.
 *  - **في معاملةٍ واحدة وبحرسٍ في `where`:** يُكتب القائدُ العضوُ وتُرفع القيادةُ بالخلافة معاً — قائدٌ واحد،
 *    ولا يمرّ تعيينان متزامنان. وتُنقل اختيارياً مهامُّ من غادر من أعضائها المفتوحةُ إلى القائد الجديد. */
export async function appointCommitteeLead(
  actor: OrgActor | null,
  committeeId: string,
  memberId: string,
  note?: string | null,
  opts: { reassignOpenTasks?: boolean } = {}
): Promise<OrgResult<{ handover: boolean; tasksMoved: number }>> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  const proposal = c.committeeStatus === "draft" || c.committeeStatus === "rejected";
  const working = LEAD_REQUIRED.includes(c.committeeStatus!);
  if (!proposal && !working) return fail("لا يُعيَّن قائدٌ للجنةٍ بانتظار الاعتماد أو مغلقة — تُعاد مسودّةً أولاً");
  if (working && c.leadActive) {
    return fail("للجنة قائدٌ نشطٌ معتمد — لا يُغيَّر ولا يُستبدل حتى تنتهي قيادتُه (مغادرة، أو انتهاء عضوية، أو تعطيل حساب)");
  }
  if (proposal ? !canProposeCommitteesOf(actor, c.parentId!) : !canManageCommittee(actor, c)) {
    return fail("تعيينُ قائد اللجنة لقائد قسمها ونائبه المفوَّض");
  }
  if (working && !canProposeCommitteesOf(actor, c.parentId!) && !(await departmentLeaderVacant(c.parentId!))) {
    return fail("تعيينُ قائد اللجنة لقائد القسم — ويتدخّل الرئيسُ التنفيذي أو المؤسس حين يخلو مقعدُه وحده");
  }
  if (c.leadMemberId === memberId) return fail("هذا العضوُ قائدُها بالفعل");
  const ok = await eligibleIds(prisma, c.parentId!, [memberId]);
  if (!ok.has(memberId)) return fail("قائدُ اللجنة يُختار من أعضاء القسم المعتمَدين");
  const person = await prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { fullName: true, email: true } });
  const handover = !proposal;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${committeeId} FOR UPDATE`;
    await tx.committeeMembership.upsert({
      where: { committeeId_memberId: { committeeId, memberId } },
      create: { committeeId, memberId, addedByName: actor!.name },
      update: { active: true, removedAt: null, removedByName: null },
    });
    // الحرسُ في `where`: ما قرأناه من قيادةٍ هو ما نكتب عليه — والقائمُ بالخلافة يُرفع في الكتابة نفسها
    const w = await tx.department.updateMany({
      where: { id: committeeId, leadMemberId: c.leadMemberId, actingLeadUserId: c.actingLeadUserId },
      data: { leadMemberId: memberId, actingLeadUserId: null, actingLeadSince: null, actingLeadReason: null },
    });
    if (!w.count) throw new Error("تغيّرت قيادةُ اللجنة للتوّ — أعِد فتح الصفحة");
    // من بقي «قائداً» في الصفّ وقد غادر: تُغلق عضويتُه ولا تُحذف
    if (c.leadMemberId && working) {
      await tx.committeeMembership.updateMany({
        where: { committeeId, memberId: c.leadMemberId, active: true },
        data: { active: false, removedAt: new Date(), removedByName: actor!.name },
      });
    }
    // مهامُّ من غادر من أعضائها (القائدُ السابق أو غيرُه) — تُنقل إلى القائد الجديد إن طُلب
    let moved: string[] = [];
    if (working && opts.reassignOpenTasks) {
      const open = await tx.committeeTask.findMany({
        where: {
          committeeId,
          status: { in: ["todo", "in_progress"] },
          assigneeMemberId: { not: null },
          OR: [
            { assignee: { isActive: false } },
            { assignee: { terminatedAt: { not: null } } },
            { assignee: { suspendedAt: { not: null } } },
            { assignee: { committeeMemberships: { none: { committeeId, active: true } } } },
          ],
        },
        select: { id: true },
      });
      moved = open.map((t) => t.id);
      if (moved.length) await tx.committeeTask.updateMany({ where: { id: { in: moved } }, data: { assigneeMemberId: memberId } });
    }
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: c.parentId!,
      action: handover ? "committee.handover" : "committee.lead",
      actor: actor!,
      before: {
        leadMemberId: c.leadMemberId,
        leadName: c.leadMember?.fullName ?? null,
        actingLeadUserId: c.actingLeadUserId,
        actingLeadName: c.actingLeadName,
      },
      after: { leadMemberId: memberId, leadName: person.fullName, source: "administrative", ...(handover ? { tasksMoved: moved } : {}) },
      note: text(note, LIMITS.short),
    });
    return { tasksMoved: moved.length };
  });
  if (working) {
    await sendCommitteeLeadAppointedEmail({
      to: person.email,
      fullName: person.fullName,
      committeeName: c.name,
      parentName: c.parent!.name,
      appointedByName: actor!.name,
      appointedByTitle: appointerTitle(actor!.role, c.parent!.name),
      url: `${baseUrl()}/committees/${committeeId}`,
    });
  }
  return { ok: true, handover, tasksMoved: result.tasksMoved };
}

/** **مغادرةُ قائد لجنة** — حين يُنهى أو يتنحّى أو يُعطَّل أو يُوقف: تنتقل قيادةُ لجانه العاملة **آلياً** إلى
 *  الخَلَف (`committeeLeadership.succeedCommitteesLedBy`)، ويُكتب ذلك في سجلّ كلّ لجنة. لا تُرمى أبداً. */
export async function noteCommitteeLeadDeparture(memberId: string, reason: string): Promise<number> {
  try {
    return (await succeedCommitteesLedBy(memberId, reason)).committees;
  } catch {
    return 0;
  }
}

export async function addCommitteeMembers(
  actor: OrgActor | null,
  committeeId: string,
  memberIds: string[]
): Promise<OrgResult<{ added: number }>> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!canManageCommittee(actor, c)) return fail("إضافةُ الأعضاء لقائد القسم ومن فُوِّض — ولقائد اللجنة أن يقترح");
  if (FROZEN.includes(c.committeeStatus!)) return fail("اللجنةُ مغلقة — لا يُضاف إليها أحد");
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return fail("اختر عضواً واحداً على الأقل");
  const ok = await eligibleIds(prisma, c.parentId!, ids);
  if (ids.some((id) => !ok.has(id))) return fail("الأعضاءُ من أعضاء القسم المعتمَدين — ولا يُضَمّ أحدٌ من قسمٍ آخر");
  const existing = await prisma.committeeMembership.findMany({
    where: { committeeId, memberId: { in: ids }, active: true },
    select: { memberId: true },
  });
  const already = new Set(existing.map((e) => e.memberId));
  const fresh = ids.filter((id) => !already.has(id));
  if (!fresh.length) return fail("المختارون أعضاءٌ فيها بالفعل");
  await prisma.$transaction(async (tx) => {
    for (const memberId of fresh) {
      await tx.committeeMembership.upsert({
        where: { committeeId_memberId: { committeeId, memberId } },
        create: { committeeId, memberId, addedByName: actor!.name },
        update: { active: true, removedAt: null, removedByName: null, addedAt: new Date(), addedByName: actor!.name },
      });
    }
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: c.parentId!, action: "committee.members_added",
      actor: actor!, after: { memberIds: fresh },
    });
  });
  const people = await prisma.member.findMany({ where: { id: { in: fresh } }, select: { email: true, fullName: true } });
  for (const p of people) {
    await sendCommitteeMemberAddedEmail({ to: p.email, fullName: p.fullName, committeeName: c.name, url: `${baseUrl()}/committees/${committeeId}` });
  }
  return { ok: true, added: fresh.length };
}

/** يُخرج عضواً من اللجنة — **ولا يُخرَج القائد** حتى يُعيَّن غيرُه (فلا تبقى بلا قائد).
 *  ومهامُّه المفتوحة فيها تعود بلا مُسنَدٍ إليه، ويُسجَّل عددُها. */
export async function removeCommitteeMember(
  actor: OrgActor | null,
  committeeId: string,
  memberId: string,
  note?: string | null
): Promise<OrgResult> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!canManageCommittee(actor, c)) return fail("إزالةُ الأعضاء لقائد القسم ومن فُوِّض");
  if (FROZEN.includes(c.committeeStatus!)) return fail("اللجنةُ مغلقة — سجلُّ أعضائها يُقرأ ولا يُعدَّل");
  if (c.leadMemberId === memberId) return fail("هذا قائدُ اللجنة — عيّن قائداً غيرَه أولاً ثم أخرِجه");
  const m = await prisma.committeeMembership.findUnique({
    where: { committeeId_memberId: { committeeId, memberId } },
    select: { active: true },
  });
  if (!m?.active) return fail("ليس عضواً فيها");
  await prisma.$transaction(async (tx) => {
    await tx.committeeMembership.update({
      where: { committeeId_memberId: { committeeId, memberId } },
      data: { active: false, removedAt: new Date(), removedByName: actor!.name },
    });
    const released = await tx.committeeTask.updateMany({
      where: { committeeId, assigneeMemberId: memberId, status: { in: ["todo", "in_progress"] } },
      data: { assigneeMemberId: null },
    });
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: c.parentId!, action: "committee.member_removed",
      actor: actor!, before: { memberId, active: true }, after: { memberId, active: false, tasksUnassigned: released.count },
      note: text(note, LIMITS.short),
    });
  });
  return { ok: true };
}

/** مسؤوليةُ العضو داخل اللجنة — يوزّعها قائدُها، أو قائدُ القسم */
export async function setCommitteeResponsibility(
  actor: OrgActor | null,
  committeeId: string,
  memberId: string,
  responsibility: string | null
): Promise<OrgResult> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!isCommitteeLead(actor, c) && !canManageCommittee(actor, c)) return fail("توزيعُ المسؤوليات لقائد اللجنة أو قائد قسمها");
  if (FROZEN.includes(c.committeeStatus!)) return fail("اللجنةُ مغلقة");
  const row = await prisma.committeeMembership.findUnique({
    where: { committeeId_memberId: { committeeId, memberId } },
    select: { active: true, responsibility: true },
  });
  if (!row?.active) return fail("ليس عضواً فيها");
  const next = text(responsibility, LIMITS.responsibility);
  if (next === row.responsibility) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.committeeMembership.update({ where: { committeeId_memberId: { committeeId, memberId } }, data: { responsibility: next } });
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: c.parentId!, action: "committee.responsibility",
      actor: actor!, before: { memberId, responsibility: row.responsibility }, after: { memberId, responsibility: next },
    });
  });
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════
//  اقتراحاتُ قائد اللجنة — والقرارُ لقائد القسم
// ═════════════════════════════════════════════════════════════════════

export async function proposeMembershipChange(
  actor: OrgActor | null,
  committeeId: string,
  input: { kind: "add_member" | "remove_member" | "replace_member"; memberId: string; replacementMemberId?: string | null; note?: string | null }
): Promise<OrgResult> {
  const c = await loadCommittee(prisma, committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!isCommitteeLead(actor, c)) return fail("الاقتراحُ لقائد اللجنة — والقرارُ لقائد القسم");
  if (c.committeeStatus !== "approved") return fail("اللجنةُ ليست نشطة");
  const active = await prisma.committeeMembership.findMany({ where: { committeeId, active: true }, select: { memberId: true } });
  const isMember = (id: string) => active.some((a) => a.memberId === id);
  const eligible = await eligibleIds(prisma, c.parentId!, [input.memberId, input.replacementMemberId ?? ""].filter(Boolean));
  if (input.kind === "add_member") {
    if (!eligible.has(input.memberId)) return fail("يُقترَح من أعضاء القسم المعتمَدين وحدهم");
    if (isMember(input.memberId)) return fail("هو عضوٌ فيها بالفعل");
  } else {
    if (!isMember(input.memberId)) return fail("ليس عضواً فيها");
    if (input.memberId === c.leadMemberId) return fail("لا يقترح القائدُ إخراجَ نفسه — يطلب ذلك من قائد القسم");
    if (input.kind === "replace_member") {
      const r = input.replacementMemberId ?? "";
      if (!r || !eligible.has(r)) return fail("البديلُ من أعضاء القسم المعتمَدين");
      if (isMember(r)) return fail("البديلُ عضوٌ فيها بالفعل");
    }
  }
  const dup = await prisma.committeeProposal.findFirst({
    where: { committeeId, status: "pending", kind: input.kind, memberId: input.memberId },
    select: { id: true },
  });
  if (dup) return fail("اقتراحٌ مثلُه ينتظر قرارَ قائد القسم");
  await prisma.$transaction(async (tx) => {
    const p = await tx.committeeProposal.create({
      data: {
        committeeId, kind: input.kind, memberId: input.memberId,
        replacementMemberId: input.kind === "replace_member" ? input.replacementMemberId ?? null : null,
        note: text(input.note, LIMITS.short), proposedByName: actor!.name,
      },
      select: { id: true },
    });
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: c.parentId!, action: "committee.proposal",
      actor: actor!, after: { proposalId: p.id, kind: input.kind, memberId: input.memberId, replacementMemberId: input.replacementMemberId ?? null },
    });
  });
  return { ok: true };
}

export async function decideProposal(
  actor: OrgActor | null,
  proposalId: string,
  accept: boolean,
  note?: string | null
): Promise<OrgResult> {
  const p = await prisma.committeeProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, committeeId: true, kind: true, memberId: true, replacementMemberId: true, status: true },
  });
  if (!p) return fail("الاقتراح غير موجود");
  const c = await loadCommittee(prisma, p.committeeId);
  if (!c) return fail("اللجنة غير موجودة");
  if (!canManageCommittee(actor, c)) return fail("القرارُ في الاقتراح لقائد القسم ومن فُوِّض");
  if (p.status !== "pending") return fail("قُرِّر هذا الاقتراحُ بالفعل");
  const why = text(note, LIMITS.short);
  if (!accept && !why) return fail("الردُّ لا يقع بلا سببٍ مكتوب");
  if (accept) {
    // التطبيقُ بالدوال نفسِها — بشروطها وتسجيلها، لا بطريقٍ جانبي
    const apply =
      p.kind === "add_member"
        ? await addCommitteeMembers(actor, c.id, [p.memberId!])
        : p.kind === "remove_member"
          ? await removeCommitteeMember(actor, c.id, p.memberId!, why)
          : await (async () => {
              const added = await addCommitteeMembers(actor, c.id, [p.replacementMemberId!]);
              if (!added.ok) return added;
              return removeCommitteeMember(actor, c.id, p.memberId!, why);
            })();
    if (!apply.ok) return apply;
  }
  await prisma.$transaction(async (tx) => {
    await tx.committeeProposal.update({
      where: { id: p.id },
      data: { status: accept ? "accepted" : "rejected", decidedAt: new Date(), decidedByName: actor!.name, decisionNote: why },
    });
    await recordOrgEvent(tx, {
      scope: "committee", entityId: c.id, departmentId: c.parentId!, action: "committee.proposal_decided",
      actor: actor!, before: { proposalId: p.id, status: "pending" }, after: { proposalId: p.id, status: accept ? "accepted" : "rejected" }, note: why,
    });
  });
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════
//  نائبُ قائد القسم ومسؤولياتُ الأعضاء
// ═════════════════════════════════════════════════════════════════════

/** الصلاحياتُ المفوَّضة من القائمة المكتوبة وحدها — وما ليس فيها يُرفَض صراحةً لا يُسقَط صامتاً:
 *  طلبٌ يحمل صلاحيةً مجهولة طلبٌ مصنوع، فلا يمرّ نصفُه */
function cleanPermissions(input: string[]): DeputyPermission[] | null {
  if (input.some((p) => !DEPUTY_PERMISSIONS.includes(p as DeputyPermission))) return null;
  return DEPUTY_PERMISSIONS.filter((p) => input.includes(p));
}
const UNKNOWN_PERMISSION = "صلاحيةٌ غير معروفة — يُفوَّض من القائمة المعتمدة وحدها";

/** يعيّن نائباً للقسم أو يستبدله — **نائبٌ واحد**، من أعضاء القسم، بما فُوِّض إليه وحده */
export async function appointDeputy(
  actor: OrgActor | null,
  departmentId: string,
  memberId: string,
  permissions: string[]
): Promise<OrgResult> {
  if (!canAppointDeputy(actor, departmentId)) return fail("تعيينُ النائب لقائد القسم وحده");
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, parentId: true, deputyMemberId: true, deputyPermissions: true, deputyMember: { select: { fullName: true } } },
  });
  if (!dept || dept.parentId) return fail("النائبُ للقسم الأصيل وحده");
  if (dept.deputyMemberId === memberId) return fail("هذا العضوُ نائبُ القسم بالفعل — عدّل صلاحياته من مكانها");
  const m = await prisma.member.findFirst({
    where: { id: memberId, ...ROSTER_MEMBER_WHERE, terminatedAt: null, departmentId },
    select: { id: true, fullName: true, email: true, deputyOf: { select: { id: true } } },
  });
  if (!m) return fail("النائبُ من أعضاء القسم المعتمَدين النشطين");
  if (m.deputyOf && m.deputyOf.id !== departmentId) return fail("هذا العضوُ نائبٌ في قسمٍ آخر");
  const perms = cleanPermissions(permissions);
  if (!perms) return fail(UNKNOWN_PERMISSION);
  await prisma.$transaction(async (tx) => {
    await tx.department.update({
      where: { id: departmentId },
      data: { deputyMemberId: memberId, deputyPermissions: perms, deputyAppointedAt: new Date(), deputyAppointedByName: actor!.name },
    });
    await recordOrgEvent(tx, {
      scope: "department", entityId: departmentId, departmentId, action: "department.deputy",
      actor: actor!,
      before: { deputyMemberId: dept.deputyMemberId, deputyName: dept.deputyMember?.fullName ?? null, permissions: dept.deputyPermissions },
      after: { deputyMemberId: memberId, deputyName: m.fullName, permissions: perms },
    });
    if (dept.deputyMemberId) await writePermissionEvents(tx, actor!, departmentId, dept.deputyMemberId, dept.deputyPermissions, []);
    await writePermissionEvents(tx, actor!, departmentId, memberId, [], perms);
  });
  await sendDeputyAppointedEmail({
    to: m.email,
    fullName: m.fullName,
    departmentName: dept.name,
    permissions: perms,
    appointedByName: actor!.name,
    url: `${baseUrl()}/committees`,
  });
  return { ok: true };
}

/** **كلُّ صلاحيةٍ من الأربع تُمنح وتُسحب مستقلّةً، ولكلّ تغييرٍ حدثُه في السجلّ** (ملاحظةُ المؤسس الرابعة).
 *  الحدثُ يسمّي الصلاحيةَ وحدها، ومعه القائمةُ قبل التغيير وبعده — فيُقرأ من فوَّض ماذا ومتى. */
async function writePermissionEvents(
  tx: Prisma.TransactionClient,
  actor: OrgActor,
  departmentId: string,
  deputyMemberId: string,
  before: DeputyPermission[],
  after: DeputyPermission[],
  note?: string | null
) {
  for (const p of DEPUTY_PERMISSIONS) {
    const had = before.includes(p);
    const has = after.includes(p);
    if (had === has) continue;
    await recordOrgEvent(tx, {
      scope: "department", entityId: departmentId, departmentId,
      action: has ? "department.deputy_permission_granted" : "department.deputy_permission_revoked",
      actor, before: { deputyMemberId, permission: p, permissions: before }, after: { deputyMemberId, permission: p, permissions: after },
      note: note ?? null,
    });
  }
}

/** يمنح صلاحيةً واحدة للنائب أو يسحبها — لقائد القسم وحده */
export async function setDeputyPermission(
  actor: OrgActor | null,
  departmentId: string,
  permission: string,
  granted: boolean,
  note?: string | null
): Promise<OrgResult<{ changed: boolean }>> {
  if (!canAppointDeputy(actor, departmentId)) return fail("تفويضُ النائب لقائد القسم وحده");
  if (!DEPUTY_PERMISSIONS.includes(permission as DeputyPermission)) return fail(UNKNOWN_PERMISSION);
  const p = permission as DeputyPermission;
  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { deputyMemberId: true, deputyPermissions: true } });
  if (!dept?.deputyMemberId) return fail("لا نائبَ للقسم");
  const before = dept.deputyPermissions;
  if (before.includes(p) === granted) return { ok: true, changed: false };
  const after = DEPUTY_PERMISSIONS.filter((x) => (x === p ? granted : before.includes(x)));
  const written = await prisma.$transaction(async (tx) => {
    // الحرسُ في `where`: تفويضانِ متزامنان لا يكتب أحدُهما فوق الآخر بقائمةٍ قديمة
    const w = await tx.department.updateMany({
      where: { id: departmentId, deputyMemberId: dept.deputyMemberId, deputyPermissions: { equals: before } },
      data: { deputyPermissions: after },
    });
    if (w.count) await writePermissionEvents(tx, actor!, departmentId, dept.deputyMemberId!, before, after, text(note, LIMITS.short));
    return w.count;
  });
  return written ? { ok: true, changed: true } : fail("تغيّر تفويضُ النائب للتوّ — أعِد فتح الصفحة");
}

/** القائمةُ كاملةً دفعةً واحدة — وتُكتب أحداثُها صلاحيةً صلاحية كما في `setDeputyPermission` */
export async function setDeputyPermissions(
  actor: OrgActor | null,
  departmentId: string,
  permissions: string[]
): Promise<OrgResult> {
  if (!canAppointDeputy(actor, departmentId)) return fail("تفويضُ النائب لقائد القسم وحده");
  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { deputyMemberId: true, deputyPermissions: true } });
  if (!dept?.deputyMemberId) return fail("لا نائبَ للقسم");
  const perms = cleanPermissions(permissions);
  if (!perms) return fail(UNKNOWN_PERMISSION);
  const same = perms.length === dept.deputyPermissions.length && perms.every((p) => dept.deputyPermissions.includes(p));
  if (same) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.department.update({ where: { id: departmentId }, data: { deputyPermissions: perms } });
    await writePermissionEvents(tx, actor!, departmentId, dept.deputyMemberId!, dept.deputyPermissions, perms);
  });
  return { ok: true };
}

export async function revokeDeputy(actor: OrgActor | null, departmentId: string, note?: string | null): Promise<OrgResult> {
  if (!canAppointDeputy(actor, departmentId)) return fail("سحبُ النائب لقائد القسم وحده");
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { deputyMemberId: true, deputyPermissions: true, deputyMember: { select: { fullName: true } } },
  });
  if (!dept?.deputyMemberId) return fail("لا نائبَ للقسم");
  await prisma.$transaction(async (tx) => {
    await tx.department.update({
      where: { id: departmentId },
      data: { deputyMemberId: null, deputyPermissions: [], deputyAppointedAt: null, deputyAppointedByName: null },
    });
    await recordOrgEvent(tx, {
      scope: "department", entityId: departmentId, departmentId, action: "department.deputy_revoked",
      actor: actor!,
      before: { deputyMemberId: dept.deputyMemberId, deputyName: dept.deputyMember?.fullName ?? null, permissions: dept.deputyPermissions },
      after: { deputyMemberId: null, permissions: [] },
      note: text(note, LIMITS.short),
    });
    await writePermissionEvents(tx, actor!, departmentId, dept.deputyMemberId!, dept.deputyPermissions, [], text(note, LIMITS.short));
  });
  return { ok: true };
}

/** مسؤوليةُ عضو القسم (مسمّاه فيه) — للقائد ولنائبه المفوَّض */
export async function assignMemberResponsibility(
  actor: OrgActor | null,
  departmentId: string,
  memberId: string,
  responsibility: string | null
): Promise<OrgResult> {
  if (!canAssignResponsibilities(actor, departmentId)) return fail("توزيعُ المسؤوليات لقائد القسم ونائبه المفوَّض");
  const m = await prisma.member.findFirst({
    where: { id: memberId, ...ROSTER_MEMBER_WHERE, departmentId },
    select: { jobTitle: true },
  });
  if (!m) return fail("ليس عضواً في هذا القسم");
  const next = text(responsibility, LIMITS.responsibility);
  if (next === m.jobTitle) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.member.update({ where: { id: memberId }, data: { jobTitle: next } });
    await recordOrgEvent(tx, {
      scope: "department", entityId: departmentId, departmentId, action: "department.responsibility",
      actor: actor!, before: { memberId, responsibility: m.jobTitle }, after: { memberId, responsibility: next },
    });
  });
  return { ok: true };
}
