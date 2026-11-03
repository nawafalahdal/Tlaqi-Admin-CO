import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { resolveSessionAccount } from "@/lib/sessionAccount";
import { revocationEpoch } from "@/lib/accessRevocation";
import { orgActor, committeeRoleFor } from "@/lib/org/actor";
import { changeDepartmentLeader, departmentLeaderChangePreview } from "@/lib/org/departmentLeadership";
import { terminateMembership, suspendMember, reinstateMember, membershipExitPreview, memberState } from "@/lib/org/membership";
import { committeeLeadState, committeeSuccessor, ensureCommitteeSuccession } from "@/lib/org/committeeLeadership";
import {
  addCommitteeMembers,
  removeCommitteeMember,
  changeCommitteeStatus,
  appointCommitteeLead,
  updateCommitteeDetails,
  setCommitteeResponsibility,
} from "@/lib/org/committeeService";
import { markMemberExited } from "@/lib/workflow";

/** **المرحلة الثالثة من حوكمة الأقسام واللجان — المتطلبات الأربعة، على قاعدةٍ معزولةٍ ببياناتٍ اصطناعية.**
 *
 *  ١ تغييرُ قائد القسم (المؤسس والرئيس وحدهما) · ٢ صلاحياتُ المؤسس والرئيس في اللجان بحسب حالة قائدها ·
 *  ٣ إنهاءُ العضوية وإزالةُ الوصول (والإيقافُ المؤقت) · ٤ لا تغييرَ لقائدٍ نشط، وخلافةٌ آليةٌ ذرّية بقائدٍ واحد.
 *  البياناتُ موسومةٌ بـ`g3-` وتُمحى في البداية والنهاية. */

const log: string[] = [];
const chk = (name: string, pass: boolean, extra = "") => log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
const STAMP = Date.now();
const DOMAIN = `@g3-${STAMP}.example.test`;
const sess = (role: string, id: string, name = "اختبار"): Session => ({ user: { id, role, name } }) as unknown as Session;
const HASH = "$2a$10$g3g3g3g3g3g3g3g3g3g3g.abcdefghijklmnopqrstuvwxyz0123456";

async function purge() {
  const depts = await prisma.department.findMany({ where: { slug: { startsWith: "g3-" } }, select: { id: true } });
  const ids = depts.map((d) => d.id);
  const users = await prisma.user.findMany({ where: { email: { contains: "@g3-" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const members = await prisma.member.findMany({ where: { email: { contains: "@g3-" } }, select: { id: true } });
  const mids = members.map((m) => m.id);
  await prisma.orgAuditEvent.deleteMany({ where: { OR: [{ entityId: { in: [...ids, ...mids] } }, { departmentId: { in: ids } }] } });
  await prisma.accessRevocation.deleteMany({ where: { accountId: { in: [...uids, ...mids] } } });
  await prisma.approvalDecision.deleteMany({ where: { ticket: { subject: { startsWith: "g3-" } } } });
  await prisma.ticket.deleteMany({ where: { subject: { startsWith: "g3-" } } });
  await prisma.committeeTask.deleteMany({ where: { committeeId: { in: ids } } });
  await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: ids } } });
  await prisma.planTask.deleteMany({ where: { title: { startsWith: "g3-" } } });
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: uids } } });
  // اللجانُ أولاً: يُغلق ما فيها ليرتفع القيد، ثم تُمحى
  await prisma.department.updateMany({ where: { id: { in: ids }, parentId: { not: null } }, data: { committeeStatus: "closed" } });
  await prisma.department.updateMany({ where: { id: { in: ids } }, data: { leadMemberId: null, actingLeadUserId: null, deputyMemberId: null } });
  await prisma.loginCode.deleteMany({ where: { email: { contains: "@g3-" } } });
  await prisma.passwordResetToken.deleteMany({ where: { email: { contains: "@g3-" } } });
  await prisma.member.deleteMany({ where: { id: { in: mids } } });
  await prisma.invite.deleteMany({ where: { OR: [{ email: { contains: "@g3-" } }, { invitedById: { in: uids } }] } });
  await prisma.emailLog.deleteMany({ where: { recipient: { contains: "@g3-" } } });
  await prisma.testTrack.deleteMany({ where: { departmentId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.department.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
  await prisma.department.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await purge();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true }, orderBy: { createdAt: "asc" } });
  // رئيسٌ تنفيذيٌّ اختباري إن لم يوجد — آليةُ الخلافة تبدأ به
  const existingCeo = await prisma.user.findFirst({ where: { role: "executive", isActive: true } });
  const ceo = existingCeo ?? (await prisma.user.create({ data: { fullName: `g3 ceo ${STAMP}`, email: `ceo${DOMAIN}`, passwordHash: HASH, role: "executive" } }));
  const F = await orgActor(sess("super_admin", founder.id, founder.fullName));
  const CEO = await orgActor(sess("executive", ceo.id, ceo.fullName));
  const heir = await committeeSuccessor(prisma);

  const P = await prisma.department.create({ data: { name: `g3 قسم ${STAMP}`, slug: `g3-p-${STAMP}`, colorHex: "#2F7D32" } });
  const Q = await prisma.department.create({ data: { name: `g3 قسم آخر ${STAMP}`, slug: `g3-q-${STAMP}`, colorHex: "#C34900" } });
  const track = await prisma.testTrack.create({ data: { scope: "department_member", departmentId: P.id } });
  const mk = async (tag: string, deptId = P.id, role: "member" | "department_admin" = "member", pw: string | null = HASH) => {
    const email = `${tag}${DOMAIN}`;
    const inv = await prisma.invite.create({ data: { fullName: tag, email, targetRole: role, departmentId: deptId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
    return prisma.member.create({ data: { fullName: `${tag} ${STAMP}`, email, departmentId: deptId, inviteId: inv.id, passwordHash: pw, approvalStatus: "approved" } });
  };
  // القائدُ الحالي: حسابٌ قياديٌّ وسجلُّ ترقيته
  const RL = await prisma.user.create({ data: { fullName: `rl ${STAMP}`, email: `rl${DOMAIN}`, passwordHash: `${HASH}r`, role: "department_admin", departmentId: P.id } });
  const RLM = await mk("rl", P.id, "department_admin", null);
  const A = await mk("a"), B = await mk("b"), C = await mk("c"), D = await mk("d"), E = await mk("e"), X = await mk("x", Q.id);
  const RLsig = await prisma.leaderSignature.create({ data: { userId: RL.id, role: "department_admin", departmentId: P.id, status: "approved", approvedAt: new Date() } });
  const planT = await prisma.planTask.create({
    data: { title: `g3-plan-${STAMP}`, acceptanceCriteria: "x", createdByName: "g3", departmentId: P.id, ownerUserId: RL.id, originalDueAt: new Date(Date.now() + 864e5), dueAt: new Date(Date.now() + 864e5) } as never,
  });
  const C1 = await prisma.department.create({
    data: {
      name: `g3 لجنة ${STAMP}`, slug: `g3-c1-${STAMP}`, colorHex: "#2F7D32", parentId: P.id, committeeStatus: "approved",
      purpose: "غرض", committeeKind: "permanent", leadMemberId: A.id,
    },
  });
  for (const m of [A, B, C, E]) await prisma.committeeMembership.create({ data: { committeeId: C1.id, memberId: m.id, addedByName: "g3" } });

  // ═══ المتطلب الأول: تغييرُ قائد القسم ═══
  chk("١ · قائدُ القسم لا يغيّر قائدَ قسمه", !(await changeDepartmentLeader(RL.id, P.id, C.id, "x", true)).ok);
  chk("١ · ولا عضو", !(await changeDepartmentLeader(B.id, P.id, C.id, "x", true)).ok);
  chk("١ · ولا يقع بلا سبب", !(await changeDepartmentLeader(founder.id, P.id, C.id, "  ", true)).ok);
  chk("١ · ولا بلا تأكيد", !(await changeDepartmentLeader(founder.id, P.id, C.id, "x", false)).ok);
  chk("١ · ولا ببديلٍ من قسمٍ آخر", !(await changeDepartmentLeader(founder.id, P.id, X.id, "x", true)).ok);
  const leadBlock = await changeDepartmentLeader(founder.id, P.id, A.id, "x", true);
  chk("١ · ولا يُرقّى من يقود لجنةً عاملة (لا تتغيّر قيادتُها)", !leadBlock.ok && !leadBlock.ok && leadBlock.reason.includes("يقود لجنة"));
  // ١١ · تاريخٌ يبقى باسم صاحبه: مهمّةٌ متحقَّقٌ منها (إنجاز)، وقرارُ اعتمادٍ سابق
  const rlDone = await prisma.planTask.create({
    data: { title: `g3-plan-done-${STAMP}`, acceptanceCriteria: "x", createdByName: "g3", departmentId: P.id, ownerUserId: RL.id, originalDueAt: new Date(), dueAt: new Date(), execState: "verified" } as never,
  });
  const apT = await prisma.ticket.create({
    data: { subject: `g3-ap-${STAMP}`, description: "x", stage: "department", stageDueAt: new Date(), firstDueAt: new Date(), raisedByUserId: founder.id } as never,
  });
  const apD = await prisma.approvalDecision.create({ data: { ticketId: apT.id, deciderId: RL.id, deciderName: RL.fullName, decision: "approved" } });
  const prev = await departmentLeaderChangePreview(founder.id, P.id);
  chk("١ · المعاينةُ تعرض القائدَ الحالي والعملَ المفتوح", prev?.current[0]?.id === RL.id && prev.openWork.planTasks === 1);
  chk("١ · ولغير المؤسس والرئيس لا معاينة", (await departmentLeaderChangePreview(RL.id, P.id)) === null);
  const ch = await changeDepartmentLeader(founder.id, P.id, C.id, "إعادة هيكلة القسم", true);
  chk("١ · المؤسسُ يغيّر القائد مباشرة", ch.ok, ch.ok ? "" : ch.reason);
  const rl = await prisma.user.findUniqueOrThrow({ where: { id: RL.id } });
  chk("١ · سُحبت القيادةُ من السابق (معطَّلٌ لا محذوف، بسبب)", !rl.isActive && !!rl.removalReason?.includes("إعادة هيكلة القسم"));
  const rlm = await prisma.member.findUniqueOrThrow({ where: { id: RLM.id }, include: { invite: true } });
  chk("١ · ويبقى السابقُ عضواً في قسمه بكلمته", rlm.departmentId === P.id && rlm.passwordHash === RL.passwordHash && rlm.invite.targetRole === "member");
  const cUser = await prisma.user.findUnique({ where: { email: C.email } });
  chk("١ · ومُنح البديلُ القيادة", !!cUser?.isActive && cUser.role === "department_admin" && cUser.departmentId === P.id);
  const cm = await prisma.member.findUniqueOrThrow({ where: { id: C.id }, include: { invite: true } });
  chk("١ · بمدخلٍ واحد (سجلُّ عضويته صار سجلَّ ترقية)", cm.passwordHash === null && cm.invite.targetRole === "department_admin" && cUser?.passwordHash === HASH);
  chk("١ · ومهمّةُ القسم المفتوحة انتقلت إلى الجديد", (await prisma.planTask.findUniqueOrThrow({ where: { id: planT.id } })).ownerUserId === cUser?.id);
  const ev = await prisma.orgAuditEvent.findFirst({ where: { entityId: P.id, action: "department.leader_changed" }, orderBy: { createdAt: "desc" } });
  chk("١ · وسُجّل القرارُ بالسابق والجديد والسبب ومن قرّر", !!ev && JSON.stringify(ev.before).includes(RL.fullName) && JSON.stringify(ev.after).includes(C.fullName) && ev.note === "إعادة هيكلة القسم" && ev.actorName === founder.fullName);
  chk("١ · وسجلُّ القيادة يُقرأ في المعاينة", ((await departmentLeaderChangePreview(founder.id, P.id))?.history.length ?? 0) >= 1);
  const c1 = await prisma.department.findUniqueOrThrow({ where: { id: C1.id } });
  chk("١١ · المُنجَزُ يبقى باسم صاحبه: المهمّةُ المتحقَّقُ منها لا تنتقل", (await prisma.planTask.findUniqueOrThrow({ where: { id: rlDone.id } })).ownerUserId === RL.id);
  const apAfter = await prisma.approvalDecision.findUniqueOrThrow({ where: { id: apD.id } });
  chk("١١ · وقرارُ الاعتماد السابق باسم من قرّره (لا يُنقل اعتماد)", apAfter.deciderId === RL.id && apAfter.deciderName === RL.fullName);
  chk("١ · ولا تتغيّر قيادةُ اللجنة ولا عضوياتُها", c1.leadMemberId === A.id && (await prisma.committeeMembership.count({ where: { committeeId: C1.id, active: true } })) === 4);
  chk("١ · والتوقيعُ لا ينتقل: يُبطَل توقيعُ السابق ويبقى باسمه", (await prisma.leaderSignature.findUniqueOrThrow({ where: { id: RLsig.id } })).userId === RL.id && (await prisma.leaderSignature.findUniqueOrThrow({ where: { id: RLsig.id } })).status === "superseded");
  chk("١ · وجلسةُ السابق القيادية تسقط", (await resolveSessionAccount(RL.id, "department_admin")).status === "gone");
  chk("١ · وجلسةُ البديل العضوية تُستبدل بحسابه القيادي", (await resolveSessionAccount(C.id, "member")).status === "superseded");
  const ch2 = await changeDepartmentLeader(ceo.id, P.id, D.id, "تكليف بديل", true);
  chk("١ · والرئيسُ التنفيذي يغيّر القائد أيضاً", ch2.ok, ch2.ok ? "" : ch2.reason);
  const dUser = await prisma.user.findUniqueOrThrow({ where: { email: D.email } });
  const LEAD = await orgActor(sess("department_admin", dUser.id));

  // ═══ المتطلب الثاني: قائدُ لجنةٍ نشط ⇐ المؤسس والرئيس اطّلاعٌ فقط ═══
  const st = await committeeLeadState(prisma, c1);
  chk("٢ · القائدُ نشطٌ معتمد", st.leadActive && !st.actingLeadUserId);
  for (const [who, a] of [["المؤسس", F], ["الرئيس", CEO]] as const) {
    const r = committeeRoleFor(a, { ...c1, leadActive: true }, false);
    chk(`٢ · ${who}: يطّلع ولا يدير`, r.view && !r.manage && !r.lead);
    chk(`٢ · ${who}: لا يضيف عضواً`, !(await addCommitteeMembers(a, C1.id, [D.id])).ok);
    chk(`٢ · ${who}: لا يُخرج عضواً`, !(await removeCommitteeMember(a, C1.id, B.id, "x")).ok);
    chk(`٢ · ${who}: لا يعلّق ولا يغلق`, !(await changeCommitteeStatus(a, C1.id, "suspended", "x")).ok && !(await changeCommitteeStatus(a, C1.id, "closed", "x")).ok);
    chk(`٢ · ${who}: لا يعدّل بياناتها ولا المسؤوليات`, !(await updateCommitteeDetails(a, C1.id, { name: c1.name, purpose: "تغيير", kind: "permanent" })).ok && !(await setCommitteeResponsibility(a, C1.id, B.id, "x")).ok);
  }
  // ═══ المتطلب الرابع (أ): لا يُغيَّر قائدٌ نشط — للجميع ═══
  chk("٤ · المؤسسُ لا يغيّر قائداً نشطاً", !(await appointCommitteeLead(F, C1.id, B.id)).ok);
  chk("٤ · ولا الرئيس", !(await appointCommitteeLead(CEO, C1.id, B.id)).ok);
  const lb = await appointCommitteeLead(LEAD, C1.id, B.id);
  chk("٤ · ولا قائدُ القسم نفسُه", !lb.ok && lb.reason.includes("قائدٌ نشطٌ معتمد"));
  chk("٤ · والقائدُ باقٍ كما هو", (await prisma.department.findUniqueOrThrow({ where: { id: C1.id } })).leadMemberId === A.id);
  // المتطلبُ يقيّد المؤسس والرئيس وحدهما — قائدُ القسم يدير لجان قسمه كما كان (عدا تغيير قائدٍ نشط)
  const leadAdd = await addCommitteeMembers(LEAD, C1.id, [RLM.id]);
  const leadRemove = await removeCommitteeMember(LEAD, C1.id, RLM.id, "اختبار");
  chk("٢ · وقائدُ القسم يدير أعضاءَ لجان قسمه كما كان", leadAdd.ok && leadRemove.ok, JSON.stringify([leadAdd, leadRemove]).slice(0, 160));

  // ═══ قيودُ القاعدة: قائدٌ واحد، ولا لجنةٌ عاملةٌ بلا قائد ═══
  let both = false, none = false;
  try { await prisma.department.update({ where: { id: C1.id }, data: { actingLeadUserId: founder.id } }); } catch { both = true; }
  try { await prisma.department.update({ where: { id: C1.id }, data: { leadMemberId: null } }); } catch { none = true; }
  chk("٤ · القاعدةُ ترفض قائدين للجنةٍ واحدة", both);
  chk("٤ · والقاعدةُ ترفض لجنةً عاملةً بلا قائد", none);

  // ═══ مغادرةُ القائد ⇐ خلافةٌ آلية، وتُفعَّل إدارةُ المؤسس والرئيس ═══
  const task = await prisma.committeeTask.create({ data: { committeeId: C1.id, title: "g3 مهمة القائد", assigneeMemberId: A.id, createdByName: "g3", status: "in_progress" } as never });
  await markMemberExited(A.id, "استقالة (اختبار)");
  const after = await prisma.department.findUniqueOrThrow({ where: { id: C1.id } });
  chk("٤ · الخلافةُ آلية: انتقلت القيادةُ إلى الخَلَف المعتمد", after.actingLeadUserId === heir?.id && after.leadMemberId === null, `${after.actingLeadUserId} vs ${heir?.id}`);
  chk("٤ · بقائدٍ فعّالٍ واحد (لا قيادتان للمؤسس والرئيس)", !(after.actingLeadUserId && after.leadMemberId));
  const sev = await prisma.orgAuditEvent.findFirst({ where: { entityId: C1.id, action: "committee.succession" } });
  chk("٤ · والسجلُّ: السابق، والسبب، والخَلَف، والوقت، والمصدر", !!sev && JSON.stringify(sev.before).includes(A.fullName) && !!sev.note?.includes("استقالة") && JSON.stringify(sev.after).includes('"source":"automatic"') && JSON.stringify(sev.after).includes(heir!.id) && JSON.stringify(sev.after).includes('"at"'));
  chk("٤ · وعضويةُ المغادر أُغلقت ولم تُحذف", !!(await prisma.committeeMembership.findFirst({ where: { committeeId: C1.id, memberId: A.id, active: false } })));
  const again = await ensureCommitteeSuccession(C1.id, { reason: "تكرار", source: "automatic", byName: "g3" });
  chk("٤ · والتكرارُ لا يكتب شيئاً", !again.changed && (await prisma.orgAuditEvent.count({ where: { entityId: C1.id, action: "committee.succession" } })) === 1);
  // متزامنان على لجنةٍ أخرى
  const C2 = await prisma.department.create({
    data: { name: `g3 لجنة2 ${STAMP}`, slug: `g3-c2-${STAMP}`, colorHex: "#2F7D32", parentId: P.id, committeeStatus: "approved", purpose: "غرض", committeeKind: "permanent", leadMemberId: E.id },
  });
  await prisma.member.update({ where: { id: E.id }, data: { isActive: false } });
  const [r1, r2] = await Promise.all([
    ensureCommitteeSuccession(C2.id, { reason: "متزامن ١", source: "automatic", byName: "g3" }),
    ensureCommitteeSuccession(C2.id, { reason: "متزامن ٢", source: "automatic", byName: "g3" }),
  ]);
  chk("٤ · طلبان متزامنان: ينقل أحدُهما وحده", [r1.changed, r2.changed].filter(Boolean).length === 1 && (await prisma.orgAuditEvent.count({ where: { entityId: C2.id, action: "committee.succession" } })) === 1);
  await prisma.member.update({ where: { id: E.id }, data: { isActive: true } });

  const c1s = await committeeLeadState(prisma, after);
  for (const [who, a] of [["المؤسس", F], ["الرئيس", CEO]] as const) {
    chk(`٢ · بعد المغادرة: ${who} يدير`, committeeRoleFor(a, { ...after, leadActive: c1s.leadActive, actingLeadUserId: c1s.actingLeadUserId }, false).manage);
  }
  chk("٢ · المؤسسُ يضيف عضواً بعد المغادرة", (await addCommitteeMembers(F, C1.id, [RLM.id])).ok);
  chk("٢ · والرئيسُ يُنهي عضوية عضوٍ فيها", (await removeCommitteeMember(CEO, C1.id, RLM.id, "اختبار")).ok);
  const sus = await changeCommitteeStatus(F, C1.id, "suspended", "اختبار تعليق");
  chk("٢ · ويعلّقها", sus.ok, sus.ok ? "" : sus.reason);
  chk("٢ · ولا يعيّن قائداً وقائدُ القسم قائم (التعيينُ لقائد القسم)", !(await appointCommitteeLead(F, C1.id, B.id)).ok);
  const ap = await appointCommitteeLead(LEAD, C1.id, B.id, "بعد المغادرة", { reassignOpenTasks: true });
  chk("٤ · بعد انتهاء القيادة: يعيّن قائدُ القسم قائداً جديداً", ap.ok, ap.ok ? "" : ap.reason);
  const c1b = await prisma.department.findUniqueOrThrow({ where: { id: C1.id } });
  chk("٤ · ويرتفع القائمُ بالخلافة في الكتابة نفسها (قائدٌ واحد)", c1b.leadMemberId === B.id && c1b.actingLeadUserId === null);
  chk("٤ · ومهمّةُ المغادر انتقلت للقائد الجديد", (await prisma.committeeTask.findUniqueOrThrow({ where: { id: task.id } })).assigneeMemberId === B.id);
  chk("٤ · ثم يُمنع تغييرُه وهو نشط", !(await appointCommitteeLead(LEAD, C1.id, D.id)).ok);
  await changeCommitteeStatus(LEAD, C1.id, "approved");
  chk("٢ · وبقائدٍ نشطٍ عاد المؤسسُ مطّلعاً فقط", !(await addCommitteeMembers(F, C1.id, [D.id])).ok);

  // ═══ المتطلب الثالث: إنهاءُ العضوية وإزالةُ الوصول ═══
  await prisma.department.update({ where: { id: P.id }, data: { deputyMemberId: E.id, deputyPermissions: ["members_view", "tasks_view"] } });
  const eTask = await prisma.committeeTask.create({ data: { committeeId: C1.id, title: "g3 مهمة e", assigneeMemberId: E.id, createdByName: "g3", status: "todo" } as never });
  const eDone = await prisma.committeeTask.create({ data: { committeeId: C1.id, title: "g3 مهمة e منجزة", assigneeMemberId: E.id, createdByName: "g3", status: "done" } as never });
  const ePlan = await prisma.planTask.create({
    data: { title: `g3-plan-e-${STAMP}`, acceptanceCriteria: "x", createdByName: "g3", departmentId: P.id, ownerMemberId: E.id, originalDueAt: new Date(Date.now() + 864e5), dueAt: new Date(Date.now() + 864e5) } as never,
  });
  const eTicket = await prisma.ticket.create({
    data: { subject: `g3-t-${STAMP}`, description: "x", stage: "department", stageDueAt: new Date(), firstDueAt: new Date(), raisedByUserId: founder.id, targetMemberId: E.id } as never,
  });
  const eInv = await prisma.invite.create({ data: { fullName: "e2", email: E.email, targetRole: "member", departmentId: P.id, testTrackId: track.id, invitedById: founder.id, status: "open" } });
  await prisma.loginCode.create({ data: { email: E.email, codeHash: "x", expiresAt: new Date(Date.now() + 6e5) } });
  await prisma.passwordResetToken.create({ data: { email: E.email, tokenHash: `g3-${STAMP}`, expiresAt: new Date(Date.now() + 6e5) } });
  const pv = await membershipExitPreview(founder.id, E.id);
  chk("٣ · المعاينةُ تعرض العملَ المفتوح والنيابة واللجان", !!pv && pv.openCount === 3 && !!pv.member.deputyOf && pv.committees.length >= 1 && pv.work.invites === 1);
  chk("٣ · ولغير المؤسس والرئيس لا معاينة ولا إنهاء", (await membershipExitPreview(dUser.id, E.id)) === null && !(await terminateMembership(dUser.id, E.id, { reason: "x", replacementMemberId: B.id, confirm: true })).ok);
  chk("٣ · ولا إنهاءَ والعملُ المفتوحُ بلا بديل", !(await terminateMembership(founder.id, E.id, { reason: "x", confirm: true })).ok);
  chk("٣ · ولا ببديلٍ من قسمٍ آخر", !(await terminateMembership(founder.id, E.id, { reason: "x", replacementMemberId: X.id, confirm: true })).ok);
  chk("٣ · ولا حسابٌ قياديّ (يُغيَّر قائدُ القسم أولاً)", !(await terminateMembership(founder.id, D.id, { reason: "x", replacementMemberId: B.id, confirm: true })).ok);
  const epoch0 = await revocationEpoch();
  const auditBefore = await prisma.orgAuditEvent.count({ where: { entityId: C1.id } });
  const tr = await terminateMembership(founder.id, E.id, { reason: "قرار إداري (اختبار)", replacementMemberId: B.id, confirm: true });
  chk("٣ · المؤسسُ يُنهي العضوية ببديل", tr.ok, tr.ok ? "" : tr.reason);
  const e = await prisma.member.findUniqueOrThrow({ where: { id: E.id } });
  chk("٣ · الحسابُ معطَّلٌ والحالةُ «مغادر»", !e.isActive && !!e.terminatedAt && memberState(e) === "departed");
  chk("٣ · والجلسةُ تُبطَل", (await resolveSessionAccount(E.id, "member")).status === "gone");
  await new Promise((r) => setTimeout(r, Number(process.env.REVOCATION_EPOCH_TTL_MS ?? 5000) + 50));
  chk("٣ · وحقبةُ الإبطال تقدّمت (فكلُّ جلسةٍ أقدم تُراجَع فوراً)", (await revocationEpoch()) > epoch0);
  chk("٣ · ورموزُ الدخول وروابطُ الاستعادة استُهلكت", (await prisma.loginCode.count({ where: { email: E.email, usedAt: null } })) === 0 && (await prisma.passwordResetToken.count({ where: { email: E.email, usedAt: null } })) === 0);
  chk("٣ · والدعوةُ المعلّقة سقطت (لا تُحذف)", (await prisma.invite.findUniqueOrThrow({ where: { id: eInv.id } })).status === "expired");
  chk("٣ · والنيابةُ سُحبت", (await prisma.department.findUniqueOrThrow({ where: { id: P.id } })).deputyMemberId === null);
  chk("٣ · وعضوياتُ اللجان أُنهيت ولم تُحذف", (await prisma.committeeMembership.count({ where: { memberId: E.id, active: true } })) === 0 && (await prisma.committeeMembership.count({ where: { memberId: E.id } })) >= 1);
  chk("٣ · والمسؤولياتُ المفتوحة إلى البديل (لجنة، قسم، تذكرة)",
    (await prisma.committeeTask.findUniqueOrThrow({ where: { id: eTask.id } })).assigneeMemberId === B.id &&
    (await prisma.planTask.findUniqueOrThrow({ where: { id: ePlan.id } })).ownerMemberId === B.id &&
    (await prisma.ticket.findUniqueOrThrow({ where: { id: eTicket.id } })).targetMemberId === B.id);
  const tev = await prisma.orgAuditEvent.findFirst({ where: { entityId: E.id, action: "member.terminated" } });
  chk("٣ · وسُجّلت التفاصيلُ كلُّها", !!tev && JSON.stringify(tev.after).includes(B.id) && tev.note === "قرار إداري (اختبار)");
  chk("١١ · وإنجازُ المغادر يبقى باسمه (مهمّةُ اللجنة المُنجزة لا تنتقل)", (await prisma.committeeTask.findUniqueOrThrow({ where: { id: eDone.id } })).assigneeMemberId === E.id);
  chk("٣ · والسجلّاتُ التاريخية باقية (أحداثُ اللجنة لم تُمسّ)", (await prisma.orgAuditEvent.count({ where: { entityId: C1.id } })) >= auditBefore);
  chk("٣ · والمغادرُ لا يُنهى ثانيةً ولا يُعاد", !(await terminateMembership(founder.id, E.id, { reason: "x", confirm: true })).ok && !(await reinstateMember(founder.id, E.id)).ok);

  // الإيقافُ المؤقت: قائدٌ موقوف ⇐ خلافة؛ ورفعُه لا يعيد القيادة
  const sp = await suspendMember(ceo.id, B.id, "تحقيق إداري (اختبار)");
  chk("٣ · الإيقافُ المؤقت: لا جلسة، والحالةُ «موقوف مؤقتاً»", sp.ok && (await resolveSessionAccount(B.id, "member")).status === "gone" && memberState(await prisma.member.findUniqueOrThrow({ where: { id: B.id } })) === "suspended");
  const c1c = await prisma.department.findUniqueOrThrow({ where: { id: C1.id } });
  chk("٤ · وقائدٌ موقوف ⇐ خلافةٌ آلية", c1c.leadMemberId === null && c1c.actingLeadUserId === heir?.id);
  chk("٣ · ورفعُ الإيقاف يعيده نشطاً", (await reinstateMember(ceo.id, B.id)).ok && memberState(await prisma.member.findUniqueOrThrow({ where: { id: B.id } })) === "active");
  chk("٣ · ولا تعود قيادتُه آلياً", (await prisma.department.findUniqueOrThrow({ where: { id: C1.id } })).leadMemberId === null);
  chk("٣ · وقائدُ القسم لا يوقف ولا يرفع", !(await suspendMember(dUser.id, B.id, "x")).ok && !(await reinstateMember(dUser.id, B.id)).ok);

  await purge();
  if (!existingCeo) await prisma.user.deleteMany({ where: { id: ceo.id } });
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
