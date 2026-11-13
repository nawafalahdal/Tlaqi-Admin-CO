import { prisma } from "@/lib/prisma";
import { assignMemberEmployeeNo, assignUserEmployeeNo } from "@/lib/employeeId";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { appendMemberEvent } from "@/lib/googleSheets";
import { revokeAccess } from "@/lib/accessRevocation";
import { fail, recordOrgEvent, type OrgResult } from "./audit";

/** **تغييرُ قائد القسم بقرارٍ إداريٍّ موثَّق — للمؤسس والرئيس التنفيذي وحدهما** (المرحلة الثالثة، المتطلب الأول).
 *
 *  القرارُ مباشر بلا موافقة طرفٍ آخر، لكنه لا يقع بلا سببٍ مكتوب ولا بلا تأكيد، ولا يُحذف به شيء:
 *  - **القائدُ السابق:** يُعطَّل حسابُه القيادي (سجلاً لا حذفاً)، ويعود **عضواً** في قسمه بكلمة مروره نفسها —
 *    تُسحب القيادةُ لا الشخص. ومن أراد إخراجَه فبابُه «إنهاء العضوية وإزالة الوصول».
 *  - **القائدُ الجديد:** عضوٌ نشطٌ معتمدٌ في القسم نفسه، يُرقّى إلى حسابٍ قياديٍّ بكلمة مروره نفسها.
 *  - **العملُ المفتوح:** ينتقل من السابق إلى الجديد — مهامُّ القسم المفتوحةُ باسمه، وأهدافُه القائمة،
 *    والدعوات، وطلباتُ الاعتماد ومساراتُها، والتذاكرُ المفتوحة، وطلباتُ الإنهاء المنتظرة. والمُنجَزُ باسم من فعله.
 *  - **اللجان لا تُمسّ:** لا يتغيّر قائدُ لجنةٍ ولا عضويةٌ فيها. ومن يقود لجنةً عاملةً لا يُرقّى حتى تنتهي قيادتُه.
 *  - **التاريخ:** حدثٌ في سجلّ التدقيق بالقائد السابق والجديد والسبب ومن قرّر ومتى (`department.leader_changed`)،
 *    ومنه يُقرأ سجلُّ القيادة. والتوقيعُ لا يُنقل: يُبطَل توقيعُ السابق ويُطلب توقيعُ الجديد.
 *  - **الجلسات:** تُبطَل جلسةُ السابق القيادية وجلسةُ الجديد العضوية فوراً (`accessRevocation`) — فيدخل كلٌّ بهويته الجديدة. */

const OPEN_PLAN_STATES = ["not_started", "in_progress", "submitted", "returned"] as const;
const CLOSED_OBJECTIVES = ["done", "missed", "rejected"] as const;
const LEAD_REQUIRED = ["approved", "suspended"] as const;

type TopActor = { kind: "user"; id: string; name: string };

/** المؤسسُ أو الرئيسُ التنفيذي — من القاعدة لا من الجلسة */
export async function assertTopActor(actorId: string): Promise<TopActor | null> {
  const u = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, fullName: true, role: true, isActive: true } });
  return u?.isActive && (u.role === "super_admin" || u.role === "executive") ? { kind: "user", id: u.id, name: u.fullName } : null;
}

/** ما يُعرض قبل القرار: القائدُ الحالي، والمرشّحون، والعملُ المفتوح، وسجلُّ القيادة */
export async function departmentLeaderChangePreview(actorId: string, departmentId: string) {
  if (!(await assertTopActor(actorId))) return null;
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, slug: true, parentId: true, committeeStatus: true, leadershipOnly: true },
  });
  if (!dept || dept.parentId || dept.committeeStatus || dept.leadershipOnly) return null;
  const leaders = await prisma.user.findMany({
    where: { isActive: true, role: "department_admin", departmentId },
    select: { id: true, fullName: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const ids = leaders.map((l) => l.id);
  const [planTasks, objectives, tickets, approvals, members, ledCommittees, history] = await Promise.all([
    ids.length ? prisma.planTask.count({ where: { ownerUserId: { in: ids }, departmentId, execState: { in: [...OPEN_PLAN_STATES] } } }) : 0,
    ids.length ? prisma.departmentObjective.count({ where: { leadUserId: { in: ids }, departmentId, status: { notIn: [...CLOSED_OBJECTIVES] } } }) : 0,
    ids.length ? prisma.ticket.count({ where: { targetUserId: { in: ids }, status: { not: "resolved" } } }) : 0,
    ids.length ? prisma.ticket.count({ where: { approverUserId: { in: ids }, approvalState: { in: ["awaiting", "reviewing"] } } }) : 0,
    prisma.member.findMany({
      where: { ...ROSTER_MEMBER_WHERE, terminatedAt: null, suspendedAt: null, departmentId },
      select: { id: true, fullName: true, jobTitle: true },
      orderBy: { fullName: "asc" },
      take: 300,
    }),
    // department-scope: all — لجانٌ عاملةٌ يقودها عضوٌ من القسم: لا يُرقّى قائدُها حتى تنتهي قيادتُه
    prisma.department.findMany({
      where: { parentId: departmentId, committeeStatus: { in: [...LEAD_REQUIRED] }, leadMemberId: { not: null } },
      select: { leadMemberId: true, name: true },
    }),
    prisma.orgAuditEvent.findMany({
      where: { entityId: departmentId, action: "department.leader_changed" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, actorName: true, before: true, after: true, note: true },
    }),
  ]);
  const leading = new Map(ledCommittees.map((c) => [c.leadMemberId!, c.name]));
  return {
    dept,
    current: leaders,
    openWork: { planTasks, objectives, tickets, approvals },
    candidates: members.map((m) => ({ ...m, leadsCommittee: leading.get(m.id) ?? null })),
    history,
  };
}

export type LeaderChangeResult = OrgResult<{ previous: string[]; next: string; moved: Record<string, number> }>;

export async function changeDepartmentLeader(
  actorId: string,
  departmentId: string,
  newLeaderMemberId: string,
  reason: string,
  confirm: boolean
): Promise<LeaderChangeResult> {
  const actor = await assertTopActor(actorId);
  if (!actor) return fail("تغييرُ قائد القسم للمؤسس والرئيس التنفيذي وحدهما");
  if (!confirm) return fail("أكِّد القرار أولاً — يُعرض أثرُه قبل تنفيذه");
  const why = reason?.trim().slice(0, 300);
  if (!why) return fail("سببُ التغيير مطلوب — القرارُ الإداريُّ يُوثَّق بسببه");
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, parentId: true, committeeStatus: true, leadershipOnly: true, deputyMemberId: true, deputyPermissions: true },
  });
  if (!dept || dept.parentId || dept.committeeStatus) return fail("يُغيَّر قائدُ قسمٍ أصيلٍ قائم — لا لجنة");
  if (dept.leadershipOnly) return fail("الإدارةُ العليا لا قائدَ قسمٍ لها — يقودها الرئيسُ التنفيذي");

  const m = await prisma.member.findFirst({
    where: { id: newLeaderMemberId, ...ROSTER_MEMBER_WHERE, terminatedAt: null, suspendedAt: null, departmentId },
    select: {
      id: true, fullName: true, email: true, passwordHash: true, mustChangePassword: true, phone: true, jobTitle: true,
      gender: true, specialization: true, section: true, profileCompletedAt: true, inviteId: true,
    },
  });
  if (!m) return fail("القائدُ البديل عضوٌ نشطٌ معتمدٌ في القسم نفسه");
  // department-scope: all — لجنةٌ عاملةٌ يقودها: تغييرُ قائد القسم لا يغيّر قيادةَ لجنة
  const leads = await prisma.department.findFirst({
    where: { leadMemberId: m.id, parentId: { not: null }, committeeStatus: { in: [...LEAD_REQUIRED] } },
    select: { name: true },
  });
  if (leads) return fail(`هذا العضوُ يقود لجنة «${leads.name}» — لا تتغيّر قيادتُها بتغيير قائد القسم، ولا يُرقّى حتى تنتهي قيادتُه لها`);
  const existingUser = await prisma.user.findUnique({ where: { email: m.email }, select: { id: true, isActive: true } });
  if (existingUser?.isActive) return fail("لهذا البريد حسابٌ إداريٌّ نشط بالفعل");

  const now = new Date();
  const moved = { planTasks: 0, objectives: 0, ticketsTarget: 0, approvals: 0, invites: 0, terminations: 0 };
  const result = await prisma.$transaction(async (tx) => {
    // قفلُ صفّ القسم: قراران متزامنان على قسمٍ واحد يمضي أحدُهما والآخرُ يقرأ ما كتبه
    await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${departmentId} FOR UPDATE`;
    const olds = await tx.user.findMany({
      where: { isActive: true, role: "department_admin", departmentId },
      select: { id: true, fullName: true, email: true, passwordHash: true, mustChangePassword: true, createdAt: true },
    });

    // ── القائدُ الجديد: يُعاد تفعيلُ حسابه القياديّ السابق إن وُجد، وإلا يُنشأ — وكلمةُ مروره كلمتُه
    const pw = m.passwordHash;
    // رقمُه الوظيفي من عضويته — يحمله حسابُه القياديّ نفسَه (لكل شخصٍ رقمٌ واحد)
    const memberNo = (await tx.member.findUnique({ where: { id: m.id }, select: { employeeNo: true } }))?.employeeNo ?? null;
    let newUserId: string;
    if (existingUser) {
      const re = await tx.user.updateMany({
        where: { id: existingUser.id, isActive: false },
        data: {
          isActive: true, role: "department_admin", departmentId, removedAt: null, removalReason: null,
          ...(pw ? { passwordHash: pw, mustChangePassword: m.mustChangePassword } : {}),
        },
      });
      if (!re.count) throw new Error("تغيّر حسابُ القائد البديل للتوّ — أعِد المحاولة");
      newUserId = existingUser.id;
      await assignUserEmployeeNo(tx, newUserId, memberNo);
    } else {
      const u = await tx.user.create({
        data: {
          fullName: m.fullName, email: m.email, passwordHash: pw ?? "!", mustChangePassword: pw ? m.mustChangePassword : true,
          role: "department_admin", departmentId, phone: m.phone, jobTitle: m.jobTitle, gender: m.gender,
          specialization: m.specialization, section: m.section, profileCompletedAt: m.profileCompletedAt,
          ...(memberNo != null ? { employeeNo: memberNo } : {}),
        },
        select: { id: true },
      });
      newUserId = u.id;
    }
    {
      const userNo = (await tx.user.findUnique({ where: { id: newUserId }, select: { employeeNo: true } }))?.employeeNo ?? null;
      await assignMemberEmployeeNo(tx, m.id, userNo);
    }
    // مدخلٌ واحدٌ لكل شخص: سجلُّ عضويته يصير سجلَّ ترقيته (كما عند اعتماد قائدٍ مرشّح)
    await tx.member.update({ where: { id: m.id }, data: { passwordHash: null } });
    await tx.invite.update({ where: { id: m.inviteId }, data: { targetRole: "department_admin" } });
    // النائبُ لا يكون قائداً: إن رُقّي النائبُ خلا مقعدُ النيابة
    if (dept.deputyMemberId === m.id) {
      await tx.department.update({
        where: { id: departmentId },
        data: { deputyMemberId: null, deputyPermissions: [], deputyAppointedAt: null, deputyAppointedByName: null },
      });
    }

    // ── القائدُ السابق: تُسحب القيادة ويبقى عضواً في قسمه
    const oldMembers: { userId: string; memberId: string | null }[] = [];
    for (const o of olds) {
      await tx.user.update({
        where: { id: o.id },
        data: { isActive: false, removedAt: now, removalReason: `تغيير قائد القسم بقرار إداري — ${why}` },
      });
      const rec = await tx.member.findUnique({
        where: { email: o.email },
        select: { id: true, isActive: true, terminatedAt: true, approvalStatus: true, inviteId: true },
      });
      // يعود عضواً برقمه الوظيفي نفسِه
      const oldNo = (await tx.user.findUnique({ where: { id: o.id }, select: { employeeNo: true } }))?.employeeNo ?? null;
      let memberId: string | null = null;
      if (rec && rec.isActive && !rec.terminatedAt && rec.approvalStatus === "approved") {
        await tx.member.update({
          where: { id: rec.id },
          data: { departmentId, passwordHash: o.passwordHash, mustChangePassword: o.mustChangePassword, convertedFromUserId: o.id, convertedAt: now },
        });
        await tx.invite.update({ where: { id: rec.inviteId }, data: { targetRole: "member" } });
        memberId = rec.id;
        await assignMemberEmployeeNo(tx, rec.id, oldNo);
      } else if (!rec) {
        const track = await tx.testTrack.findFirst({
          where: { OR: [{ scope: "department_member", departmentId }, { scope: "department_member" }] },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (track) {
          const inv = await tx.invite.create({
            data: { fullName: o.fullName, email: o.email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: actor.id, status: "used" },
          });
          const created = await tx.member.create({
            data: {
              fullName: o.fullName, email: o.email, departmentId, inviteId: inv.id, passwordHash: o.passwordHash,
              mustChangePassword: o.mustChangePassword, approvalStatus: "approved", decidedAt: o.createdAt, joinDate: o.createdAt,
              credentialsIssuedAt: now, convertedFromUserId: o.id, convertedAt: now,
            },
            select: { id: true },
          });
          memberId = created.id;
          await assignMemberEmployeeNo(tx, created.id, oldNo);
        }
      }
      oldMembers.push({ userId: o.id, memberId });

      // ── العملُ المفتوح في القسم: من السابق إلى الجديد (والمُنجَزُ باسم من فعله)
      moved.planTasks += (await tx.planTask.updateMany({
        where: { ownerUserId: o.id, departmentId, execState: { in: [...OPEN_PLAN_STATES] } },
        data: { ownerUserId: newUserId },
      })).count;
      moved.objectives += (await tx.departmentObjective.updateMany({
        where: { leadUserId: o.id, departmentId, status: { notIn: [...CLOSED_OBJECTIVES] } },
        data: { leadUserId: newUserId },
      })).count;
      await revokeAccess(tx, { accountKind: "user", accountId: o.id, reason: "تغيير قائد القسم", byName: actor.name });
    }
    await revokeAccess(tx, { accountKind: "member", accountId: m.id, reason: "ترقيةٌ إلى قائد القسم", byName: actor.name });

    await recordOrgEvent(tx, {
      scope: "department", entityId: departmentId, departmentId, action: "department.leader_changed", actor,
      before: { leaders: olds.map((o) => ({ userId: o.id, name: o.fullName, since: o.createdAt.toISOString() })) },
      after: {
        leader: { userId: newUserId, memberId: m.id, name: m.fullName, since: now.toISOString() },
        previousBecameMembers: oldMembers,
        deputyCleared: dept.deputyMemberId === m.id,
        movedInDepartment: { planTasks: moved.planTasks, objectives: moved.objectives },
      },
      note: why,
    });
    return { olds, newUserId, oldMembers };
  });

  // ── ما بعد المعاملة: ما خارج القسم من عملٍ معلّق، والتوقيع، والشيت — لا يُبطل القرارَ إن تعثّر
  const { transferResponsibilities } = await import("@/lib/succession");
  for (const o of result.olds) {
    try {
      const c = await transferResponsibilities({ fromUserId: o.id, toUserId: result.newUserId, byName: actor.name });
      moved.ticketsTarget += c.tickets;
      moved.approvals += c.approvals + c.approvalChains;
      moved.invites += c.invites;
      moved.terminations += c.terminations;
    } catch {
      /* يُعاد من صفحة الحساب */
    }
    try {
      const { supersedeSignatures } = await import("@/lib/signatures");
      await supersedeSignatures(o.id, "تغيير قائد القسم");
    } catch {
      /* تعذّر إبطالُ التوقيع */
    }
  }
  try {
    const { requestSignature } = await import("@/lib/signatures");
    await requestSignature({ userId: result.newUserId, reason: `تكليف جديد: قائد قسم ${dept.name}` });
  } catch {
    /* يُطلب التوقيعُ من صفحته */
  }
  try {
    const { syncAdminAccountRow, syncMemberLifecycleRow } = await import("@/lib/workflow");
    for (const o of result.olds) await syncAdminAccountRow(o.id);
    await syncAdminAccountRow(result.newUserId);
    await syncMemberLifecycleRow(m.id);
    for (const om of result.oldMembers) if (om.memberId) await syncMemberLifecycleRow(om.memberId);
    await appendMemberEvent({
      fullName: m.fullName, email: m.email, event: "تغيير قائد القسم بقرار إداري", roleOrDepartment: dept.name,
      details: `السابق: ${result.olds.map((o) => o.fullName).join("، ") || "—"} — السبب: ${why} — قرّره: ${actor.name}`,
      at: now,
    });
  } catch {
    /* المزامنةُ التالية تُكمل */
  }
  return { ok: true, previous: result.olds.map((o) => o.fullName), next: m.fullName, moved };
}

