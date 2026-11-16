import type { Session } from "next-auth";
import type { AssessmentPurpose, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scoreAnswers } from "@/lib/testTracks";
import { PASS_THRESHOLD } from "@/lib/workflow";
import { isSeniorLeader } from "@/lib/governance/leadership";
import { recordOrgEvent } from "@/lib/org/audit";

/** **اختبارٌ لعضوٍ قائم** (قرار المؤسس، نوفمبر 2026 — البند ١.٢، وق٧، وقبولُ منصب الإدارة العليا من صاحب حسابٍ قائم).
 *
 *  - **منفصلٌ عن دعوات القبول:** لا دعوةَ ولا حسابَ جديد، ولا يمسّ `approvalStatus` ولا الصلاحيات — حالتُه وسجلُّه في
 *    `AssessmentAssignment` ومحاولاتُه في `AssessmentAttempt`، ببنوك الأسئلة القائمة وحسابها (`scoreAnswers`، `PASS_THRESHOLD`).
 *  - **التقييم (`evaluation`)** يكلّف به قائدُ الإدارة العليا — الرئيسُ التنفيذي، أو المؤسسُ بالخلافة حين لا رئيس — بسببٍ
 *    مكتوب. نتيجتُه للاطّلاع والتقييم وحدهما (ق٧): لا تُغيّر عضويةً ولا تسحب صلاحيةً ولا تعيد فتح اعتماد.
 *  - **منصبُ الإدارة العليا (`senior_position`)** يُنشأ عند قبول صاحب حسابٍ قائمٍ دعوةَ منصب: يبقى المنصبُ «بانتظار القبول»
 *    حتى يجتاز اختبارَ الإدارة العليا ثم تعتمده جهةُ الاعتماد المستقلة (`decideSeniorPositionAssessment`) — لا المؤسسُ ولا
 *    الرئيسُ (ق١ وق٢). وعضويتُه القائمة وصلاحياتُه لا تُمسّ في الأثناء.
 *  - كلُّ تكليفٍ وتسليمٍ وإلغاءٍ وقرارٍ في سجلّ التدقيق الثابت. */

type Owner = { kind: "member" | "user"; id: string };
type Ok<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };
const fail = (reason: string) => ({ ok: false as const, reason });

export const PURPOSE_LABEL: Record<AssessmentPurpose, string> = {
  evaluation: "تقييم",
  senior_position: "منصبٌ في الإدارة العليا",
};

export function ownerOf(session: Session | null): Owner | null {
  if (!session?.user?.id) return null;
  return { kind: session.user.role === "member" ? "member" : "user", id: session.user.id };
}

const ownerWhere = (o: Owner) => (o.kind === "member" ? { memberId: o.id } : { userId: o.id });

/** يكلّف بالتقييم قائدُ الإدارة العليا وحده — من القاعدة لا من الدور (`isSeniorLeader`) */
export async function canAssignAssessments(session: Session | null): Promise<boolean> {
  if (!session?.user?.id || session.user.role === "member") return false;
  return isSeniorLeader({ kind: "user", id: session.user.id });
}

/** بنوكُ الأسئلة التي يُختار منها — ما فيه أسئلةٌ وحده */
export async function assessableTracks() {
  const tracks = await prisma.testTrack.findMany({
    where: { questions: { some: {} } },
    select: { id: true, scope: true, department: { select: { name: true, leadershipOnly: true } }, _count: { select: { questions: true } } },
    orderBy: { createdAt: "asc" },
  });
  const SCOPE: Record<string, string> = { department_member: "أعضاء", department_admin: "قادة الأقسام", operations_officer: "مسؤول التشغيل", executive: "الرئيس التنفيذي" };
  return tracks.map((t) => ({
    id: t.id,
    label: `${t.department ? t.department.name : "عام"} — ${SCOPE[t.scope] ?? t.scope} (${t._count.questions} سؤالاً)`,
    senior: !!t.department?.leadershipOnly,
  }));
}

/** بنكُ اختبار الإدارة العليا — إن أُنشئ وفيه أسئلة */
export async function seniorTrack(db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.testTrack.findFirst({
    where: { scope: "department_member", department: { leadershipOnly: true, parentId: null }, questions: { some: {} } },
    select: { id: true },
  });
}

async function ownerRow(o: Owner) {
  if (o.kind === "member") {
    const m = await prisma.member.findUnique({
      where: { id: o.id },
      select: { id: true, fullName: true, email: true, isActive: true, approvalStatus: true, terminatedAt: true, departmentId: true },
    });
    if (!m || !m.isActive || m.terminatedAt || m.approvalStatus !== "approved") return null;
    return { name: m.fullName, email: m.email, departmentId: m.departmentId, role: "member" };
  }
  const u = await prisma.user.findUnique({ where: { id: o.id }, select: { fullName: true, email: true, isActive: true, role: true, departmentId: true } });
  if (!u || !u.isActive) return null;
  return { name: u.fullName, email: u.email, departmentId: u.departmentId, role: u.role as string };
}

/** **التكليفُ بتقييم** — لعضوٍ معتمدٍ نشط أو حسابٍ إداريٍّ نشط، على حسابه هو. والمؤسسُ لا يُكلَّف، ولا يكلّف القائدُ نفسَه */
export async function assignAssessment(opts: {
  session: Session;
  owner: Owner;
  trackId: string;
  reason: string;
}): Promise<Ok<{ id: string }>> {
  if (!(await canAssignAssessments(opts.session))) return fail("التكليفُ باختبار عضوٍ قائم لقائد الإدارة العليا (الرئيس التنفيذي)");
  const reason = opts.reason.trim();
  if (reason.length < 5) return fail("اكتب سببَ الاختبار والغرضَ منه");
  if (opts.owner.kind === "user" && opts.owner.id === opts.session.user.id) return fail("لا يكلّف أحدٌ نفسَه باختبار");
  const row = await ownerRow(opts.owner);
  if (!row) return fail("الاختبارُ لعضوٍ معتمدٍ نشط أو حسابٍ إداريٍّ نشط — لا لمرشّحٍ ولا لمن غادر");
  if (row.role === "super_admin") return fail("لا يُكلَّف المؤسسُ باختبار");
  const track = await prisma.testTrack.findFirst({ where: { id: opts.trackId, questions: { some: {} } }, select: { id: true } });
  if (!track) return fail("بنكُ الأسئلة غير موجود أو بلا أسئلة");
  const open = await prisma.assessmentAssignment.findFirst({ where: { ...ownerWhere(opts.owner), status: "assigned" }, select: { id: true } });
  if (open) return fail("له اختبارٌ قائمٌ لم يُسلّمه بعد — يُلغى أولاً أو ينتظر تسليمَه");

  const a = await prisma.$transaction(async (tx) => {
    const created = await tx.assessmentAssignment.create({
      data: {
        ...ownerWhere(opts.owner),
        trackId: track.id,
        purpose: "evaluation",
        reason,
        createdById: opts.session.user.id,
        createdByName: opts.session.user.name ?? "—",
      },
      select: { id: true },
    });
    await recordOrgEvent(tx, {
      scope: "member", entityId: created.id, departmentId: row.departmentId ?? "—", action: "assessment.assigned",
      actor: { kind: "user", id: opts.session.user.id, name: opts.session.user.name ?? "—", role: opts.session.user.role },
      after: { owner: opts.owner, name: row.name, trackId: track.id, purpose: "evaluation" }, note: reason,
    });
    return created;
  });
  return { ok: true, id: a.id };
}

/** تكليفُ اختبار الإدارة العليا لصاحب حسابٍ قائمٍ قبل منصباً — يُنادى من قبول الدعوة داخل معاملتها */
export async function assignSeniorPositionAssessment(
  tx: Prisma.TransactionClient,
  opts: { owner: Owner; positionId: string; trackId: string; invitedById: string; invitedByName: string; titleAr: string }
) {
  return tx.assessmentAssignment.create({
    data: {
      ...ownerWhere(opts.owner),
      trackId: opts.trackId,
      purpose: "senior_position",
      reason: `قبولُ منصب «${opts.titleAr}» في الإدارة العليا — يُفعَّل بعد اجتياز الاختبار واعتماد جهة الاعتماد المستقلة`,
      seniorPositionId: opts.positionId,
      createdById: opts.invitedById,
      createdByName: opts.invitedByName,
    },
    select: { id: true },
  });
}

/** اختباراتُ صاحب الجلسة القائمة (لم يُسلّمها) — تُعرض في صفحته */
export async function myOpenAssessments(session: Session | null) {
  const o = ownerOf(session);
  if (!o) return [];
  return prisma.assessmentAssignment.findMany({
    where: { ...ownerWhere(o), status: "assigned" },
    select: { id: true, purpose: true, reason: true, createdAt: true, createdByName: true, seniorPosition: { select: { titleAr: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** أسئلةُ اختبارٍ قائمٍ لصاحبه وحده — بلا الإجابات الصحيحة */
export async function assessmentForOwner(session: Session | null, assignmentId: string) {
  const o = ownerOf(session);
  if (!o) return null;
  const a = await prisma.assessmentAssignment.findFirst({
    where: { id: assignmentId, ...ownerWhere(o) },
    select: {
      id: true, purpose: true, status: true, reason: true, score: true,
      seniorPosition: { select: { titleAr: true } },
      track: { select: { department: { select: { name: true, colorHex: true } }, questions: { select: { id: true, prompt: true, options: true }, orderBy: { order: "asc" } } } },
    },
  });
  return a;
}

/** **تسليمُ اختبار العضو القائم** — لصاحبه وحده، ومرّةً واحدة (المطالبةُ ذرّيةٌ بشرط «assigned» فلا يُحسب مرّتين) */
export async function submitAssessment(opts: {
  session: Session;
  assignmentId: string;
  answers: Record<string, number>;
}): Promise<Ok<{ score: number; passed: boolean; purpose: AssessmentPurpose }>> {
  const o = ownerOf(opts.session);
  if (!o) return fail("سجّل الدخول");
  const a = await prisma.assessmentAssignment.findFirst({
    where: { id: opts.assignmentId, ...ownerWhere(o) },
    select: { id: true, status: true, purpose: true, seniorPositionId: true, track: { select: { questions: { select: { id: true, correctIndex: true } } } } },
  });
  if (!a) return fail("الاختبار غير موجود");
  if (a.status !== "assigned") return fail("سُلِّم هذا الاختبار أو أُلغي");
  const score = scoreAnswers(a.track.questions, opts.answers);
  const passed = score >= PASS_THRESHOLD;
  const row = await ownerRow(o);
  const done = await prisma.$transaction(async (tx) => {
    const w = await tx.assessmentAssignment.updateMany({
      where: { id: a.id, status: "assigned" },
      data: { status: passed ? "passed" : "failed", score, completedAt: new Date() },
    });
    if (!w.count) return false;
    await tx.assessmentAttempt.create({ data: { assignmentId: a.id, answers: opts.answers, score, passed } });
    await recordOrgEvent(tx, {
      scope: "member", entityId: a.id, departmentId: row?.departmentId ?? "—", action: "assessment.completed",
      actor: { kind: o.kind, id: o.id, name: row?.name ?? opts.session.user.name ?? "—", role: opts.session.user.role },
      after: { score, passed, purpose: a.purpose },
    });
    return true;
  });
  if (!done) return fail("سُلِّم هذا الاختبار للتوّ");

  // منصبُ الإدارة العليا: من اجتاز تُخبَر جهةُ الاعتماد المستقلة وحدها (ق١)
  if (a.purpose === "senior_position" && passed && row) {
    const { candidateDecidersFor } = await import("@/lib/candidateDecision");
    const { sendAwaitingApprovalEmail } = await import("@/lib/email");
    const { baseUrl } = await import("@/lib/tickets");
    const deciders = await candidateDecidersFor({ id: a.id, departmentId: null, invite: { targetRole: "executive" } });
    if (deciders.to.length) {
      await sendAwaitingApprovalEmail({
        to: deciders.to.slice(0, 1),
        candidateName: row.name,
        candidateEmail: row.email,
        score,
        scopeLabel: "منصبٌ في الإدارة العليا",
        portalUrl: `${baseUrl()}/senior/approvals`,
      });
    }
  }
  return { ok: true, score, passed, purpose: a.purpose };
}

/** **إلغاءُ تكليفٍ لم يُسلَّم** — لقائد الإدارة العليا، بسببٍ مكتوب (ولا يُحذف: يبقى سجلُّه) */
export async function cancelAssessment(opts: { session: Session; assignmentId: string; reason: string }): Promise<Ok> {
  if (!(await canAssignAssessments(opts.session))) return fail("إلغاءُ الاختبار لقائد الإدارة العليا");
  const reason = opts.reason.trim();
  if (reason.length < 5) return fail("اكتب سببَ الإلغاء");
  const a = await prisma.assessmentAssignment.findUnique({ where: { id: opts.assignmentId }, select: { id: true, purpose: true } });
  if (!a) return fail("الاختبار غير موجود");
  if (a.purpose === "senior_position") return fail("اختبارُ المنصب يُحسم بقرار جهة الاعتماد لا بالإلغاء");
  const w = await prisma.assessmentAssignment.updateMany({
    where: { id: a.id, status: "assigned" },
    data: { status: "cancelled", cancelledAt: new Date(), cancelledByName: opts.session.user.name ?? "—", cancelReason: reason },
  });
  if (!w.count) return fail("سُلِّم هذا الاختبار أو أُلغي من قبل");
  await recordOrgEvent(prisma, {
    scope: "member", entityId: a.id, departmentId: "—", action: "assessment.cancelled",
    actor: { kind: "user", id: opts.session.user.id, name: opts.session.user.name ?? "—", role: opts.session.user.role },
    note: reason,
  });
  return { ok: true };
}

/** سجلُّ الاختبارات للقائد (يكلّف ويطّلع) — الأحدثُ أولاً */
export async function assessmentRegister(take = 100) {
  return prisma.assessmentAssignment.findMany({
    select: {
      id: true, purpose: true, status: true, score: true, reason: true, createdAt: true, completedAt: true, createdByName: true,
      cancelReason: true,
      member: { select: { fullName: true, email: true, department: { select: { name: true } } } },
      user: { select: { fullName: true, email: true, role: true } },
      seniorPosition: { select: { titleAr: true, status: true } },
      _count: { select: { attempts: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** **تفعيلُ منصب الإدارة العليا بعد الاجتياز — لجهة الاعتماد المستقلة وحدها** (ق١ وق٢). الاعتمادُ يفعّل المنصب، والرفضُ
 *  يُنهي التكليفَ بسببٍ مكتوب — وعضويةُ صاحبه القائمة لا تُمسّ في الحالين. */
export async function decideSeniorPositionAssessment(opts: {
  session: Session;
  assignmentId: string;
  decision: "approved" | "rejected";
  note?: string | null;
}): Promise<Ok> {
  const { isDesignatedApprover } = await import("@/lib/candidateDecision");
  if (!(await isDesignatedApprover(opts.session))) return fail("تفعيلُ مناصب الإدارة العليا لجهة الاعتماد المستقلة («اعتماد العضوية»)");
  const a = await prisma.assessmentAssignment.findUnique({
    where: { id: opts.assignmentId },
    select: {
      id: true, purpose: true, status: true, seniorPositionId: true, memberId: true, userId: true,
      seniorPosition: { select: { id: true, status: true, departmentId: true, startDate: true, holderMemberId: true, holderUserId: true } },
    },
  });
  if (!a || a.purpose !== "senior_position" || !a.seniorPosition) return fail("لا منصبَ مرتبطاً بهذا الاختبار");
  const self = (a.memberId && a.memberId === opts.session.user.id) || (a.userId && a.userId === opts.session.user.id);
  if (self) return fail("لا يحسم أحدٌ أمرَ نفسه");
  if (opts.decision === "approved" && a.status !== "passed") return fail("لا يُفعَّل المنصبُ قبل اجتياز اختبار الإدارة العليا");
  if (a.status === "assigned") return fail("لم يُسلَّم الاختبارُ بعد");
  const note = opts.note?.trim() || null;
  if (opts.decision === "rejected" && !note) return fail("اكتب سببَ عدم الاعتماد");
  const p = a.seniorPosition;
  const now = new Date();
  const actor = { kind: (opts.session.user.role === "member" ? "member" : "user") as "member" | "user", id: opts.session.user.id, name: opts.session.user.name ?? "—", role: opts.session.user.role };
  const written = await prisma.$transaction(async (tx) => {
    const w = await tx.seniorPosition.updateMany({
      where: { id: p.id, status: "pending" },
      data:
        opts.decision === "approved"
          ? { status: "active", startDate: p.startDate ?? now }
          : { status: "ended", endedAt: now, endedByName: actor.name, endReason: `لم يُعتمد بعد اختبار الإدارة العليا — ${note}` },
    });
    if (!w.count) return 0;
    await recordOrgEvent(tx, {
      scope: "senior", entityId: p.id, departmentId: p.departmentId,
      action: opts.decision === "approved" ? "senior.position.approved" : "senior.position.rejected",
      actor, before: { status: "pending" }, after: { status: opts.decision === "approved" ? "active" : "ended", assessment: a.id }, note,
    });
    return w.count;
  });
  return written ? { ok: true } : fail("حُسم أمرُ هذا المنصب من قبل");
}

/** مناصبُ تنتظر قرارَ جهة الاعتماد بعد اختبارٍ سُلِّم — لطابورها */
export async function seniorPositionsAwaitingDecision() {
  return prisma.assessmentAssignment.findMany({
    where: { purpose: "senior_position", status: { in: ["passed", "failed"] }, seniorPosition: { status: "pending" } },
    select: {
      id: true, status: true, score: true, completedAt: true,
      member: { select: { fullName: true, email: true } },
      user: { select: { fullName: true, email: true } },
      seniorPosition: { select: { titleAr: true } },
    },
    orderBy: { completedAt: "asc" },
  });
}
