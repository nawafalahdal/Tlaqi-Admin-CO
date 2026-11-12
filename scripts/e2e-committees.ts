import { uniqueTestColor } from "./testColors";
import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { decideCommittee, canDecideCommittee, pendingCommittees, OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { buildOrgChart } from "@/lib/orgChart";
import { createDepartment } from "@/lib/departments";
import {
  orgActor,
  canManageCommitteesOf,
  canViewDepartmentMembers,
  canAppointDeputy,
  type OrgActor,
} from "@/lib/org/actor";
import {
  createCommittee,
  updateCommitteeDetails,
  submitCommittee,
  changeCommitteeStatus,
  appointCommitteeLead,
  addCommitteeMembers,
  removeCommitteeMember,
  setCommitteeResponsibility,
  proposeMembershipChange,
  decideProposal,
  appointDeputy,
  setDeputyPermissions,
  revokeDeputy,
  assignMemberResponsibility,
} from "@/lib/org/committeeService";
import {
  committeeContext,
  createCommitteeTask,
  updateCommitteeTaskStatus,
  scheduleCommitteeMeeting,
  recordCommitteeMeeting,
  addCommitteeDecision,
  submitCommitteeReport,
  reviewCommitteeReport,
} from "@/lib/org/committeeWork";
import { listCommittees, committeeDetail, departmentOverview, committeeCalendarWhere } from "@/lib/org/queries";
import { committeeAlerts } from "@/lib/org/alerts";
import { OFFICIAL_NOTICE_KINDS } from "@/lib/officialNotices";

/** **نظامُ اللجان والهيكل — على قاعدةٍ حقيقية، ببياناتٍ تجريبيةٍ موسومة.**
 *
 *  يغطّي سيناريوهات المواصفة (١–١٤): الإنشاء وشروطه، والقائد الواحد، والعضوية
 *  من القسم وحده، والنائب وتفويضه وسحبه، وحدودَ قائد اللجنة والعضو وقائد القسم
 *  الآخر، والإغلاقَ والأرشفة بلا حذف، وتسليمَ القيادة، والسجلَّ، والإشعارات.
 *  والواجهةُ (١٥) والأداءُ (١٦) في سكربتَيهما.
 *
 *  كلُّ ما يُنشأ موسومٌ بـ`STAMP` ويُمحى في آخره — ولا يُلمَس غيرُه. */

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}
const why = (r: { ok: boolean; reason?: string }) => (r.ok ? "مرّ!" : r.reason ?? "");

const STAMP = Date.now();
const DOMAIN = `@cmt-${STAMP}.example.test`;

function sess(role: string, departmentId: string | null, id: string, name = "اختبار"): Session {
  return { user: { id, role, departmentId, name } } as unknown as Session;
}

(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });
  const execSess = sess("executive", null, exec.id, exec.fullName);

  // ── التهيئة: قسمان، وقائدٌ لكلٍّ منهما، ومسؤولُ تشغيل، وأعضاء
  const colorA = uniqueTestColor(); // لونٌ فريد: لا يتشارك قسمان لوناً (تهيئةٌ لا توقّع)
  const deptA = await createDepartment({ name: `قسم لجان أ ${STAMP}`, colorHex: colorA, createdByName: "اختبار" });
  const deptB = await createDepartment({ name: `قسم لجان ب ${STAMP}`, colorHex: uniqueTestColor(), createdByName: "اختبار" });
  const mkUser = (role: "department_admin" | "operations_officer", departmentId: string | null, tag: string) =>
    prisma.user.create({ data: { fullName: `${tag} ${STAMP}`, email: `${tag.replace(/\s/g, "")}${DOMAIN}`, passwordHash: "x", role, departmentId } });
  const leadA = await mkUser("department_admin", deptA.id, "قائدأ");
  const leadB = await mkUser("department_admin", deptB.id, "قائدب");
  const ops = await mkUser("operations_officer", null, "تشغيل");
  const trackOf = async (deptId: string) =>
    (await prisma.testTrack.findFirst({ where: { departmentId: deptId } })) ??
    (await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } }));
  async function mkMember(deptId: string, tag: string) {
    const email = `${tag}${DOMAIN}`;
    const track = await trackOf(deptId);
    const invite = await prisma.invite.create({
      data: { fullName: `عضو ${tag}`, email, targetRole: "member", departmentId: deptId, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    return prisma.member.create({
      data: {
        fullName: `عضو ${tag} ${STAMP}`, email, departmentId: deptId, inviteId: invite.id, passwordHash: "x",
        approvalStatus: "approved", testStatus: "passed", isActive: true, jobTitle: "حساب فحص",
      },
    });
  }
  const [a1, a2, a3, a4, a5, a6] = await Promise.all(["a1", "a2", "a3", "a4", "a5", "a6"].map((t) => mkMember(deptA.id, t)));
  const b1 = await mkMember(deptB.id, "b1");

  const actor = async (s: Session) => (await orgActor(s))!;
  const LA = await actor(sess("department_admin", deptA.id, leadA.id, leadA.fullName));
  const LB = await actor(sess("department_admin", deptB.id, leadB.id, leadB.fullName));
  const OPS = await actor(sess("operations_officer", null, ops.id, ops.fullName));
  const EX = await actor(execSess);
  const mem = (m: { id: string; fullName: string }) => actor(sess("member", deptA.id, m.id, m.fullName));

  const base = {
    name: `التطوير ${STAMP}`,
    description: "وصف",
    purpose: "تطوير خدمات القسم",
    scope: "داخل القسم",
    responsibilities: "مسؤوليات",
    expectedOutputs: "مخرجات",
    kpis: "مؤشرات",
    kind: "permanent" as const,
    startDate: "2026-11-01",
    endDate: null,
  };

  // ═══ ١) قائدُ القسم ينشئ لجنة — وشروطُ الإنشاء ═══
  chk("١ · القائدُ يملك إدارة لجان قسمه", canManageCommitteesOf(LA, deptA.id));
  const noPurpose = await createCommittee(LA, deptA.id, { ...base, purpose: "  ", leadMemberId: a1.id, memberIds: [a2.id], submit: false });
  chk("١ · لا لجنةَ بلا غرض", !noPurpose.ok, why(noPurpose));
  const noName = await createCommittee(LA, deptA.id, { ...base, name: "", leadMemberId: a1.id, memberIds: [a2.id], submit: false });
  chk("١ · ولا بلا اسم", !noName.ok, why(noName));
  // تغييرُ توقّعٍ مقصود (دورة حياة اللجان، نوفمبر 2026 — توجيه المؤسس «بلا قائد، ويُعيَّن قائدٌ لاحقاً»): اللجنةُ تُنشأ
  // بلا قائد مسودّةً، ثم يُعيَّن قائدها. فتُحذف هنا كي لا يشغل اسمُها الاسمَ الذي يُختبر به الإنشاءُ الكامل بعدها
  const noLead = await createCommittee(LA, deptA.id, { ...base, name: `${base.name} بلا قائد`, leadMemberId: "", memberIds: [a2.id], submit: false });
  chk("١ · وتُنشأ بلا قائد (مسودّةً يُعيَّن قائدُها لاحقاً)", noLead.ok, why(noLead));
  if (noLead.ok) {
    await prisma.committeeMembership.deleteMany({ where: { committeeId: noLead.id } });
    await prisma.department.delete({ where: { id: noLead.id } });
  }
  // تغييرُ توقّعٍ مقصود (دورة حياة اللجان، نوفمبر 2026): الأعضاءُ يُضافون عند الإنشاء أو بعده بالصلاحية نفسها
  const noMembers = await createCommittee(LA, deptA.id, { ...base, name: `${base.name} بلا أعضاء`, leadMemberId: a1.id, memberIds: [], submit: false });
  chk("١ · وتُنشأ بلا أعضاء (يُضافون لاحقاً)", noMembers.ok, why(noMembers));
  if (noMembers.ok) {
    await prisma.committeeMembership.deleteMany({ where: { committeeId: noMembers.id } });
    await prisma.department.delete({ where: { id: noMembers.id } });
  }
  const tempNoEnd = await createCommittee(LA, deptA.id, { ...base, kind: "temporary", leadMemberId: a1.id, memberIds: [a2.id], submit: false });
  chk("١ · والمؤقّتةُ لا تُنشأ بلا تاريخ انتهاء", !tempNoEnd.ok, why(tempNoEnd));
  const endBefore = await createCommittee(LA, deptA.id, { ...base, kind: "temporary", startDate: "2026-12-01", endDate: "2026-11-01", leadMemberId: a1.id, memberIds: [a2.id], submit: false });
  chk("١ · ولا ينتهي قبل أن يبدأ", !endBefore.ok, why(endBefore));

  const created = await createCommittee(LA, deptA.id, { ...base, leadMemberId: a1.id, memberIds: [a2.id, a3.id], submit: false });
  chk("١ · تُنشأ بالشروط كاملة", created.ok, created.ok ? "" : created.reason);
  if (!created.ok) return finish();
  const cid = created.id;
  const row = await prisma.department.findUniqueOrThrow({ where: { id: cid } });
  chk("١ · مسودّةً تابعةً لقسمها مباشرة", row.committeeStatus === "draft" && row.parentId === deptA.id, `${row.committeeStatus}`);
  chk("١ · بحقولها (الغرض والنطاق والمسؤوليات والمخرجات والمؤشرات والنوع والبداية)",
    row.purpose === base.purpose && row.scope === base.scope && row.responsibilities === base.responsibilities &&
      row.expectedOutputs === base.expectedOutputs && row.kpis === base.kpis && row.committeeKind === "permanent" &&
      row.startDate?.toISOString().slice(0, 10) === "2026-11-01" && row.endDate === null);
  chk("١ · ولونُها لونُ قسمها", row.colorHex === colorA, row.colorHex);
  const active = await prisma.committeeMembership.findMany({ where: { committeeId: cid, active: true }, select: { memberId: true } });
  chk("١ · القائدُ عضوٌ فيها والأعضاءُ معه", active.length === 3 && active.some((m) => m.memberId === a1.id), String(active.length));
  chk("١ · ولا يتغيّر قسمُ أحدٍ بعضويته", (await prisma.member.findUniqueOrThrow({ where: { id: a2.id } })).departmentId === deptA.id);
  chk("١ · ولا تُنشأ دعوةٌ ولا نظامُ عضويةٍ موازٍ", (await prisma.invite.count({ where: { departmentId: cid } })) === 0);
  chk("١ · والمسودّةُ لا تظهر في القوائم المفتوحة ولا الهيكل",
    (await prisma.department.count({ where: { ...OPEN_DEPARTMENT_WHERE, id: cid } })) === 0 && !JSON.stringify(await buildOrgChart()).includes(cid));
  const dup = await createCommittee(LA, deptA.id, { ...base, leadMemberId: a4.id, memberIds: [a5.id], submit: false });
  chk("١ · ولا اسمَ مكرّراً في القسم", !dup.ok, why(dup));

  // ═══ ٢) قائدٌ واحدٌ لكل لجنة ═══
  const nested = await createCommittee(EX, cid, { ...base, name: `فرعية ${STAMP}`, leadMemberId: a2.id, memberIds: [a3.id], submit: false });
  chk("٢ · ولا لجنةَ داخل لجنة", !nested.ok, why(nested));
  const leadCol = await prisma.department.findUniqueOrThrow({ where: { id: cid }, select: { leadMemberId: true } });
  chk("٢ · القائدُ عمودٌ واحد — لا يتّسع لاثنين", leadCol.leadMemberId === a1.id);
  const rmLead = await removeCommitteeMember(LA, cid, a1.id, null);
  chk("٢ · ولا يُخرَج القائدُ قبل تعيين غيره", !rmLead.ok, why(rmLead));

  // ═══ ٣) إضافةُ أعضاءٍ من القسم ═══
  const add = await addCommitteeMembers(LA, cid, [a4.id]);
  chk("٣ · يُضاف عضوٌ من القسم", add.ok && add.added === 1, why(add));
  const again = await addCommitteeMembers(LA, cid, [a4.id]);
  chk("٣ · ولا يُضاف مرّتين", !again.ok, why(again));

  // ═══ ٤) لا عضوَ من قسمٍ آخر ═══
  const outsider = await addCommitteeMembers(LA, cid, [b1.id]);
  chk("٤ · ويُرفض عضوٌ من قسمٍ آخر", !outsider.ok, why(outsider));
  const mixed = await addCommitteeMembers(LA, cid, [a5.id, b1.id]);
  chk("٤ · ولو خُلط بعضوٍ من القسم — يُرفض الطلبُ كلُّه", !mixed.ok && (await prisma.committeeMembership.count({ where: { committeeId: cid, memberId: a5.id } })) === 0, why(mixed));
  const outsiderLead = await appointCommitteeLead(LA, cid, b1.id);
  chk("٤ · ولا قائدَ من قسمٍ آخر", !outsiderLead.ok, why(outsiderLead));

  // ═══ ٥) تعيينُ النائب — واحدٌ للقسم ═══
  const depB = await appointDeputy(LA, deptA.id, b1.id, ["committees_manage"]);
  chk("٥ · لا نائبَ من قسمٍ آخر", !depB.ok, why(depB));
  const byOther = await appointDeputy(LB, deptA.id, a5.id, []);
  chk("٥ · ولا يعيّن قائدُ قسمٍ نائباً لغيره", !byOther.ok, why(byOther));
  const byExec = await appointDeputy(EX, deptA.id, a5.id, []);
  chk("٥ · والنيابةُ قرارُ قائد القسم وحده", !byExec.ok && !canAppointDeputy(EX, deptA.id), why(byExec));
  const dep = await appointDeputy(LA, deptA.id, a5.id, []);
  chk("٥ · القائدُ يعيّن نائباً من قسمه", dep.ok, why(dep));
  const dep2 = await appointDeputy(LA, deptA.id, a6.id, []);
  chk("٥ · وتعيينُ غيره يحلّ محلّه — لا نائبان", dep2.ok, why(dep2));
  const deputyRow = await prisma.department.findUniqueOrThrow({ where: { id: deptA.id }, select: { deputyMemberId: true } });
  chk("٥ · فالنائبُ الآن واحد", deputyRow.deputyMemberId === a6.id);
  chk("٥ · والسابقُ لم يعد نائباً", (await actor(sess("member", deptA.id, a5.id))).deputy === null);
  let D = await mem(a6);
  chk("٥ · والنائبُ بلا تفويضٍ لا يملك شيئاً", D.deputy !== null && !canManageCommitteesOf(D, deptA.id) && !canViewDepartmentMembers(D, deptA.id));
  const deputyAppoints = await appointDeputy(D, deptA.id, a5.id, []);
  chk("٥ · والنائبُ لا يُنيب", !deputyAppoints.ok, why(deputyAppoints));

  // ═══ ٦) تفويضُ صلاحياتٍ محدّدة ═══
  const perms = await setDeputyPermissions(LA, deptA.id, ["committees_manage", "members_view"]);
  chk("٦ · يُفوَّض النائب", perms.ok, why(perms));
  D = await mem(a6);
  chk("٦ · فيملك ما فُوِّض وحده", canManageCommitteesOf(D, deptA.id) && canViewDepartmentMembers(D, deptA.id) && !canAppointDeputy(D, deptA.id));
  const badPerm = await setDeputyPermissions(LA, deptA.id, ["committees_manage", "approve_everything"]);
  chk("٦ · ولا يُفوَّض ما ليس في القائمة", !badPerm.ok, why(badPerm));
  const depCreates = await createCommittee(D, deptA.id, { ...base, name: `لجنة النائب ${STAMP}`, leadMemberId: a4.id, memberIds: [a5.id], submit: false });
  chk("٦ · النائبُ المفوَّض ينشئ لجنةً في قسمه", depCreates.ok, why(depCreates));
  const depOther = await createCommittee(D, deptB.id, { ...base, name: `دخيلة ${STAMP}`, leadMemberId: b1.id, memberIds: [b1.id], submit: false });
  chk("٦ · ولا ينشئ في قسمٍ آخر", !depOther.ok, why(depOther));

  // ═══ ٧) سحبُ التفويض ═══
  const rev = await revokeDeputy(LA, deptA.id, "انتهاء المهمة");
  chk("٧ · تُسحب النيابة", rev.ok, why(rev));
  D = await mem(a6);
  chk("٧ · فيفقد كلَّ صلاحيةٍ فوراً — في الطلب التالي", D.deputy === null && !canManageCommitteesOf(D, deptA.id));
  const afterRevoke = await createCommittee(D, deptA.id, { ...base, name: `بعد السحب ${STAMP}`, leadMemberId: a4.id, memberIds: [a5.id], submit: false });
  chk("٧ · ويُرفض إنشاؤه بعد السحب", !afterRevoke.ok, why(afterRevoke));

  // ── الاعتماد: الإرسالُ ثم قرارُ التنفيذي (المسارُ القائم لم يُلغَ)
  const sub = await submitCommittee(LA, cid);
  chk("الإرسالُ للاعتماد", sub.ok, why(sub));
  chk("وتظهر في طابور التنفيذي", (await pendingCommittees()).some((p) => p.id === cid));
  const selfApprove = await decideCommittee({ committeeId: cid, decision: "approved", session: sess("department_admin", deptA.id, leadA.id) });
  chk("ولا يعتمدها قائدُ قسمها", !selfApprove.ok && !canDecideCommittee("department_admin"));
  const approved = await decideCommittee({ committeeId: cid, decision: "approved", session: execSess });
  chk("والتنفيذي يعتمدها فتصير نشطة", approved.ok && (await prisma.department.findUniqueOrThrow({ where: { id: cid } })).committeeStatus === "approved");

  // ═══ ٨) قائدُ اللجنة لا ينشئ لجنة — ولا يتجاوز قائد القسم ═══
  const CL = await mem(a1);
  const clCreate = await createCommittee(CL, deptA.id, { ...base, name: `لجنة القائد ${STAMP}`, leadMemberId: a2.id, memberIds: [a3.id], submit: false });
  chk("٨ · قائدُ اللجنة لا ينشئ لجنة", !clCreate.ok, why(clCreate));
  chk("٨ · ولا يصير قائدَ قسم", CL.leadsDepartmentId === null && !canManageCommitteesOf(CL, deptA.id));
  const clStatus = await changeCommitteeStatus(CL, cid, "suspended", "محاولة");
  chk("٨ · ولا يغيّر حالةَ لجنته", !clStatus.ok, why(clStatus));
  const clAdd = await addCommitteeMembers(CL, cid, [a5.id]);
  chk("٨ · ولا يضيف أعضاءً بنفسه", !clAdd.ok, why(clAdd));
  const clLead = await appointCommitteeLead(CL, cid, a2.id);
  chk("٨ · ولا يعيّن قائداً", !clLead.ok, why(clLead));
  const ctxL = await committeeContext(CL, cid);
  chk("٨ · ويقود أعمالها", ctxL?.role.lead === true && ctxL.role.manage === false);
  const t1 = await createCommitteeTask(CL, cid, { title: "مهمّة أولى", assigneeMemberId: a2.id, dueAt: "2026-01-01T23:59:00+03:00", priority: "high" });
  chk("٨ · يوزّع المهامّ", t1.ok, why(t1));
  const tOut = await createCommitteeTask(CL, cid, { title: "لدخيل", assigneeMemberId: b1.id });
  chk("٨ · ولا يُسند لمن ليس عضواً", !tOut.ok, why(tOut));
  const meet = await scheduleCommitteeMeeting(CL, cid, { title: "الاجتماع الأول", startsAt: "2026-11-10T18:00:00+03:00", durationMinutes: 60, meetingUrl: "https://meet.google.com/abc-defg-hij", agenda: "البنود" });
  chk("٨ · يجدول الاجتماعات", meet.ok, why(meet));
  const badUrl = await scheduleCommitteeMeeting(CL, cid, { title: "رابط خطر", startsAt: "2026-11-11T18:00:00+03:00", meetingUrl: "javascript:alert(1)" });
  chk("٨ · ولا يقبل رابطاً غير آمن", !badUrl.ok, why(badUrl));
  if (meet.ok) {
    // محضرٌ فيه غيرُ عضو يُرفَض كلُّه — لا يُقبل نصفُه صامتاً
    const withOutsider = await recordCommitteeMeeting(CL, meet.id, {
      attendance: [{ memberId: a2.id, status: "present" }, { memberId: b1.id, status: "present" }],
      minutes: "محضر",
    });
    chk("٨ · ولا يُسجَّل حضورُ غير عضو — يُرفض المحضرُ كلُّه", !withOutsider.ok && (await prisma.committeeAttendance.count({ where: { meetingId: meet.id } })) === 0, why(withOutsider));
    const rec = await recordCommitteeMeeting(CL, meet.id, {
      attendance: [{ memberId: a2.id, status: "present" }, { memberId: a3.id, status: "absent" }],
      minutes: "المحضر",
    });
    chk("٨ · يسجّل الحضور والمحضر", rec.ok, why(rec));
    const att = await prisma.committeeAttendance.findMany({ where: { meetingId: meet.id } });
    chk("٨ · بحضوره وغيابه", att.length === 2 && att.some((x) => x.memberId === a3.id && x.status === "absent"), String(att.length));
  }
  const dec = await addCommitteeDecision(CL, cid, { kind: "decision", text: "قرارٌ أوّل", meetingId: meet.ok ? meet.id : null });
  chk("٨ · يوثّق القرارات", dec.ok, why(dec));
  const prop = await proposeMembershipChange(CL, cid, { kind: "add_member", memberId: a5.id, note: "خبرة" });
  chk("٨ · يقترح تغيير العضوية", prop.ok, why(prop));
  const propOut = await proposeMembershipChange(CL, cid, { kind: "add_member", memberId: b1.id });
  chk("٨ · ولا يقترح من قسمٍ آخر", !propOut.ok, why(propOut));
  const p1 = await prisma.committeeProposal.findFirstOrThrow({ where: { committeeId: cid, status: "pending" } });
  const clDecides = await decideProposal(CL, p1.id, true);
  chk("٨ · ولا يقرّر اقتراحَه — القرارُ لقائد القسم", !clDecides.ok, why(clDecides));
  const leaderDecides = await decideProposal(LA, p1.id, true, "موافق");
  chk("٨ · وقائدُ القسم يقبله فيُضاف العضو", leaderDecides.ok && (await prisma.committeeMembership.count({ where: { committeeId: cid, memberId: a5.id, active: true } })) === 1, why(leaderDecides));
  const rep = await submitCommitteeReport(CL, cid, { periodLabel: "نوفمبر", summary: "ملخّص" });
  chk("٨ · يرفع تقريراً لقائد القسم", rep.ok, why(rep));
  const rp = await prisma.committeeReport.findFirstOrThrow({ where: { committeeId: cid } });
  const clReview = await reviewCommitteeReport(CL, rp.id, null);
  chk("٨ · ولا يراجع تقريرَه بنفسه", !clReview.ok, why(clReview));
  chk("٨ · وقائدُ القسم يراجعه", (await reviewCommitteeReport(LA, rp.id, "جيد")).ok);
  const resp = await setCommitteeResponsibility(CL, cid, a2.id, "المتابعة");
  chk("٨ · ويوزّع المسؤوليات داخل لجنته", resp.ok, why(resp));

  // ═══ ٩) العضوُ لا يعدّل اللجنة ═══
  const M = await mem(a2);
  const mEdit = await updateCommitteeDetails(M, cid, { ...base, name: `تعديل عضو ${STAMP}` });
  chk("٩ · العضوُ لا يعدّل بياناتها", !mEdit.ok, why(mEdit));
  const mLead = await appointCommitteeLead(M, cid, a2.id);
  chk("٩ · ولا يغيّر القائد", !mLead.ok, why(mLead));
  const mAdd = await addCommitteeMembers(M, cid, [a6.id]);
  chk("٩ · ولا يضيف أعضاء", !mAdd.ok, why(mAdd));
  const mRm = await removeCommitteeMember(M, cid, a3.id);
  chk("٩ · ولا يُخرج أحداً", !mRm.ok, why(mRm));
  const mClose = await changeCommitteeStatus(M, cid, "closed", "محاولة");
  chk("٩ · ولا يغلقها", !mClose.ok, why(mClose));
  const mTask = await createCommitteeTask(M, cid, { title: "مهمّة عضو", assigneeMemberId: a2.id });
  chk("٩ · ولا يوزّع مهامّ", !mTask.ok, why(mTask));
  const mDecision = await addCommitteeDecision(M, cid, { kind: "decision", text: "قرار عضو" });
  chk("٩ · ولا يُصدر قراراً", !mDecision.ok, why(mDecision));
  const mNote = await addCommitteeDecision(M, cid, { kind: "note", text: "ملاحظة عضو" });
  chk("٩ · ويشارك بملاحظة", mNote.ok, why(mNote));
  if (t1.ok) {
    const own = await updateCommitteeTaskStatus(M, t1.id, "in_progress");
    chk("٩ · وينفّذ مهمّته ويحدّث حالتها", own.ok, why(own));
    const cancelOwn = await updateCommitteeTaskStatus(M, t1.id, "cancelled");
    chk("٩ · ولا يُلغيها — الإلغاءُ للقائد", !cancelOwn.ok, why(cancelOwn));
    const other = await updateCommitteeTaskStatus(await mem(a3), t1.id, "done");
    chk("٩ · ولا يحدّث مهمّةَ غيره", !other.ok, why(other));
  }
  chk("٩ · وعضويتُه لا تمنحه صلاحيةً قيادية", M.leadsDepartmentId === null && !canManageCommitteesOf(M, deptA.id));

  // ═══ ١٠) قائدُ قسمٍ آخر لا يصل ═══
  chk("١٠ · لا يرى اللجنة", (await committeeContext(LB, cid)) === null && (await committeeDetail(LB, cid)) === null);
  const lbList = await listCommittees(LB, {});
  chk("١٠ · ولا تظهر في قائمته", !!lbList && !lbList.rows.some((r) => r.id === cid));
  chk("١٠ · ولا يرى نظرةَ القسم الآخر", (await departmentOverview(LB, deptA.id)) === null);
  const lbAdd = await addCommitteeMembers(LB, cid, [b1.id]);
  chk("١٠ · ولا يضيف إليها", !lbAdd.ok, why(lbAdd));
  const lbCreate = await createCommittee(LB, deptA.id, { ...base, name: `اختراق ${STAMP}`, leadMemberId: a2.id, memberIds: [a3.id], submit: false });
  chk("١٠ · ولا ينشئ في قسمٍ غيره", !lbCreate.ok, why(lbCreate));
  const lbResp = await assignMemberResponsibility(LB, deptA.id, a2.id, "اختراق");
  chk("١٠ · ولا يوزّع مسؤولياتِ قسمٍ آخر", !lbResp.ok, why(lbResp));
  const outsiderMember = await actor(sess("member", deptB.id, b1.id));
  chk("١٠ · ولا يرى عضوُ قسمٍ آخر اللجنة", (await committeeContext(outsiderMember, cid)) === null);
  chk("١٠ · ومسؤولُ التشغيل يطّلع ولا يدير", (await committeeContext(OPS, cid))?.role.view === true && !canManageCommitteesOf(OPS, deptA.id));
  const opsAdd = await addCommitteeMembers(OPS, cid, [a6.id]);
  chk("١٠ · ولا يضيف ولا يعتمد", !opsAdd.ok, why(opsAdd));
  chk("١٠ · والتقويمُ يحدّ العضوَ بمهامّه", JSON.stringify(committeeCalendarWhere(await mem(a3))?.tasks).includes(a3.id));

  // ═══ ١٢) تسليمُ القيادة ═══
  await prisma.member.update({ where: { id: a1.id }, data: { isActive: false } });
  const ov = await departmentOverview(LA, deptA.id);
  chk("١٢ · غيابُ القائد يُكشف في نظرة القسم", !!ov && ov.leaderless.some((c) => c.id === cid));
  chk("١٢ · وفي تنبيهات قائد القسم", (await committeeAlerts(LA)).some((x) => x.id === "committee-leaderless"));
  chk("١٢ · وفي تنبيهات الإدارة العليا (مسارُ التسليم)", (await committeeAlerts(EX)).some((x) => x.id === "committee-leaderless"));
  const susp = await changeCommitteeStatus(LA, cid, "suspended", "غياب القائد");
  chk("١٢ · تُعلَّق بسببٍ مكتوب", susp.ok, why(susp));
  const reactivate = await changeCommitteeStatus(LA, cid, "approved", null);
  chk("١٢ · ولا تعود للعمل بلا قائدٍ نشط", !reactivate.ok, why(reactivate));
  const handover = await appointCommitteeLead(LA, cid, a2.id, "تسليم");
  chk("١٢ · يُسلَّم المقعد لقائدٍ جديد", handover.ok, why(handover));
  chk("١٢ · فتعود للعمل", (await changeCommitteeStatus(LA, cid, "approved", null)).ok);
  chk("١٢ · والقائدُ السابقُ يبقى عضواً في السجلّ — لا يُحذف", (await prisma.committeeMembership.count({ where: { committeeId: cid, memberId: a1.id } })) === 1);
  await prisma.member.update({ where: { id: a1.id }, data: { isActive: true } });
  // المؤسس/التنفيذي مسارُ التسليم حين يخلو مقعدُ قائد القسم
  chk("١٢ · والإدارةُ العليا تملك التعيين حين يخلو مقعدُ قائد القسم", canManageCommitteesOf(EX, deptA.id));

  // ═══ ١١) الإغلاقُ ثم الأرشفة — بلا حذف ═══
  const noNote = await changeCommitteeStatus(LA, cid, "closed", "  ");
  chk("١١ · لا إغلاقَ بلا سبب", !noNote.ok, why(noNote));
  const toDraft = await changeCommitteeStatus(LA, cid, "draft", null);
  chk("١١ · ولا انتقالَ خارج المسار المكتوب", !toDraft.ok, why(toDraft));
  chk("١١ · تُغلق بسببٍ مكتوب", (await changeCommitteeStatus(LA, cid, "closed", "انتهت مهمتها")).ok);
  const frozenEdit = await updateCommitteeDetails(LA, cid, { ...base, name: `بعد الإغلاق ${STAMP}` });
  chk("١١ · والمغلقةُ لا تُعدَّل", !frozenEdit.ok, why(frozenEdit));
  const frozenAdd = await addCommitteeMembers(LA, cid, [a6.id]);
  chk("١١ · ولا يُضاف إليها", !frozenAdd.ok, why(frozenAdd));
  // تغييرُ توقّعٍ مقصود (دورة حياة اللجان، نوفمبر 2026): الأرشفةُ قابلةٌ للاسترجاع فتُسجَّل بسببٍ مكتوب كالتعليق والإغلاق
  const archiveNoNote = await changeCommitteeStatus(LA, cid, "archived", null);
  chk("١١ · ولا أرشفةَ بلا سبب", !archiveNoNote.ok, why(archiveNoNote));
  chk("١١ · ثم تُؤرشف بسببٍ مكتوب", (await changeCommitteeStatus(LA, cid, "archived", "انتهى عملها وتُحفظ للرجوع")).ok);
  const reopen = await changeCommitteeStatus(LA, cid, "approved", null);
  chk("١١ · والمؤرشفةُ لا تُعاد فتحاً", !reopen.ok, why(reopen));
  const kept = await prisma.department.findUniqueOrThrow({
    where: { id: cid },
    select: { committeeStatus: true, _count: { select: { committeeMemberships: true, committeeTasks: true, committeeMeetings: true, committeeDecisions: true, committeeReports: true } } },
  });
  chk("١١ · وتاريخُها محفوظٌ كاملاً", kept.committeeStatus === "archived" && kept._count.committeeMemberships >= 5 && kept._count.committeeTasks >= 1 && kept._count.committeeMeetings >= 1 && kept._count.committeeDecisions >= 2 && kept._count.committeeReports === 1, JSON.stringify(kept._count));
  let deleteBlocked = false;
  try {
    await prisma.department.delete({ where: { id: cid } });
  } catch {
    deleteBlocked = true;
  }
  chk("١١ · والقاعدةُ نفسُها تمنع حذفَ لجنةٍ لها سجلّ (Restrict)", deleteBlocked);

  // ═══ ١٣) سجلُّ التدقيق ═══
  const events = await prisma.orgAuditEvent.findMany({ where: { entityId: cid }, orderBy: { createdAt: "asc" } });
  const actions = new Set(events.map((e) => e.action));
  for (const a of ["committee.created", "committee.members_added", "committee.submitted", "committee.decided", "committee.handover", "committee.status", "committee.proposal", "committee.proposal_decided", "task.created", "task.status", "meeting.scheduled", "meeting.recorded", "decision.added", "report.submitted", "report.reviewed", "committee.responsibility"]) {
    chk(`١٣ · السجلُّ يحفظ «${a}»`, actions.has(a));
  }
  // تغييرُ قائدٍ قائمٍ تسليمٌ (`committee.handover`) منذ ملاحظة المؤسس الثالثة — كان «committee.lead»؛
  // و«committee.lead» يبقى لتعيين قائدٍ للجنةٍ خالية. التوقّعُ تغيّر بالمتطلّب، لا ليُخضرّ الفحص
  const leadEvt = events.filter((e) => e.action === "committee.handover").pop();
  // منذ المرحلة الثالثة (المتطلب الرابع): قيادةُ القائد الغائب تنتهي **بالخلافة الآلية** قبل أي تعيين — فالقائدُ
  // السابقُ في حدث `committee.succession`، وحدثُ التعيين يبدأ من القائم بالخلافة. التوقّعُ تغيّر بالمتطلّب
  const succEvt = events.find((e) => e.action === "committee.succession");
  chk("١٣ · وتغييرُ القائد بقبلُه وبعدُه (السابقُ في الخلافة، والجديدُ في التعيين)",
    !!leadEvt && !!succEvt && JSON.stringify(succEvt.before).includes(a1.fullName) && JSON.stringify(leadEvt.before).includes("actingLeadUserId") && JSON.stringify(leadEvt.after).includes(a2.fullName),
    JSON.stringify([succEvt?.before, leadEvt?.before, leadEvt?.after]).slice(0, 160));
  chk("١٣ · وكلُّ حدثٍ باسم فاعله ووقته", events.every((e) => e.actorName && e.createdAt));
  const closeEvt = events.find((e) => e.action === "committee.status" && JSON.stringify(e.after).includes("closed"));
  chk("١٣ · والإغلاقُ بسببه", !!closeEvt && (closeEvt.note ?? "").includes("انتهت"));
  chk("١٣ · وسجلُّ القسم يحفظ النيابة", (await prisma.orgAuditEvent.count({ where: { entityId: deptA.id, action: { in: ["department.deputy", "department.deputy_permissions", "department.deputy_revoked"] } } })) >= 3);
  const failedNoEvent = await prisma.orgAuditEvent.count({ where: { entityId: deptA.id, actorName: leadB.fullName } });
  chk("١٣ · والمحاولةُ المرفوضة لا تُسجَّل كأنها وقعت", failedNoEvent === 0);

  // ═══ ١٤) الإشعارات ═══
  const mails = await prisma.emailLog.findMany({ where: { recipient: { endsWith: DOMAIN } }, select: { kind: true, recipient: true, status: true } });
  chk("١٤ · بريدُ تكليف القائد — يصله حين تُعتمد اللجنة لا قبلها", mails.some((m) => m.kind === "تكليف لجنة" && m.recipient === a1.email));
  chk("١٤ · وبريدُ تكليف القائد الجديد عند التسليم", mails.some((m) => m.kind === "تكليف لجنة" && m.recipient === a2.email));
  chk("١٤ · وبريدُ تفويض النائب", mails.some((m) => m.kind === "تفويض نائب"));
  chk("١٤ · وإضافةُ العضو مكتومةٌ بسياسة التقليل (تُسجَّل ولا تُرسل)", mails.filter((m) => m.kind === "عضوية لجنة").every((m) => m.status.includes("سياسة التقليل")) && mails.some((m) => m.kind === "عضوية لجنة"));
  chk("١٤ · والتكليفاتُ في سجل التنبيهات الرسمي", OFFICIAL_NOTICE_KINDS["تكليف لجنة"] === "membership" && OFFICIAL_NOTICE_KINDS["تفويض نائب"] === "membership");

  return finish();

  async function finish() {
    // ── تنظيف: ما أُنشئ هنا وحده، الأعمقُ أولاً (القيودُ Restrict عن قصد)
    const cids = (await prisma.department.findMany({ where: { parentId: { in: [deptA.id, deptB.id] } }, select: { id: true } })).map((c) => c.id);
    const memberIds = [a1, a2, a3, a4, a5, a6, b1].map((m) => m.id);
    // سجلُّ الحوكمة لا يُحذف (قيدُ APPEND_ONLY في القاعدة) — تبقى أحداثُ الفحص سجلاً في القاعدة المؤقتة
    await prisma.committeeTask.deleteMany({ where: { committeeId: { in: cids } } });
    await prisma.committeeDecision.deleteMany({ where: { committeeId: { in: cids } } });
    await prisma.committeeAttendance.deleteMany({ where: { meeting: { committeeId: { in: cids } } } });
    await prisma.committeeMeeting.deleteMany({ where: { committeeId: { in: cids } } });
    await prisma.committeeReport.deleteMany({ where: { committeeId: { in: cids } } });
    await prisma.committeeProposal.deleteMany({ where: { committeeId: { in: cids } } });
    await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: cids } } });
    await prisma.department.updateMany({ where: { id: { in: [deptA.id, deptB.id] } }, data: { deputyMemberId: null, deputyPermissions: [] } });
    await prisma.testTrack.deleteMany({ where: { departmentId: { in: cids } } });
    await prisma.department.deleteMany({ where: { id: { in: cids } } });
    await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.emailLog.deleteMany({ where: { recipient: { endsWith: DOMAIN } } });
    await prisma.user.deleteMany({ where: { id: { in: [leadA.id, leadB.id, ops.id] } } });
    await prisma.testTrack.deleteMany({ where: { departmentId: { in: [deptA.id, deptB.id] } } });
    await prisma.department.deleteMany({ where: { id: { in: [deptA.id, deptB.id] } } });

    console.log(log.join("\n"));
    const failed = log.some((l) => l.startsWith("✗"));
    console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  }
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

export type { OrgActor };
