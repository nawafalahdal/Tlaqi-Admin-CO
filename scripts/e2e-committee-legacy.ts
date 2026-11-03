import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { resolveSessionAccount } from "@/lib/sessionAccount";
import { orgActor, committeeRoleFor, canManageCommitteesOf, canViewDepartmentMembers, canProposeCommitteesOf } from "@/lib/org/actor";
import { canInviteMemberTo } from "@/lib/permissions";
import { createCandidateAccount, approveMember } from "@/lib/workflow";
import { assignMemberDepartment } from "@/lib/departments";
import { successorFor } from "@/lib/succession";
import { legacyInventory, applyAllLegacy, applyLegacyCase } from "@/lib/org/legacyConversion";
import {
  createCommittee,
  submitCommittee,
  appointCommitteeLead,
  noteCommitteeLeadDeparture,
  appointDeputy,
  setDeputyPermission,
  revokeDeputy,
} from "@/lib/org/committeeService";
import { decideCommittee } from "@/lib/committees";
import { committeeDetail } from "@/lib/org/queries";
import { committeeAlerts } from "@/lib/org/alerts";

/** **فصلُ قيادة اللجنة عن قيادة القسم — على بياناتٍ اصطناعية بشكل النظام الأول.**
 *
 *  يُثبت ملاحظاتِ المؤسس السبع على قاعدةٍ حقيقية (محلية):
 *  - **التجميد (١، ٢):** الحسابُ القياديُّ القديم على لجنة لا جلسةَ له ولا صلاحية، وقائدُ القسم
 *    الفعليُّ لا يُمسّ، وحرّاسُ الكتابة يمنعون أن تصير اللجنةُ قسماً لأحد.
 *  - **الجرد والتحويل (٦، ٧):** كلُّ حالةٍ برمزها، والجردُ لا يكتب، والتطبيقُ للمؤسس وحده،
 *    ويحفظ كلَّ شيء، ولا يكرّر نفسَه، ولا يبقى بعده أثرٌ لصلاحيةٍ قديمة.
 *  - **التسليم (٣)، والنائب (٤)، ومسارُ الاعتماد (٥).**
 *
 *  البياناتُ موسومةٌ بـ`lg-` وتُمحى في البداية والنهاية. */

const log: string[] = [];
const chk = (name: string, pass: boolean, extra = "") => log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
const STAMP = Date.now();
const DOMAIN = `@lg-${STAMP}.example.test`;
const sess = (role: string, id: string, name = "اختبار"): Session => ({ user: { id, role, name } }) as unknown as Session;

async function purge() {
  const depts = await prisma.department.findMany({ where: { slug: { startsWith: "lg-" } }, select: { id: true } });
  const ids = depts.map((d) => d.id);
  const users = await prisma.user.findMany({ where: { email: { contains: "@lg-" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.orgAuditEvent.deleteMany({ where: { OR: [{ entityId: { in: ids } }, { departmentId: { in: ids } }] } });
  await prisma.approvalDecision.deleteMany({ where: { ticket: { subject: { startsWith: "lg-" } } } });
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: "lg-" } } });
  await prisma.committeeTask.deleteMany({ where: { committeeId: { in: ids } } });
  await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: ids } } });
  await prisma.marketingMember.deleteMany({ where: { OR: [{ userId: { in: uids } }, { member: { email: { contains: "@lg-" } } }] } });
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: uids } } });
  // تُغلق اللجانُ أولاً ثم تُرفع القيادة — قيدُ القاعدة لا يقبل لجنةً عاملةً بلا قائد
  await prisma.department.updateMany({ where: { id: { in: ids }, parentId: { not: null } }, data: { committeeStatus: "closed" } });
  await prisma.department.updateMany({ where: { id: { in: ids } }, data: { leadMemberId: null, actingLeadUserId: null, deputyMemberId: null } });
  await prisma.member.deleteMany({ where: { email: { contains: "@lg-" } } });
  await prisma.invite.deleteMany({ where: { OR: [{ email: { contains: "@lg-" } }, { invitedById: { in: uids } }] } });
  await prisma.emailLog.deleteMany({ where: { recipient: { contains: "@lg-" } } });
  await prisma.testTrack.deleteMany({ where: { departmentId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  // اللجانُ أولاً (المتداخلةُ قبل أبيها)، ثم الأقسام
  for (let i = 0; i < 4; i++) await prisma.department.deleteMany({ where: { id: { in: ids }, committees: { none: {} }, parentId: { not: null } } });
  await prisma.department.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await purge();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } });
  const F = { kind: "user" as const, id: founder.id, name: founder.fullName };
  const fActor = await orgActor(sess("super_admin", founder.id, founder.fullName));

  // ═══ البيانات: قسمٌ أصيل بقائده الفعلي، ولجانٌ وحساباتٌ بشكل النظام الأول ═══
  const P = await prisma.department.create({ data: { name: `قسم أصيل lg ${STAMP}`, slug: `lg-p-${STAMP}`, colorHex: "#2F7D32" } });
  const track = await prisma.testTrack.create({ data: { scope: "department_member", departmentId: P.id } });
  const founderId = (await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } })).id;
  const mkC = (tag: string, parentId: string, status: "approved" | "pending_review" = "approved", extra: object = {}) =>
    prisma.department.create({
      // لجنةٌ عاملةٌ من النظام الأول بلا قائدٍ عضو — يملؤها ترحيلُ المرحلة الثالثة بقائدٍ بالخلافة (قيدُ القاعدة)
      data: {
        name: `لجنة ${tag} lg ${STAMP}`, slug: `lg-${tag}-${STAMP}`, colorHex: "#2F7D32", parentId, committeeStatus: status,
        ...(status === "approved" ? { actingLeadUserId: founderId } : {}), ...extra,
      },
    });
  const C1 = await mkC("c1", P.id, "approved", { purpose: "غرض قديم", committeeKind: "permanent" });
  const C2 = await mkC("c2", P.id);
  const C3 = await mkC("c3", C1.id); // L6: لجنةٌ داخل لجنة
  const C4 = await mkC("c4", P.id, "pending_review"); // L7: بانتظار الاعتماد ناقصة

  const hash = "$2a$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234"; // كلمةُ مرورٍ مصطنعة (لا تُستعمل للدخول هنا)
  const RL = await prisma.user.create({
    data: { fullName: `قائد فعلي ${STAMP}`, email: `rl${DOMAIN}`, passwordHash: hash, role: "department_admin", departmentId: P.id },
  });
  const LU1 = await prisma.user.create({
    data: { fullName: `قائد لجنة قديم ${STAMP}`, email: `lu1${DOMAIN}`, passwordHash: `${hash}1`, role: "department_admin", departmentId: C1.id, mustChangePassword: false },
  });
  const LU2 = await prisma.user.create({
    data: { fullName: `قائد لجنة بلا سجل ${STAMP}`, email: `lu2${DOMAIN}`, passwordHash: `${hash}2`, role: "department_admin", departmentId: C2.id },
  });
  const mkM = async (tag: string, deptId: string, o: { role?: "member" | "department_admin"; approved?: boolean; pw?: string | null } = {}) => {
    const email = `${tag}${DOMAIN}`;
    const invite = await prisma.invite.create({
      data: { fullName: tag, email, targetRole: o.role ?? "member", departmentId: deptId, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    return prisma.member.create({
      data: {
        fullName: `${tag} ${STAMP}`, email, departmentId: deptId, inviteId: invite.id, passwordHash: o.pw === undefined ? hash : o.pw,
        approvalStatus: o.approved === false ? "pending_review" : "approved",
      },
    });
  };
  // سجلُّ ترقية LU1: معتمَد، بلا كلمة مرور، قسمُه اللجنة، ودعوتُه قيادية
  const MLU1 = await mkM("lu1", C1.id, { role: "department_admin", pw: null });
  const M1 = await mkM("m1", C1.id);
  const M2 = await mkM("m2", C1.id);
  const M5 = await mkM("m5", P.id);
  const M3 = await mkM("m3", C1.id, { approved: false }); // L4
  const M4 = await mkM("m4", C2.id, { role: "department_admin", approved: false }); // L4x
  await prisma.committeeMembership.create({ data: { committeeId: C1.id, memberId: M1.id, addedByName: "ترحيل نظام اللجان" } });
  const I1 = await prisma.invite.create({
    data: { fullName: "i1", email: `i1${DOMAIN}`, targetRole: "member", departmentId: C1.id, testTrackId: track.id, invitedById: LU1.id, status: "open" },
  });
  const I2 = await prisma.invite.create({
    data: { fullName: "i2", email: `i2${DOMAIN}`, targetRole: "department_admin", departmentId: C2.id, testTrackId: track.id, invitedById: founder.id, status: "open" },
  });
  const tBase = { description: "lg", stage: "department" as const, stageDueAt: new Date(Date.now() + 86400_000), firstDueAt: new Date(Date.now() + 86400_000) };
  const T1 = await prisma.ticket.create({ data: { ...tBase, subject: `lg-t1-${STAMP}`, raisedByUserId: founder.id, targetDepartmentId: C1.id } as never });
  const T2 = await prisma.ticket.create({ data: { ...tBase, subject: `lg-t2-${STAMP}`, raisedByUserId: founder.id, targetUserId: LU1.id } as never });

  // ═══ ١) التجميد — قبل أي ترحيل ═══
  const s1 = await resolveSessionAccount(LU1.id, "department_admin");
  chk("١ · جلسةُ الحساب القيادي القديم على لجنة تُبطَل (gone)", s1.status === "gone", s1.status);
  const sRL = await resolveSessionAccount(RL.id, "department_admin");
  chk("١ · وقائدُ القسم الفعليُّ جلستُه حيّة بقسمه", sRL.status === "live" && sRL.departmentId === P.id);
  const aLU1 = await orgActor(sess("department_admin", LU1.id));
  chk("١ · طبقةُ الهيكل لا تمنحه دوراً", aLU1?.role === null && aLU1.leadsDepartmentId === null);
  const aRL = await orgActor(sess("department_admin", RL.id));
  chk("١ · وقائدُ القسم يقود قسمَه الأصيل كاملاً", aRL?.leadsDepartmentId === P.id && canManageCommitteesOf(aRL, P.id));
  const roleOnC1 = committeeRoleFor(aLU1, { id: C1.id, parentId: P.id, leadMemberId: null }, false);
  chk("١ · ولا يقود لجنتَه القديمة بحسابه الإداري", !roleOnC1.lead && !roleOnC1.manage && !roleOnC1.view);
  const succ = await successorFor({ id: LU1.id, role: "department_admin", departmentId: C1.id });
  chk("١ · يرث عملَه المعلّق قائدُ القسم الأصيل، لا حسابٌ مجمَّد", succ?.id === RL.id, succ?.fullName ?? "—");

  // ═══ ٢) حرّاسُ الكتابة: اللجنةُ ليست قسماً لأحد ═══
  let threw = "";
  try {
    await createCandidateAccount({ fullName: "x", email: `x${DOMAIN}`, jobTitle: "x", targetRole: "member", departmentId: C1.id, testTrackId: track.id, invitedById: RL.id });
  } catch (e) {
    threw = (e as Error).message;
  }
  chk("٢ · لا دعوةَ ولا مرشّحَ قسمُه لجنة", threw.includes("اللجنةُ ليست قسماً"), threw.slice(0, 60));
  chk("٢ · ولم يُنشأ شيء", !(await prisma.member.findUnique({ where: { email: `x${DOMAIN}` } })) && !(await prisma.invite.findFirst({ where: { email: `x${DOMAIN}` } })));
  threw = "";
  try {
    await approveMember(M4.id);
  } catch (e) {
    threw = (e as Error).message;
  }
  chk("٢ · لا يُعتمد حسابٌ قياديٌّ على لجنة", threw.includes("لا يُعتمد حسابٌ قياديٌّ على لجنة"), threw.slice(0, 60));
  chk("٢ · ويبقى المرشّحُ كما كان ولا حساب", (await prisma.member.findUniqueOrThrow({ where: { id: M4.id } })).approvalStatus === "pending_review" && !(await prisma.user.findUnique({ where: { email: `m4${DOMAIN}` } })));
  const unassigned = await mkM("un", P.id);
  await prisma.member.update({ where: { id: unassigned.id }, data: { departmentId: null } });
  const asg = await assignMemberDepartment({ memberId: unassigned.id, departmentId: C1.id, actorRole: "super_admin", actorName: founder.fullName });
  chk("٢ · ولا يُصنَّف عضوٌ في لجنة", !asg.ok);
  chk("٢ · وقائدُ القسم لا يدعو إلى لجنةٍ كأنها قسمُه", !canInviteMemberTo({ role: "department_admin", departmentId: P.id }, C1.id));

  // ═══ ٣) الجرد: يقرأ ولا يكتب، ويصنّف كلَّ حالة ═══
  const auditBefore = await prisma.orgAuditEvent.count();
  const inv = await legacyInventory();
  const mine = inv.cases.filter((c) => [C1.id, C2.id, C3.id, C4.id].includes(c.committee?.id ?? ""));
  const has = (key: string) => mine.some((c) => c.key === key);
  chk("٣ · L1: الحسابُ القياديُّ بسجلّ عضوية", has(`L1:${LU1.id}`));
  chk("٣ · L1b: الحسابُ القياديُّ بلا سجلّ", has(`L1b:${LU2.id}`));
  chk("٣ · L6: لجنةٌ داخل لجنة", has(`L6:${C3.id}`));
  chk("٣ · L3: أعضاءُ قسمُهم لجنة", has(`L3:${M1.id}`) && has(`L3:${M2.id}`));
  chk("٣ · L4 وL4x: المرشّحون", has(`L4:${M3.id}`) && has(`L4x:${M4.id}`) && !mine.find((c) => c.key === `L4x:${M4.id}`)!.auto);
  chk("٣ · L5 وL5x: الدعوات المفتوحة", has(`L5:${I1.id}`) && has(`L5x:${I2.id}`));
  chk("٣ · L7: لجنةٌ بانتظار الاعتماد ناقصة", has(`L7:${C4.id}`));
  chk("٣ · L9: تذكرةٌ مفتوحة إلى لجنة", has(`L9:${T1.id}`));
  chk("٣ · لكل حالةٍ: الآن وما سيُفعل والأثر", mine.every((c) => c.now && c.action && c.effect));
  chk("٣ · والجردُ لم يكتب شيئاً", (await prisma.orgAuditEvent.count()) === auditBefore && (await prisma.user.findUniqueOrThrow({ where: { id: LU1.id } })).isActive);

  // ═══ ٤) التطبيق: للمؤسس وحده، ويحفظ كلَّ شيء ═══
  const denied = await applyLegacyCase({ kind: "user", id: RL.id, name: RL.fullName }, `L1:${LU1.id}`);
  chk("٤ · قائدُ القسم لا يطبّق الترحيل", !denied.ok);
  const refusedDecision = await applyLegacyCase(F, `L4x:${M4.id}`);
  chk("٤ · وحالةُ القرار لا تُطبَّق آلياً", !refusedDecision.ok);
  const counts0 = { users: await prisma.user.count({ where: { email: { endsWith: DOMAIN } } }), invites: await prisma.invite.count({ where: { email: { endsWith: DOMAIN } } }) };
  const results = await applyAllLegacy(F);
  const ours = results.filter((r) => r.key.split(":")[1] && [LU1.id, LU2.id, C3.id, M1.id, M2.id, M3.id, I1.id, I2.id, C4.id, T1.id].includes(r.key.split(":")[1]));
  chk("٤ · طُبِّقت حالاتُ البيانات الاصطناعية كلُّها بنجاح", ours.length === 10 && ours.every((r) => r.ok && r.done === "applied"), JSON.stringify(ours.filter((r) => !r.ok)).slice(0, 160));

  const lu1 = await prisma.user.findUniqueOrThrow({ where: { id: LU1.id } });
  chk("٤ · الحسابُ القيادي معطَّلٌ لا محذوف، بسببٍ مكتوب", !lu1.isActive && !!lu1.removedAt && !!lu1.removalReason?.includes("تحويل قيادة لجنة"));
  const mlu1 = await prisma.member.findUniqueOrThrow({ where: { id: MLU1.id }, include: { invite: true } });
  chk("٤ · سجلُّ عضويته في القسم الأصيل", mlu1.departmentId === P.id);
  chk("٤ · بكلمة مرور حسابه نفسها (يدخل بها)", mlu1.passwordHash === LU1.passwordHash);
  chk("٤ · ومربوطٌ بحسابه القديم للتدقيق والتراجع", mlu1.convertedFromUserId === LU1.id && !!mlu1.convertedAt);
  chk("٤ · ودعوتُه صارت عضوية", mlu1.invite.targetRole === "member");
  const c1 = await prisma.department.findUniqueOrThrow({ where: { id: C1.id } });
  chk("٤ · وصار قائدَ لجنته", c1.leadMemberId === MLU1.id);
  chk("٤ · بعضويةٍ نشطة فيها", !!(await prisma.committeeMembership.findFirst({ where: { committeeId: C1.id, memberId: MLU1.id, active: true } })));
  const evt = await prisma.orgAuditEvent.findFirst({ where: { entityId: C1.id, action: "legacy.lead_converted" } });
  chk("٤ · وسجلُّ التدقيق بما قبله وما بعده", !!evt && JSON.stringify(evt.before).includes("department_admin") && JSON.stringify(evt.after).includes(P.id));
  chk("٤ · وعملُه المعلّق انتقل إلى قائد القسم (تذكرة ودعوة)",
    (await prisma.ticket.findUniqueOrThrow({ where: { id: T2.id } })).targetUserId === RL.id &&
    (await prisma.invite.findUniqueOrThrow({ where: { id: I1.id } })).invitedById === RL.id);
  const mlu2 = await prisma.member.findUnique({ where: { email: `lu2${DOMAIN}` }, include: { invite: true } });
  chk("٤ · L1b: أُنشئ سجلُّ عضويةٍ في القسم الأصيل بكلمة مروره", !!mlu2 && mlu2.departmentId === P.id && mlu2.passwordHash === LU2.passwordHash && mlu2.invite.targetRole === "member" && mlu2.invite.status === "used");
  chk("٤ · وقاد لجنتَه", (await prisma.department.findUniqueOrThrow({ where: { id: C2.id } })).leadMemberId === mlu2?.id);
  chk("٤ · L6: اللجنةُ المتداخلة صارت تحت القسم الأصيل", (await prisma.department.findUniqueOrThrow({ where: { id: C3.id } })).parentId === P.id);
  const m1 = await prisma.member.findUniqueOrThrow({ where: { id: M1.id } });
  const m2 = await prisma.member.findUniqueOrThrow({ where: { id: M2.id } });
  chk("٤ · L3: الأعضاءُ في القسم الأصيل", m1.departmentId === P.id && m2.departmentId === P.id);
  chk("٤ · L3: وعضويتُهم في اللجنة باقية (لا تكرار)", (await prisma.committeeMembership.count({ where: { committeeId: C1.id, memberId: { in: [M1.id, M2.id] }, active: true } })) === 2);
  chk("٤ · L4: المرشّحُ في القسم الأصيل", (await prisma.member.findUniqueOrThrow({ where: { id: M3.id } })).departmentId === P.id);
  chk("٤ · L4x: مرشّحُ القيادة لم يُمسّ (قرار)", (await prisma.member.findUniqueOrThrow({ where: { id: M4.id } })).departmentId === C2.id);
  chk("٤ · L5: دعوةُ العضو وُجّهت إلى القسم الأصيل", (await prisma.invite.findUniqueOrThrow({ where: { id: I1.id } })).departmentId === P.id);
  chk("٤ · L5x: دعوةُ القيادة أُنهيت ولم تُحذف", (await prisma.invite.findUniqueOrThrow({ where: { id: I2.id } })).status === "expired");
  chk("٤ · L7: الناقصةُ أُعيدت مسودّة", (await prisma.department.findUniqueOrThrow({ where: { id: C4.id } })).committeeStatus === "draft");
  chk("٤ · L9: التذكرةُ وُجّهت إلى القسم الأصيل", (await prisma.ticket.findUniqueOrThrow({ where: { id: T1.id } })).targetDepartmentId === P.id);
  chk("٤ · لا حذف: الحساباتُ والدعواتُ كلُّها باقية (ودعوةٌ تقنيةٌ واحدة أُضيفت)",
    (await prisma.user.count({ where: { email: { endsWith: DOMAIN } } })) === counts0.users &&
    (await prisma.invite.count({ where: { email: { endsWith: DOMAIN } } })) === counts0.invites + 1);

  // ═══ ٥) لا أثرَ لصلاحيةٍ قديمة بعد التحويل ═══
  const sM = await resolveSessionAccount(MLU1.id, "member");
  chk("٥ · يدخل عضواً حيّاً في قسمه الأصيل (لا مرشّحاً)", sM.status === "live" && sM.role === "member" && sM.departmentId === P.id && !sM.leadershipCandidate);
  const aM = await orgActor(sess("member", MLU1.id));
  const rM = committeeRoleFor(aM, { id: C1.id, parentId: P.id, leadMemberId: MLU1.id }, true);
  chk("٥ · قائدُ لجنته", rM.lead && rM.member);
  chk("٥ · ولا يملك هيكلَها ولا اقتراحَ لجان", !rM.manage && !rM.propose && !canProposeCommitteesOf(aM, P.id));
  chk("٥ · ولا أيَّ صلاحيةٍ على القسم", !canManageCommitteesOf(aM, P.id) && !canViewDepartmentMembers(aM, P.id) && aM?.leadsDepartmentId === null && aM?.deputy === null);
  chk("٥ · ولا يدعو أحداً", !canInviteMemberTo({ role: "member", departmentId: P.id }, P.id));
  chk("٥ · ولا تُعيد الجلسةُ القديمة شيئاً", (await resolveSessionAccount(LU1.id, "department_admin")).status === "gone");
  const again = await applyAllLegacy(F);
  chk("٥ · إعادةُ التطبيق لا تكرّر شيئاً", again.filter((r) => [LU1.id, LU2.id, M1.id].includes(r.key.split(":")[1] ?? "")).length === 0);
  const inv2 = await legacyInventory();
  const left = inv2.cases.filter((c) => [C1.id, C2.id, C3.id, C4.id].includes(c.committee?.id ?? "") && c.auto);
  chk("٥ · ولا حالةَ آليةً متبقية", left.length === 0, left.map((c) => c.key).join(","));
  const frozenLeft = await prisma.user.count({ where: { isActive: true, role: "department_admin", department: { is: { parentId: { not: null } } }, email: { endsWith: DOMAIN } } });
  chk("٥ · ولا حسابَ قياديّاً نشطاً على لجنة", frozenLeft === 0);

  // ═══ ٦) تسليمُ القيادة عند مغادرة القائد (ملاحظة ٣) ═══
  const task = await prisma.committeeTask.create({
    data: { committeeId: C1.id, title: "مهمة القائد", assigneeMemberId: MLU1.id, createdByName: "اختبار", status: "in_progress" } as never,
  });
  await prisma.member.update({ where: { id: MLU1.id }, data: { isActive: false, terminatedAt: new Date(), exitReason: "lg" } });
  const noted = await noteCommitteeLeadDeparture(MLU1.id, "مغادرة (اختبار)");
  // منذ المرحلة الثالثة: مغادرةُ قائد لجنةٍ عاملة تُكتب خلافةً آلية (`committee.succession`) لا حدثَ مغادرةٍ وحده
  chk("٦ · مغادرةُ القائد تُكتب في سجلّ لجنته (خلافة آلية)", noted >= 1 && !!(await prisma.orgAuditEvent.findFirst({ where: { entityId: C1.id, action: "committee.succession" } })));
  const aRL2 = await orgActor(sess("department_admin", RL.id));
  const alerts = await committeeAlerts(aRL2, "ar");
  chk("٦ · ويظهر لقائد القسم تنبيهُ «بلا قائدٍ نشط»", alerts.some((a) => a.id === "committee-leaderless"));
  const det = await committeeDetail(aRL2, C1.id);
  chk("٦ · وصفحةُ اللجنة تقول إن القائد غادر، وتتيح التسليم", !!det?.leadDeparted && !!det?.canAppointLead);
  const topTry = await appointCommitteeLead(fActor, C1.id, M1.id);
  chk("٦ · والمؤسسُ لا يتجاوز قائدَ القسم في التعيين", !topTry.ok);
  const meetingsBefore = await prisma.committeeMeeting.count({ where: { committeeId: C1.id } });
  const ho = await appointCommitteeLead(aRL2, C1.id, M1.id, "تسليم بعد المغادرة", { reassignOpenTasks: true });
  chk("٦ · قائدُ القسم يسلّم القيادة لبديل", ho.ok && ho.handover && ho.tasksMoved === 1, JSON.stringify(ho));
  chk("٦ · ومهمّةُ القائد السابق انتقلت للبديل", (await prisma.committeeTask.findUniqueOrThrow({ where: { id: task.id } })).assigneeMemberId === M1.id);
  const oldMs = await prisma.committeeMembership.findFirst({ where: { committeeId: C1.id, memberId: MLU1.id } });
  chk("٦ · وعضويةُ المغادر أُغلقت ولم تُحذف", !!oldMs && !oldMs.active && !!oldMs.removedAt);
  const hoEvt = await prisma.orgAuditEvent.findFirst({ where: { entityId: C1.id, action: "committee.handover" }, orderBy: { createdAt: "desc" } });
  chk("٦ · وسجلُّ التسليم يسمّي المهامّ المنقولة", !!hoEvt && JSON.stringify(hoEvt.after).includes(task.id));
  chk("٦ · ولا يُمسّ غيرُ ذلك (الاجتماعات)", (await prisma.committeeMeeting.count({ where: { committeeId: C1.id } })) === meetingsBefore);
  // حين يخلو مقعدُ قائد القسم وحده يتدخّل المؤسس
  // منذ المرحلة الثالثة لا يُستبدل قائدٌ نشط — فيغادر القائدُ الجديد أولاً (خلافةٌ آلية)، ثم يخلو مقعدُ قائد القسم
  await prisma.member.update({ where: { id: M1.id }, data: { isActive: false } });
  await noteCommitteeLeadDeparture(M1.id, "مغادرة (اختبار)");
  await prisma.user.update({ where: { id: RL.id }, data: { isActive: false } });
  const topVacant = await appointCommitteeLead(fActor, C1.id, M2.id);
  chk("٦ · ويعيّن المؤسسُ حين يخلو مقعدُ قائد القسم", topVacant.ok, topVacant.ok ? "" : topVacant.reason);
  await prisma.user.update({ where: { id: RL.id }, data: { isActive: true } });

  // ═══ ٧) صلاحياتُ النائب مستقلّة ومسجَّلة (ملاحظة ٤) ═══
  const aRL3 = await orgActor(sess("department_admin", RL.id));
  const dep = await appointDeputy(aRL3, P.id, M5.id, ["members_view"]);
  chk("٧ · تعيينُ النائب بصلاحيةٍ واحدة", dep.ok);
  const grantEvt = () => prisma.orgAuditEvent.findMany({ where: { entityId: P.id, action: { in: ["department.deputy_permission_granted", "department.deputy_permission_revoked"] } }, orderBy: { createdAt: "asc" } });
  chk("٧ · يُسجَّل منحُ تلك الصلاحية وحدها", (await grantEvt()).filter((e) => e.action.endsWith("granted")).length === 1);
  const g = await setDeputyPermission(aRL3, P.id, "tasks_view", true);
  const r = await setDeputyPermission(aRL3, P.id, "members_view", false);
  const perms = (await prisma.department.findUniqueOrThrow({ where: { id: P.id } })).deputyPermissions;
  chk("٧ · تُمنح صلاحيةٌ وتُسحب أخرى مستقلّتين", g.ok && r.ok && perms.length === 1 && perms[0] === "tasks_view", perms.join(","));
  const evs = await grantEvt();
  chk("٧ · لكلّ تغييرٍ حدثُه بالصلاحية وما قبلها وما بعدها", evs.length === 3 && JSON.stringify(evs[2].after).includes('"permission":"members_view"') && evs[2].action.endsWith("revoked"));
  const same = await setDeputyPermission(aRL3, P.id, "tasks_view", true);
  chk("٧ · ومنحُ الممنوح لا يكتب حدثاً", same.ok && !same.changed && (await grantEvt()).length === 3);
  chk("٧ · صلاحيةٌ مجهولة تُرفض", !(await setDeputyPermission(aRL3, P.id, "approve_everything", true)).ok);
  chk("٧ · والمؤسسُ لا يفوّض نائبَ قسمٍ ليس قائدَه", !(await setDeputyPermission(fActor, P.id, "members_view", true)).ok);
  const aDep = await orgActor(sess("member", M5.id));
  chk("٧ · والنائبُ لا يفوّض نفسه", !(await setDeputyPermission(aDep, P.id, "committees_manage", true)).ok);
  const rv = await revokeDeputy(aRL3, P.id, "اختبار");
  chk("٧ · سحبُ النائب يسجّل سحبَ ما بقي له", rv.ok && (await grantEvt()).filter((e) => e.action.endsWith("revoked")).length === 2);

  // ═══ ٨) مسارُ الاعتماد (ملاحظة ٥) ═══
  // M1 غادر في القسم ٦ (المرحلة الثالثة: لا يُستبدل قائدٌ نشط) — فالقائدُ المقترح هنا M5
  const base = { name: `لجنة جديدة lg ${STAMP}`, purpose: "غرض", kind: "permanent" as const, leadMemberId: M5.id, memberIds: [M2.id] };
  const byTop = await createCommittee(fActor, P.id, { ...base, submit: true });
  chk("٨ · المؤسسُ لا يُنشئ لجنة (يعتمد ولا يقترح)", !byTop.ok);
  const created = await createCommittee(aRL3, P.id, { ...base, submit: false });
  chk("٨ · قائدُ القسم ينشئها مسودّة — لا نشطةً بمجرد الإنشاء", created.ok && created.status === "draft");
  const nid = created.ok ? created.id : "";
  await prisma.department.update({ where: { id: nid }, data: { slug: `lg-new-${STAMP}` } });
  chk("٨ · المؤسسُ لا يرسلها للاعتماد", !(await submitCommittee(fActor, nid)).ok);
  chk("٨ · قرارٌ قبل الإرسال لا يقع", !(await decideCommittee({ committeeId: nid, decision: "approved", session: sess("super_admin", founder.id, founder.fullName) })).ok);
  chk("٨ · قائدُ القسم يرسلها", (await submitCommittee(aRL3, nid)).ok);
  chk("٨ · وقائدُ القسم لا يعتمدها", !(await decideCommittee({ committeeId: nid, decision: "approved", session: sess("department_admin", RL.id, RL.fullName) })).ok);
  await prisma.member.update({ where: { id: M2.id }, data: { isActive: false } });
  const incomplete = await decideCommittee({ committeeId: nid, decision: "approved", session: sess("super_admin", founder.id, founder.fullName) });
  chk("٨ · ولا تُعتمد ناقصةً (عضوُها الوحيد معطَّل)", !incomplete.ok && incomplete.reason.includes("ناقصة"), incomplete.ok ? "" : incomplete.reason.slice(0, 80));
  chk("٨ · وتبقى بانتظار الاعتماد", (await prisma.department.findUniqueOrThrow({ where: { id: nid } })).committeeStatus === "pending_review");
  await prisma.member.update({ where: { id: M2.id }, data: { isActive: true } });
  const ok = await decideCommittee({ committeeId: nid, decision: "approved", session: sess("super_admin", founder.id, founder.fullName) });
  chk("٨ · ومكتملةً يعتمدها المؤسس أو الرئيس التنفيذي", ok.ok && (await prisma.department.findUniqueOrThrow({ where: { id: nid } })).committeeStatus === "approved");

  await purge();
  done();
})().catch(async (e) => {
  log.push(`✗ FAIL crashed: ${(e as Error).stack ?? e}`);
  await purge().catch(() => {});
  done();
});

function done() {
  for (const l of log) console.log(l);
  const failed = log.filter((l) => l.startsWith("✗")).length;
  console.log(failed ? `\nFAILURES PRESENT (${failed})` : `\nALL PASS (${log.length})`);
  void prisma.$disconnect().then(() => process.exit(failed ? 1 : 0));
}
