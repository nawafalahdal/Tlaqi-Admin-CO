import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { appendMemberEvent } from "@/lib/googleSheets";
import { committeeGaps, GAP_LABELS } from "./completeness";
import { isCommitteeScopedLeader, CONVERSION_REMOVAL_REASON } from "./legacy";
import { recordOrgEvent } from "./audit";

/** **جردُ النظام الأول وتحويلُه — حالةً حالة، بقرار المؤسس، ولا حذف.**
 *
 *  `legacyInventory` يقرأ ولا يكتب: يصنّف كلَّ ما بقي من النظام الأول برمزه (L1…L10)،
 *  ويقول ما سيُفعل به وأثرَه على الحسابات والصلاحيات — قبل أي كتابة.
 *
 *  `applyLegacyCase` يطبّق حالةً واحدة: يُعيد قراءتها لحظةَ التنفيذ (فإعادتُه لا تكرّر
 *  شيئاً)، ويكتب في معاملةٍ واحدة التغييرَ وسجلَّ تدقيقه بـ«قبل» و«بعد»، ثم ما بعد
 *  المعاملة (نقلُ العمل المعلّق، والتواقيع، والشيت) — فلا يُعلَن عن تغييرٍ لم يُثبَّت.
 *
 *  والخطةُ كاملةً في `docs/TLAQI_COMMITTEE_LEAD_SEPARATION_PLAN_AR.md`. */

export type LegacyCode = "L1" | "L1b" | "L1x" | "L2" | "L3" | "L4" | "L4x" | "L5" | "L5x" | "L6" | "L7" | "L8" | "L9" | "L10";

export type LegacyCase = {
  key: string;
  code: LegacyCode;
  /** يُطبَّق آلياً؟ — وإلا فقرارٌ للمؤسس أو سجلٌّ يُعرض */
  auto: boolean;
  subject: string;
  committee: { id: string; name: string } | null;
  root: { id: string; name: string } | null;
  now: string;
  action: string;
  effect: string;
};

/** ترتيبُ التطبيق الدفعي: التداخلُ أولاً حتى يُعرف «القسم الأصيل» لكل ما بعده */
export const APPLY_ORDER: LegacyCode[] = ["L6", "L1", "L1b", "L3", "L4", "L5", "L5x", "L7", "L9"];

type Actor = { kind: "user"; id: string; name: string };
type Dept = { id: string; name: string; parentId: string | null; committeeStatus: string | null };

async function structure() {
  // department-scope: all — الجردُ يرى كلَّ لجنةٍ وقسم، المقترحَ والمغلقَ معاً
  const all: Dept[] = await prisma.department.findMany({
    select: { id: true, name: true, parentId: true, committeeStatus: true },
  });
  const byId = new Map(all.map((d) => [d.id, d]));
  /** أقربُ قسمٍ أصيل فوق هذا الصفّ — `null` إن انقطعت السلسلة أو دارت */
  const rootOf = (id: string | null): Dept | null => {
    let cur = id ? byId.get(id) : undefined;
    for (let i = 0; cur && i < 16; i++) {
      if (!cur.parentId) return cur;
      cur = byId.get(cur.parentId);
    }
    return null;
  };
  const committeeIds = all.filter((d) => d.parentId).map((d) => d.id);
  return { byId, rootOf, committeeIds };
}

const ref = (d: { id: string; name: string } | null | undefined) => (d ? { id: d.id, name: d.name } : null);

/** يقرأ ولا يكتب */
export async function legacyInventory(): Promise<{ cases: LegacyCase[]; counts: Partial<Record<LegacyCode, number>> }> {
  const { byId, rootOf, committeeIds } = await structure();
  const cases: LegacyCase[] = [];
  const push = (c: LegacyCase) => cases.push(c);
  const inCommittee = { departmentId: { in: committeeIds } };

  // ── L6: لجنةٌ داخل لجنة
  for (const id of committeeIds) {
    const d = byId.get(id)!;
    const parent = d.parentId ? byId.get(d.parentId) : null;
    if (parent?.parentId) {
      const root = rootOf(id);
      push({
        key: `L6:${id}`, code: "L6", auto: !!root, subject: d.name, committee: ref(d), root: ref(root),
        now: `داخل لجنة «${parent.name}»`,
        action: root ? `تُنقل تحت القسم الأصيل «${root.name}»` : "السلسلةُ منقطعة — قرارٌ للمؤسس",
        effect: "تخضع لقائد القسم الأصيل؛ لا أثرَ على الحسابات",
      });
    }
  }

  // ── L1/L1b/L1x/L2: الحساباتُ القيادية على لجان
  const users = await prisma.user.findMany({
    where: { role: "department_admin", ...inCommittee },
    select: { id: true, fullName: true, email: true, isActive: true, departmentId: true },
    orderBy: { createdAt: "asc" },
  });
  const memberRows = users.length
    ? await prisma.member.findMany({
        where: { email: { in: users.map((u) => u.email) } },
        select: { id: true, email: true, isActive: true, terminatedAt: true, approvalStatus: true, departmentId: true },
      })
    : [];
  const memberByEmail = new Map(memberRows.map((m) => [m.email, m]));
  for (const u of users) {
    const committee = byId.get(u.departmentId!)!;
    const root = rootOf(committee.id);
    if (!u.isActive) {
      push({
        key: `L2:${u.id}`, code: "L2", auto: false, subject: u.fullName, committee: ref(committee), root: ref(root),
        now: "حسابٌ قياديٌّ معطَّل على لجنة", action: "لا إجراء — سجلٌّ تاريخي", effect: "لا أثر",
      });
      continue;
    }
    const m = memberByEmail.get(u.email);
    const nested = !!committee.parentId && committee.parentId !== root?.id;
    const memberOk =
      !!m && m.isActive && !m.terminatedAt && m.approvalStatus === "approved" &&
      (m.departmentId === committee.id || m.departmentId === root?.id);
    if (!root || nested) {
      push({
        key: `L1x:${u.id}`, code: "L1x", auto: false, subject: u.fullName, committee: ref(committee), root: ref(root),
        now: "حسابٌ قياديٌّ نشط على لجنةٍ متداخلة أو منقطعة", action: "تُعالَج اللجنةُ أولاً (L6) ثم يُحوَّل",
        effect: "مجمَّدٌ حتى ذلك",
      });
    } else if (!m) {
      push({
        key: `L1b:${u.id}`, code: "L1b", auto: true, subject: u.fullName, committee: ref(committee), root: ref(root),
        now: "حسابٌ قياديٌّ نشط على لجنة، بلا سجلّ عضوية",
        action: `يُنشأ سجلُّ عضويته في «${root.name}» بكلمة مروره، ويقود اللجنة إن خلت، ويُعطَّل حسابُه القيادي`,
        effect: "يفقد صلاحيات قائد القسم كلَّها، ويصير قائداً للجنته وحدها",
      });
    } else if (!memberOk) {
      push({
        key: `L1x:${u.id}`, code: "L1x", auto: false, subject: u.fullName, committee: ref(committee), root: ref(root),
        now: "سجلُّ عضويته معطَّل أو منتهٍ أو في قسمٍ آخر", action: "قرارٌ للمؤسس — لا يُفعَّل أحدٌ آلياً",
        effect: "مجمَّدٌ حتى يُقرَّر",
      });
    } else {
      push({
        key: `L1:${u.id}`, code: "L1", auto: true, subject: u.fullName, committee: ref(committee), root: ref(root),
        now: "حسابٌ قياديٌّ نشط على لجنة (مجمَّد)",
        action: `يُنقل سجلُّ عضويته إلى «${root.name}» بكلمة مروره، ويقود اللجنة إن خلت، ويُعطَّل حسابُه القيادي، ويُنقل عملُه المعلّق`,
        effect: "يفقد صلاحيات قائد القسم كلَّها، ويصير قائداً للجنته وحدها",
      });
    }
  }

  // ── L3: أعضاءٌ قسمُهم لجنة
  const members = await prisma.member.findMany({
    where: { ...ROSTER_MEMBER_WHERE, ...inCommittee },
    select: { id: true, fullName: true, departmentId: true },
  });
  for (const m of members) {
    const committee = byId.get(m.departmentId!)!;
    const root = rootOf(committee.id);
    push({
      key: `L3:${m.id}`, code: "L3", auto: !!root, subject: m.fullName, committee: ref(committee), root: ref(root),
      now: "عضوٌ قسمُه اللجنة (النظام الأول)",
      action: root ? `يُنقل إلى «${root.name}» وتبقى عضويتُه في اللجنة` : "السلسلةُ منقطعة — قرارٌ للمؤسس",
      effect: "يديره قائدُ القسم الأصيل؛ لا تتغيّر صلاحياتُه",
    });
  }

  // ── L4/L4x: مرشّحون قسمُهم لجنة
  const candidates = await prisma.member.findMany({
    where: { isActive: true, approvalStatus: { notIn: ["approved", "rejected"] }, terminatedAt: null, ...inCommittee },
    select: { id: true, fullName: true, departmentId: true, invite: { select: { targetRole: true } } },
  });
  for (const m of candidates) {
    const committee = byId.get(m.departmentId!)!;
    const root = rootOf(committee.id);
    const lead = m.invite.targetRole !== "member";
    push({
      key: `${lead ? "L4x" : "L4"}:${m.id}`, code: lead ? "L4x" : "L4", auto: !lead && !!root, subject: m.fullName,
      committee: ref(committee), root: ref(root),
      now: lead ? "مرشّحٌ لقيادةٍ على لجنة" : "مرشّحُ عضويةٍ قسمُه لجنة",
      action: lead
        ? "اعتمادُه محجوبٌ في الكود — يُردّ بالمسار القائم أو يُدعى عضواً في القسم الأصيل (قرار)"
        : root ? `يُنقل ترشّحُه إلى «${root.name}»` : "السلسلةُ منقطعة — قرارٌ للمؤسس",
      effect: lead ? "لا يُنشأ حسابٌ قياديٌّ على لجنة" : "يعتمده قائدُ القسم الأصيل",
    });
  }

  // ── L5/L5x: دعواتٌ مفتوحة إلى لجنة
  const invites = await prisma.invite.findMany({
    where: { status: "open", ...inCommittee },
    select: { id: true, fullName: true, departmentId: true, targetRole: true },
  });
  for (const i of invites) {
    const committee = byId.get(i.departmentId!)!;
    const root = rootOf(committee.id);
    const lead = i.targetRole !== "member";
    push({
      key: `${lead ? "L5x" : "L5"}:${i.id}`, code: lead ? "L5x" : "L5", auto: lead || !!root, subject: i.fullName,
      committee: ref(committee), root: ref(root),
      now: lead ? "دعوةُ قيادةٍ مفتوحة إلى لجنة" : "دعوةُ عضويةٍ مفتوحة إلى لجنة",
      action: lead ? "تُنهى (`expired`) ولا تُحذف" : `تُوجَّه إلى «${root?.name ?? "—"}»`,
      effect: lead ? "لا مدخلَ قيادياً إلى لجنة" : "ينضمّ إلى القسم الأصيل",
    });
  }

  // ── L7/L8: لجانٌ ناقصة
  for (const id of committeeIds) {
    const d = byId.get(id)!;
    if (d.committeeStatus !== "pending_review" && d.committeeStatus !== "approved" && d.committeeStatus !== "suspended") continue;
    const gaps = await committeeGaps(prisma, id);
    if (!gaps?.length) continue;
    const pending = d.committeeStatus === "pending_review";
    push({
      key: `${pending ? "L7" : "L8"}:${id}`, code: pending ? "L7" : "L8", auto: pending, subject: d.name,
      committee: ref(d), root: ref(rootOf(id)),
      now: `${pending ? "بانتظار الاعتماد" : "معتمدة"} وينقصها: ${gaps.map((g) => GAP_LABELS[g]).join("، ")}`,
      action: pending ? "تُعاد مسودّةً بملاحظة ليستكملها قائدُ القسم ويرسلها" : "تبقى، ويظهر نقصُها لقائد القسم",
      effect: "لا أثرَ على الحسابات",
    });
  }

  // ── L9: تذاكرُ مفتوحة وجهتُها لجنة
  const tickets = await prisma.ticket.findMany({
    where: { status: { not: "resolved" }, targetDepartmentId: { in: committeeIds } },
    select: { id: true, subject: true, targetDepartmentId: true },
  });
  for (const t of tickets) {
    const committee = byId.get(t.targetDepartmentId!)!;
    const root = rootOf(committee.id);
    push({
      key: `L9:${t.id}`, code: "L9", auto: !!root, subject: t.subject, committee: ref(committee), root: ref(root),
      now: "تذكرةٌ مفتوحة وجهتُها لجنة", action: `تُوجَّه إلى «${root?.name ?? "—"}»`, effect: "يتسلّمها قائدُ القسم الأصيل",
    });
  }

  // ── L10: خططٌ ومهامّ وأهدافٌ بقسمٍ = لجنة (سجلٌّ تاريخي)
  const [plans, tasks, objectives] = await Promise.all([
    prisma.weekPlan.groupBy({ by: ["departmentId"], where: inCommittee, _count: { _all: true } }),
    prisma.planTask.groupBy({ by: ["departmentId"], where: inCommittee, _count: { _all: true } }),
    prisma.departmentObjective.groupBy({ by: ["departmentId"], where: inCommittee, _count: { _all: true } }),
  ]);
  const hist = new Map<string, { p: number; t: number; o: number }>();
  const bump = (id: string, k: "p" | "t" | "o", n: number) => {
    const h = hist.get(id) ?? { p: 0, t: 0, o: 0 };
    h[k] += n;
    hist.set(id, h);
  };
  plans.forEach((r) => bump(r.departmentId, "p", r._count._all));
  tasks.forEach((r) => r.departmentId && bump(r.departmentId, "t", r._count._all));
  objectives.forEach((r) => bump(r.departmentId, "o", r._count._all));
  for (const [id, h] of hist) {
    const d = byId.get(id)!;
    push({
      key: `L10:${id}`, code: "L10", auto: false, subject: d.name, committee: ref(d), root: ref(rootOf(id)),
      now: `${h.p} خطة أسبوعية، ${h.t} مهمة، ${h.o} هدف`, action: "سجلٌّ تاريخي يُحفظ ولا يُمسّ", effect: "لا أثر",
    });
  }

  const counts: Partial<Record<LegacyCode, number>> = {};
  for (const c of cases) counts[c.code] = (counts[c.code] ?? 0) + 1;
  return { cases, counts };
}

// ═════════════════════════════════════════════════════════════════════
//  التطبيق
// ═════════════════════════════════════════════════════════════════════

export type ApplyResult = { ok: true; key: string; done: "applied" | "already"; note?: string } | { ok: false; key: string; reason: string };

/** للمؤسس وحده — يُقرأ دورُه من القاعدة لا من الجلسة */
async function assertFounder(actor: Actor) {
  const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, isActive: true } });
  return !!u?.isActive && u.role === "super_admin";
}

export async function applyLegacyCase(actor: Actor, key: string): Promise<ApplyResult> {
  if (!(await assertFounder(actor))) return { ok: false, key, reason: "تطبيقُ الترحيل للمؤسس وحده" };
  const [code, id] = key.split(":") as [LegacyCode, string];
  if (!id || !APPLY_ORDER.includes(code)) return { ok: false, key, reason: "حالةٌ لا تُطبَّق آلياً — قرارٌ للمؤسس" };
  try {
    switch (code) {
      case "L6": return await reparent(actor, key, id);
      case "L1":
      case "L1b": return await convertLeader(actor, key, id);
      case "L3": return await moveMember(actor, key, id, true);
      case "L4": return await moveMember(actor, key, id, false);
      case "L5":
      case "L5x": return await fixInvite(actor, key, id);
      case "L7": return await returnToDraft(actor, key, id);
      case "L9": return await retargetTicket(actor, key, id);
    }
  } catch (e) {
    return { ok: false, key, reason: e instanceof Error ? e.message : "تعذّر التطبيق" };
  }
  return { ok: false, key, reason: "حالةٌ غير معروفة" };
}

/** كلُّ الحالات الآلية بترتيبها — ويُعاد الجردُ بعد حلّ التداخل */
export async function applyAllLegacy(actor: Actor): Promise<ApplyResult[]> {
  if (!(await assertFounder(actor))) return [{ ok: false, key: "*", reason: "تطبيقُ الترحيل للمؤسس وحده" }];
  const results: ApplyResult[] = [];
  for (const code of APPLY_ORDER) {
    const { cases } = await legacyInventory();
    for (const c of cases.filter((x) => x.code === code && x.auto)) results.push(await applyLegacyCase(actor, c.key));
  }
  return results;
}

const already = (key: string, note: string): ApplyResult => ({ ok: true, key, done: "already", note });

async function reparent(actor: Actor, key: string, committeeId: string): Promise<ApplyResult> {
  const { byId, rootOf } = await structure();
  const d = byId.get(committeeId);
  if (!d?.parentId) return already(key, "ليست لجنة");
  const parent = byId.get(d.parentId);
  if (!parent?.parentId) return already(key, "تحت قسمٍ أصيل بالفعل");
  const root = rootOf(committeeId);
  if (!root) return { ok: false, key, reason: "السلسلةُ منقطعة — قرارٌ للمؤسس" };
  await prisma.$transaction(async (tx) => {
    const w = await tx.department.updateMany({ where: { id: committeeId, parentId: d.parentId }, data: { parentId: root.id } });
    if (!w.count) throw new Error("تغيّرت اللجنةُ للتوّ — أعِد الجرد");
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: root.id, action: "legacy.reparented", actor,
      before: { parentId: d.parentId, parentName: parent.name }, after: { parentId: root.id, parentName: root.name },
    });
  });
  return { ok: true, key, done: "applied" };
}

/** الحالةُ الجوهرية: حسابٌ قياديٌّ على لجنة ← عضوٌ في القسم الأصيل وقائدٌ للجنته */
async function convertLeader(actor: Actor, key: string, userId: string): Promise<ApplyResult> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, fullName: true, email: true, isActive: true, role: true, passwordHash: true, mustChangePassword: true,
      phone: true, jobTitle: true, gender: true, specialization: true, section: true, profileCompletedAt: true, createdAt: true,
      departmentId: true, department: { select: { id: true, name: true, parentId: true, leadMemberId: true } },
    },
  });
  if (!u) return { ok: false, key, reason: "الحساب غير موجود" };
  if (!u.isActive || !isCommitteeScopedLeader(u)) return already(key, "حُوِّل أو عُطِّل من قبل");
  const committee = u.department!;
  const root = await prisma.department.findUnique({ where: { id: committee.parentId! }, select: { id: true, name: true, parentId: true } });
  if (!root || root.parentId) return { ok: false, key, reason: "اللجنةُ متداخلة — طبّق L6 أولاً" };

  const existing = await prisma.member.findUnique({
    where: { email: u.email },
    select: {
      id: true, isActive: true, terminatedAt: true, approvalStatus: true, departmentId: true, convertedFromUserId: true,
      passwordHash: true, invite: { select: { id: true, targetRole: true } },
    },
  });
  if (existing && (!existing.isActive || existing.terminatedAt || existing.approvalStatus !== "approved" ||
      (existing.departmentId !== committee.id && existing.departmentId !== root.id))) {
    return { ok: false, key, reason: "سجلُّ عضويته معطَّل أو منتهٍ أو في قسمٍ آخر — قرارٌ للمؤسس (L1x)" };
  }
  // بنكُ أسئلةٍ لدعوةٍ تقنية حين لا سجلّ — الحقلُ إلزاميٌّ في الدعوة، ولا اختبارَ يُفتح به
  const track = existing
    ? null
    : await prisma.testTrack.findFirst({
        where: { OR: [{ scope: "department_member", departmentId: root.id }, { scope: "department_member" }] },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
  if (!existing && !track) return { ok: false, key, reason: "لا بنكَ أسئلةٍ لعضوية القسم — تُنشأ الدعوةُ التقنية به" };

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    // الحرسُ في `where`: تحويلانِ متزامنان لا يمرّان
    const claimed = await tx.user.updateMany({
      where: { id: u.id, isActive: true, departmentId: committee.id },
      data: { isActive: false, removedAt: now, removalReason: CONVERSION_REMOVAL_REASON },
    });
    if (!claimed.count) throw new Error("حُوِّل هذا الحساب للتوّ — أعِد الجرد");

    let memberId: string;
    if (existing) {
      memberId = existing.id;
      await tx.member.update({
        where: { id: existing.id },
        data: {
          departmentId: root.id,
          passwordHash: u.passwordHash,
          mustChangePassword: u.mustChangePassword,
          convertedFromUserId: u.id,
          convertedAt: now,
        },
      });
      if (existing.invite.targetRole !== "member") {
        await tx.invite.update({ where: { id: existing.invite.id }, data: { targetRole: "member" } });
      }
    } else {
      const invite = await tx.invite.create({
        data: {
          fullName: u.fullName, email: u.email, targetRole: "member", departmentId: root.id, testTrackId: track!.id,
          invitedById: actor.id, status: "used",
        },
      });
      const m = await tx.member.create({
        data: {
          fullName: u.fullName, email: u.email, phone: u.phone, jobTitle: u.jobTitle, gender: u.gender,
          specialization: u.specialization, section: u.section, profileCompletedAt: u.profileCompletedAt,
          departmentId: root.id, inviteId: invite.id, passwordHash: u.passwordHash, mustChangePassword: u.mustChangePassword,
          approvalStatus: "approved", decidedAt: u.createdAt, joinDate: u.createdAt, credentialsIssuedAt: now,
          convertedFromUserId: u.id, convertedAt: now,
        },
        select: { id: true },
      });
      memberId = m.id;
    }

    // يقودها إن لم يكن لها قائدٌ عضو — ولو كانت بيد القائم بالخلافة (ملءُ الترحيل): يُرفع في الكتابة نفسها،
    // فقائدٌ واحد (قيدُ `Department_single_committee_lead`)
    const leads = !committee.leadMemberId;
    if (leads) {
      await tx.department.update({
        where: { id: committee.id },
        data: { leadMemberId: memberId, actingLeadUserId: null, actingLeadSince: null, actingLeadReason: null },
      });
    }
    await tx.committeeMembership.upsert({
      where: { committeeId_memberId: { committeeId: committee.id, memberId } },
      create: { committeeId: committee.id, memberId, addedByName: actor.name },
      update: { active: true, removedAt: null, removedByName: null },
    });
    await tx.marketingMember.updateMany({ where: { userId: u.id }, data: { active: false, nameSnapshot: u.fullName } });

    await recordOrgEvent(tx, {
      scope: "committee", entityId: committee.id, departmentId: root.id, action: "legacy.lead_converted", actor,
      before: {
        userId: u.id, role: u.role, userDepartmentId: committee.id, userActive: true,
        memberId: existing?.id ?? null, memberDepartmentId: existing?.departmentId ?? null,
        inviteRole: existing?.invite.targetRole ?? null, committeeLeadMemberId: committee.leadMemberId,
      },
      after: {
        userId: u.id, userActive: false, removalReason: CONVERSION_REMOVAL_REASON,
        memberId, memberDepartmentId: root.id, inviteRole: "member", createdMember: !existing,
        committeeLeadMemberId: leads ? memberId : committee.leadMemberId,
      },
      note: leads ? "قائدُ اللجنة" : "عضوٌ في اللجنة — لها قائدٌ من قبل",
    });
    return { memberId, leads };
  });

  // ما بعد المعاملة — لا يُبطل التحويل إن تعثّر، ويُقال ما تعثّر
  const notes: string[] = [result.leads ? "صار قائداً للجنة" : "صار عضواً فيها (لها قائد)"];
  try {
    const heir =
      (await prisma.user.findFirst({ where: { isActive: true, role: "department_admin", departmentId: root.id }, select: { id: true, fullName: true }, orderBy: { createdAt: "asc" } })) ??
      (await prisma.user.findFirst({ where: { isActive: true, role: "executive" }, select: { id: true, fullName: true }, orderBy: { createdAt: "asc" } })) ??
      (await prisma.user.findFirst({ where: { isActive: true, role: "super_admin" }, select: { id: true, fullName: true }, orderBy: { createdAt: "asc" } }));
    if (heir) {
      const { transferResponsibilities, describeTransfer } = await import("@/lib/succession");
      notes.push(describeTransfer(await transferResponsibilities({ fromUserId: u.id, toUserId: heir.id, byName: actor.name }), heir.fullName));
    }
  } catch {
    notes.push("تعذّر نقلُ العمل المعلّق — يُعاد من صفحة الحساب");
  }
  try {
    const { supersedeSignatures } = await import("@/lib/signatures");
    await supersedeSignatures(u.id, "تحويل قيادة لجنة إلى عضوية");
  } catch {
    notes.push("تعذّر إبطالُ التوقيع");
  }
  try {
    const { syncAdminAccountRow, syncMemberLifecycleRow } = await import("@/lib/workflow");
    await syncAdminAccountRow(u.id);
    await syncMemberLifecycleRow(result.memberId);
    await appendMemberEvent({
      fullName: u.fullName, email: u.email, event: "تحويل قيادة لجنة إلى عضوية",
      roleOrDepartment: `${root.name} ← ${committee.name}`,
      details: `${notes.join(". ")} — نفّذه: ${actor.name}`, at: now,
    });
  } catch {
    notes.push("تعذّرت مزامنةُ الشيت — تُعاد في المزامنة التالية");
  }
  return { ok: true, key, done: "applied", note: notes.join(" · ") };
}

async function moveMember(actor: Actor, key: string, memberId: string, roster: boolean): Promise<ApplyResult> {
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: { fullName: true, departmentId: true, department: { select: { id: true, parentId: true } } },
  });
  if (!m?.department?.parentId) return already(key, "قسمُه أصيلٌ بالفعل");
  const { rootOf } = await structure();
  const root = rootOf(m.department.id);
  if (!root) return { ok: false, key, reason: "السلسلةُ منقطعة — قرارٌ للمؤسس" };
  const committeeId = m.department.id;
  await prisma.$transaction(async (tx) => {
    const w = await tx.member.updateMany({ where: { id: memberId, departmentId: committeeId }, data: { departmentId: root.id } });
    if (!w.count) throw new Error("تغيّر قسمُه للتوّ — أعِد الجرد");
    // العضويةُ في اللجنة تبقى — ولا تُعاد عضويةٌ أُنهيت من قبل
    if (roster) {
      await tx.committeeMembership.upsert({
        where: { committeeId_memberId: { committeeId, memberId } },
        create: { committeeId, memberId, addedByName: actor.name },
        update: {},
      });
    }
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: root.id,
      action: roster ? "legacy.member_moved" : "legacy.candidate_moved", actor,
      before: { memberId, name: m.fullName, departmentId: committeeId }, after: { memberId, departmentId: root.id },
    });
  });
  return { ok: true, key, done: "applied" };
}

async function fixInvite(actor: Actor, key: string, inviteId: string): Promise<ApplyResult> {
  const i = await prisma.invite.findUnique({
    where: { id: inviteId },
    select: { status: true, targetRole: true, fullName: true, department: { select: { id: true, parentId: true } } },
  });
  if (!i || i.status !== "open" || !i.department?.parentId) return already(key, "لم تعد دعوةً مفتوحة إلى لجنة");
  const { rootOf } = await structure();
  const root = rootOf(i.department.id);
  const lead = i.targetRole !== "member";
  if (!lead && !root) return { ok: false, key, reason: "السلسلةُ منقطعة — قرارٌ للمؤسس" };
  const data: Prisma.InviteUncheckedUpdateManyInput = lead ? { status: "expired" } : { departmentId: root!.id };
  await prisma.$transaction(async (tx) => {
    const w = await tx.invite.updateMany({ where: { id: inviteId, status: "open", departmentId: i.department!.id }, data });
    if (!w.count) throw new Error("تغيّرت الدعوةُ للتوّ — أعِد الجرد");
    await recordOrgEvent(tx, {
      scope: "committee", entityId: i.department!.id, departmentId: root?.id ?? i.department!.parentId!,
      action: lead ? "legacy.invite_expired" : "legacy.invite_retargeted", actor,
      before: { inviteId, name: i.fullName, status: "open", departmentId: i.department!.id, targetRole: i.targetRole },
      after: lead ? { inviteId, status: "expired" } : { inviteId, departmentId: root!.id },
    });
  });
  return { ok: true, key, done: "applied" };
}

async function returnToDraft(actor: Actor, key: string, committeeId: string): Promise<ApplyResult> {
  const d = await prisma.department.findUnique({ where: { id: committeeId }, select: { parentId: true, committeeStatus: true } });
  if (!d?.parentId || d.committeeStatus !== "pending_review") return already(key, "ليست بانتظار الاعتماد");
  const gaps = await committeeGaps(prisma, committeeId);
  if (!gaps?.length) return already(key, "مكتملةٌ — تبقى بانتظار القرار");
  const note = "أُعيدت مسودّةً لاستكمال بياناتها قبل الاعتماد (ترحيل فصل قيادة اللجنة)";
  await prisma.$transaction(async (tx) => {
    const w = await tx.department.updateMany({
      where: { id: committeeId, committeeStatus: "pending_review" },
      data: { committeeStatus: "draft", statusChangedAt: new Date(), statusNote: note },
    });
    if (!w.count) throw new Error("تغيّرت حالتُها للتوّ — أعِد الجرد");
    await recordOrgEvent(tx, {
      scope: "committee", entityId: committeeId, departmentId: d.parentId!, action: "legacy.returned_to_draft", actor,
      before: { status: "pending_review", gaps }, after: { status: "draft" }, note,
    });
  });
  return { ok: true, key, done: "applied" };
}

async function retargetTicket(actor: Actor, key: string, ticketId: string): Promise<ApplyResult> {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true, targetDepartment: { select: { id: true, parentId: true } } },
  });
  if (!t || t.status === "resolved" || !t.targetDepartment?.parentId) return already(key, "لم تعد تذكرةً مفتوحة إلى لجنة");
  const { rootOf } = await structure();
  const root = rootOf(t.targetDepartment.id);
  if (!root) return { ok: false, key, reason: "السلسلةُ منقطعة — قرارٌ للمؤسس" };
  const from = t.targetDepartment.id;
  await prisma.$transaction(async (tx) => {
    const w = await tx.ticket.updateMany({ where: { id: ticketId, targetDepartmentId: from }, data: { targetDepartmentId: root.id } });
    if (!w.count) throw new Error("تغيّرت التذكرةُ للتوّ — أعِد الجرد");
    await recordOrgEvent(tx, {
      scope: "committee", entityId: from, departmentId: root.id, action: "legacy.ticket_retargeted", actor,
      before: { ticketId, targetDepartmentId: from }, after: { ticketId, targetDepartmentId: root.id },
    });
  });
  return { ok: true, key, done: "applied" };
}
