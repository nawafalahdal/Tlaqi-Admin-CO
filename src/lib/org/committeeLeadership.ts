import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { recordOrgEvent } from "./audit";

/** **قيادةُ اللجنة: من يقودها الآن، ومن يخلفه — قائدٌ فعّالٌ واحد، ولا لجنةَ عاملةً بلا قائد.**
 *
 *  - **القائدُ النشطُ المعتمد:** عضوٌ (`leadMemberId`) نشطٌ معتمد، غيرُ موقوفٍ ولا مغادر، في قسم اللجنة.
 *  - **القيادةُ بالخلافة:** إن غادر القائدُ أو انتهت عضويتُه أو عُطِّل حسابُه، تنتقل القيادةُ **آلياً** إلى
 *    الخَلَف وفق آلية الخلافة المعتمدة في المنصة (`succession.ts`): **أقدمُ رئيسٍ تنفيذيٍّ نشط، ثم المؤسس**
 *    — شخصٌ واحدٌ مسؤول، لا قيادتان (`actingLeadUserId`).
 *  - **في القاعدة لا في الشيفرة وحدها:** قيدُ `Department_single_committee_lead` يمنع اجتماعَ القائدين،
 *    وقيدُ `Department_active_committee_has_lead` يمنع لجنةً نشطةً أو معلّقةً بلا قائد. والانتقالُ في
 *    معاملةٍ واحدة بقفلٍ على صفّ اللجنة (`FOR UPDATE`)، وبحرسٍ في `where` — فالمتزامنان لا يمرّان معاً،
 *    والمكرَّرُ لا يكتب شيئاً. */

type Db = Prisma.TransactionClient | typeof prisma;

/** حالاتُ اللجنة التي يلزمها قائد (العاملة والمعلّقة) — تطابق قيدَ القاعدة */
export const LEAD_REQUIRED: readonly string[] = ["approved", "suspended"];

/** عضوٌ يصلح قائداً الآن: نشطٌ معتمدٌ غيرُ موقوفٍ ولا مغادرٍ، في القسم الأصيل للجنة */
export async function isActiveLeadMember(db: Db, memberId: string | null, parentId: string | null): Promise<boolean> {
  if (!memberId || !parentId) return false;
  const m = await db.member.findFirst({
    where: { id: memberId, ...ROSTER_MEMBER_WHERE, terminatedAt: null, suspendedAt: null, departmentId: parentId },
    select: { id: true },
  });
  return !!m;
}

export type LeadState = {
  /** قائدٌ عضوٌ نشطٌ معتمد — وحينها صلاحيةُ المؤسس والرئيس اطّلاعٌ فقط */
  leadActive: boolean;
  actingLeadUserId: string | null;
  actingLeadName: string | null;
};

export async function committeeLeadState(
  db: Db,
  c: { parentId: string | null; leadMemberId: string | null; actingLeadUserId?: string | null }
): Promise<LeadState> {
  const leadActive = await isActiveLeadMember(db, c.leadMemberId, c.parentId);
  const acting = c.actingLeadUserId
    ? await db.user.findUnique({ where: { id: c.actingLeadUserId }, select: { fullName: true, isActive: true } })
    : null;
  return {
    leadActive,
    actingLeadUserId: acting?.isActive ? c.actingLeadUserId! : null,
    actingLeadName: acting?.isActive ? acting.fullName : null,
  };
}

/** الخَلَف وفق آلية الخلافة المعتمدة: أقدمُ رئيسٍ تنفيذيٍّ نشط، ثم أقدمُ مؤسس */
export async function committeeSuccessor(db: Db, excludeUserId?: string | null) {
  for (const role of ["executive", "super_admin"] as const) {
    const u = await db.user.findFirst({
      where: { role, isActive: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
      select: { id: true, fullName: true, role: true },
      orderBy: { createdAt: "asc" },
    });
    if (u) return u;
  }
  return null;
}

export type SuccessionSource = "automatic" | "administrative";

/** **الخلافةُ داخل معاملةٍ قائمة** — يقفل صفَّ اللجنة ويقرأ حالتها من جديد، ثم ينقل القيادة إن لزم.
 *  لا يفعل شيئاً إن كان لها قائدٌ نشط، أو قائمٌ بالخلافة نشط، أو لم تكن عاملةً ولا معلّقة. */
export async function succeedInTx(
  tx: Prisma.TransactionClient,
  committeeId: string,
  opts: { reason: string; source: SuccessionSource; byName: string; excludeUserId?: string | null }
): Promise<{ changed: boolean; actingLeadUserId: string | null }> {
  await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${committeeId} FOR UPDATE`;
  const c = await tx.department.findUnique({
    where: { id: committeeId },
    select: {
      parentId: true,
      committeeStatus: true,
      leadMemberId: true,
      leadMember: { select: { fullName: true } },
      actingLeadUserId: true,
      actingLeadUser: { select: { fullName: true, isActive: true } },
    },
  });
  if (!c?.parentId || !c.committeeStatus || !LEAD_REQUIRED.includes(c.committeeStatus)) {
    return { changed: false, actingLeadUserId: c?.actingLeadUserId ?? null };
  }
  if (await isActiveLeadMember(tx, c.leadMemberId, c.parentId)) return { changed: false, actingLeadUserId: null };
  const actingOk = !!c.actingLeadUserId && !!c.actingLeadUser?.isActive && c.actingLeadUserId !== opts.excludeUserId;
  if (actingOk) return { changed: false, actingLeadUserId: c.actingLeadUserId };

  const heir = await committeeSuccessor(tx, opts.excludeUserId ?? c.actingLeadUserId);
  if (!heir) throw new Error("لا خَلَفَ نشطاً (رئيسٌ تنفيذيٌّ أو مؤسس) يتسلّم قيادة اللجنة");
  const now = new Date();
  // الحرسُ في `where`: ما قرأناه هو ما نكتب عليه — فخلافتان متزامنتان لا تمرّان
  const w = await tx.department.updateMany({
    where: { id: committeeId, leadMemberId: c.leadMemberId, actingLeadUserId: c.actingLeadUserId },
    data: { leadMemberId: null, actingLeadUserId: heir.id, actingLeadSince: now, actingLeadReason: opts.reason.slice(0, 200) },
  });
  if (!w.count) return { changed: false, actingLeadUserId: null };
  // عضويةُ القائد المغادر تُغلق ولا تُحذف — والقيادةُ لا تبقى معلّقةً باسمه
  if (c.leadMemberId) {
    await tx.committeeMembership.updateMany({
      where: { committeeId, memberId: c.leadMemberId, active: true },
      data: { active: false, removedAt: now, removedByName: opts.byName },
    });
  }
  await recordOrgEvent(tx, {
    scope: "committee",
    entityId: committeeId,
    departmentId: c.parentId,
    action: "committee.succession",
    actor: { kind: "system", id: opts.source === "automatic" ? "system" : "admin", name: opts.byName },
    before: {
      leadMemberId: c.leadMemberId,
      leadName: c.leadMember?.fullName ?? null,
      actingLeadUserId: c.actingLeadUserId,
      actingLeadName: c.actingLeadUser?.fullName ?? null,
    },
    after: { actingLeadUserId: heir.id, actingLeadName: heir.fullName, actingLeadRole: heir.role, source: opts.source, at: now.toISOString() },
    note: opts.reason.slice(0, 200),
  });
  return { changed: true, actingLeadUserId: heir.id };
}

export async function ensureCommitteeSuccession(
  committeeId: string,
  opts: { reason: string; source: SuccessionSource; byName: string; excludeUserId?: string | null }
) {
  return prisma.$transaction((tx) => succeedInTx(tx, committeeId, opts));
}

/** قائدُ لجنةٍ غادر أو انتهت عضويتُه أو عُطِّل حسابُه: تنتقل قيادةُ لجانه العاملة آلياً.
 *  ومسودّاتُها وطلباتُها لا خلافةَ فيها — يختار مقترحُها قائداً آخر قبل الإرسال. */
export async function succeedCommitteesLedBy(memberId: string, reason: string, byName = "المنصة — خلافة آلية") {
  // department-scope: all — كلُّ لجنةٍ يقودها، بأي حالة
  const led = await prisma.department.findMany({
    where: { leadMemberId: memberId, parentId: { not: null } },
    select: { id: true, parentId: true, committeeStatus: true, leadMember: { select: { fullName: true } } },
  });
  let moved = 0;
  for (const c of led) {
    if (c.committeeStatus && LEAD_REQUIRED.includes(c.committeeStatus)) {
      const r = await ensureCommitteeSuccession(c.id, { reason, source: "automatic", byName });
      if (r.changed) moved++;
    } else {
      // مسودّةٌ أو طلبُ اعتماد: يُكتب الحدث، ويظهر نقصُ القائد لمقترحها
      await recordOrgEvent(prisma, {
        scope: "committee", entityId: c.id, departmentId: c.parentId!, action: "committee.lead_departed",
        actor: { kind: "system", id: "system", name: "المنصة" },
        before: { leadMemberId: memberId, leadName: c.leadMember?.fullName ?? null },
        note: reason.slice(0, 200),
      });
    }
  }
  return { committees: led.length, succeeded: moved };
}

/** القائمُ بالخلافة نفسُه عُطِّل أو سيُحذف: تنتقل اللجانُ التي بيده إلى الخَلَف التالي */
export async function reassignActingLeads(userId: string, reason: string, byName: string) {
  // department-scope: all — كلُّ لجنةٍ بيده بالخلافة
  const held = await prisma.department.findMany({ where: { actingLeadUserId: userId }, select: { id: true } });
  for (const c of held) {
    await ensureCommitteeSuccession(c.id, { reason, source: "automatic", byName, excludeUserId: userId });
  }
  return held.length;
}

/** **شبكةُ الأمان** في الكنس اليومي: كلُّ لجنةٍ عاملةٍ أو معلّقةٍ قائدُها غيرُ نشطٍ ولا قائمَ بالخلافة نشطاً
 *  تُخلَف — فلا يُعتمد على أن كلَّ مسار مغادرةٍ نادى الخلافة */
export async function reconcileCommitteeLeadership(): Promise<number> {
  // department-scope: all — اللجانُ العاملة والمعلّقة كلُّها
  const rows = await prisma.department.findMany({
    where: { parentId: { not: null }, committeeStatus: { in: ["approved", "suspended"] } },
    select: { id: true, parentId: true, leadMemberId: true, actingLeadUserId: true },
    take: 2000,
  });
  let moved = 0;
  for (const c of rows) {
    const s = await committeeLeadState(prisma, c);
    if (s.leadActive || s.actingLeadUserId) continue;
    const r = await ensureCommitteeSuccession(c.id, { reason: "شبكة الأمان: قائدٌ غيرُ نشط", source: "automatic", byName: "المنصة — خلافة آلية" });
    if (r.changed) moved++;
  }
  return moved;
}
