import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { orgActor, canProposeCommitteesOf, committeeRoleFor } from "@/lib/org/actor";
import { createCommittee } from "@/lib/org/committeeService";
import { departmentsForCreation } from "@/lib/org/queries";
import { decideCommittee } from "@/lib/committees";
import { ensureCommitteeSuccession } from "@/lib/org/committeeLeadership";
import { createDepartment } from "@/lib/departments";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";

/** **لجانُ الإدارة العليا** — بالنظام نفسه: يقترحها الرئيسُ التنفيذي والمؤسس، ولا يعتمد أحدٌ
 *  اقتراحَه، وأعضاؤها من أهلها المسجَّلين فيها، والخلافةُ كما هي.
 *
 *  على نسخةٍ مؤقتة من القاعدة المحلية الاصطناعية:
 *    createdb -T tlaqi_mk tlaqi_senior_e2e
 *    DATABASE_URL=…/tlaqi_senior_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-senior-committees.ts */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_senior_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_senior_e2e وحدها");
  process.exit(1);
}
const TAG = `e2e-sc-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const sess = (u: { id: string; role: string; fullName: string; departmentId?: string | null }) =>
  ({ user: { id: u.id, role: u.role, name: u.fullName, email: `${u.id}@x`, departmentId: u.departmentId ?? null } } as unknown as Session);

(async () => {
  let senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
  if (!senior) {
    await createDepartment({ name: "الإدارة العليا", colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
    senior = await prisma.department.findFirstOrThrow({ where: { leadershipOnly: true, parentId: null } });
  }
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing" } }).catch(async () => prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false } }));
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const track = await prisma.testTrack.findFirstOrThrow();
  let n = 0;
  const mkUser = (role: "executive" | "operations_officer" | "department_admin", departmentId: string | null) =>
    prisma.user.create({ data: { fullName: `${role} ${TAG}`, email: `${TAG}-${role}-${++n}@example.test`, passwordHash: "!", role, departmentId, isActive: true } });
  async function mkMember(departmentId: string) {
    const email = `${TAG}-m${++n}@example.test`;
    const inv = await prisma.invite.create({ data: { fullName: "نموذج", email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
    return prisma.member.create({
      data: { fullName: `نموذج ${n}`, email, departmentId, inviteId: inv.id, passwordHash: "!", approvalStatus: "approved", decidedAt: new Date(), isActive: true, credentialsIssuedAt: new Date() },
    });
  }
  const ceo = await mkUser("executive", null);
  const ops = await mkUser("operations_officer", null);
  const mktLead = await mkUser("department_admin", marketing.id);
  const [s1, s2, s3, s4] = [await mkMember(senior.id), await mkMember(senior.id), await mkMember(senior.id), await mkMember(senior.id)];
  const outsider = await mkMember(marketing.id);

  const aFounder = await orgActor(sess(founder));
  const aCeo = await orgActor(sess(ceo));
  const aOps = await orgActor(sess(ops));
  const aLead = await orgActor(sess(mktLead));

  // ١ — من يقترح في الإدارة العليا.
  //    **تغييرُ توقّعٍ مقصود (إعادة هيكلة الحوكمة، نوفمبر 2026):** الإدارةُ العليا يقودها شخصٌ واحدٌ في كل وقت — الرئيسُ
  //    التنفيذي، وبغيابه المؤسس. فمع رئيسٍ نشط **يقترح الرئيسُ ويعتمد المؤسس** (لا يعتمد أحدٌ اقتراحه)، وبغياب الرئيس
  //    يقترح المؤسس (القسم ٤ أدناه). كان الفحصُ يتوقّع أن يقترحا معاً — وهو ما ألغته قاعدةُ القائد الواحد.
  chk("مع رئيسٍ تنفيذيٍّ نشط: هو من يقترح لجان الإدارة العليا، والمؤسسُ يعتمد", canProposeCommitteesOf(aCeo, senior.id) && !canProposeCommitteesOf(aFounder, senior.id));
  chk("ولا يقترحها مسؤول التشغيل ولا قائد قسمٍ آخر", !canProposeCommitteesOf(aOps, senior.id) && !canProposeCommitteesOf(aLead, senior.id));
  chk("والرئيس والمؤسس لا يقترحان لجان الأقسام الأخرى (لقائدها)", !canProposeCommitteesOf(aCeo, marketing.id) && !canProposeCommitteesOf(aFounder, marketing.id) && canProposeCommitteesOf(aLead, marketing.id));
  const forCeo = await departmentsForCreation(aCeo);
  chk("صفحة الإنشاء تعرض الإدارة العليا لقائدها (الرئيس) لا للمؤسس حينها", forCeo.some((d) => d.id === senior!.id) && !(await departmentsForCreation(aFounder)).some((d) => d.id === senior!.id));
  chk("ولا تعرضها لمسؤول التشغيل ولا لقائد التسويق", (await departmentsForCreation(aOps)).length === 0 && !(await departmentsForCreation(aLead)).some((d) => d.id === senior!.id));

  const input = (name: string, lead: string, members: string[]) => ({
    name, purpose: "تنسيق ملفات الحوكمة والسياسات", kind: "permanent" as const, leadMemberId: lead, memberIds: members, submit: true,
  });

  // ٢ — المؤسس لا يقترح والرئيسُ قائمٌ: يُرفض بسببٍ مفهوم (ويبقى له الاعتماد)
  const refused = await createCommittee(aFounder, senior.id, input(`لجنة مرفوضة ${TAG}`, s1.id, [s2.id]));
  chk("المؤسسُ لا يُنشئ لجنةً في الإدارة العليا والرئيسُ قائم — ويُقال له لماذا", !refused.ok && !!refused.reason, JSON.stringify(refused));
  // ولجنةُ الحوكمة (التي تُختبر بها الأدوار أدناه) يقترحها الرئيس ويعتمدها المؤسس
  const c1 = await createCommittee(aCeo, senior.id, input(`لجنة الحوكمة ${TAG}`, s1.id, [s2.id]));
  chk("الرئيسُ يقترح لجنة الحوكمة (طلب اعتماد)", c1.ok && c1.status === "pending_review", JSON.stringify(c1));
  if (c1.ok) {
    const byFounder1 = await decideCommittee({ committeeId: c1.id, decision: "approved", session: sess(founder) });
    chk("ويعتمدها المؤسس", byFounder1.ok, JSON.stringify(byFounder1));
    const row = await prisma.department.findUniqueOrThrow({ where: { id: c1.id } });
    chk("وتظهر في القسم الصحيح (أبوها الإدارة العليا) ومفتوحةً في القوائم", row.parentId === senior.id && (await prisma.department.count({ where: { id: c1.id, ...OPEN_DEPARTMENT_WHERE } })) === 1);
  }

  // ٣ — الرئيسُ يُنشئ، والمؤسسُ يقرّر
  const c2 = await createCommittee(aCeo, senior.id, input(`لجنة السياسات ${TAG}`, s3.id, [s4.id]));
  chk("الرئيس التنفيذي يُنشئ لجنة في الإدارة العليا", c2.ok && c2.status === "pending_review", JSON.stringify(c2));
  if (c2.ok) {
    const self = await decideCommittee({ committeeId: c2.id, decision: "approved", session: sess(ceo) });
    chk("ولا يعتمدها الرئيس نفسه", !self.ok);
    const byFounder = await decideCommittee({ committeeId: c2.id, decision: "approved", session: sess(founder) });
    chk("ويعتمدها المؤسس", byFounder.ok, JSON.stringify(byFounder));
  }

  // ٤ — بغياب الرئيس التنفيذي تنتقل قيادةُ الإدارة العليا إلى المؤسس: فيقترح هو
  await prisma.user.update({ where: { id: ceo.id }, data: { isActive: false } });
  const aFounderAlone = await orgActor(sess(founder));
  chk("بغياب الرئيس: المؤسسُ يقترح لجان الإدارة العليا وتعرضها له صفحةُ الإنشاء",
    canProposeCommitteesOf(aFounderAlone, senior.id) && (await departmentsForCreation(aFounderAlone)).some((d) => d.id === senior!.id));
  await prisma.user.update({ where: { id: ceo.id }, data: { isActive: true } });

  // ٤ — الرفض لمن لا يملك، والحدود كما هي
  const byOps = await createCommittee(aOps, senior.id, input(`لجنة ${TAG} ٣`, s1.id, [s2.id]));
  chk("مسؤول التشغيل لا يُنشئ لجنة في الإدارة العليا", !byOps.ok);
  const byLead = await createCommittee(aLead, senior.id, input(`لجنة ${TAG} ٤`, s1.id, [s2.id]));
  chk("وقائد قسمٍ آخر لا يُنشئها", !byLead.ok);
  const ceoInMkt = await createCommittee(aCeo, marketing.id, input(`لجنة ${TAG} ٥`, outsider.id, [outsider.id]));
  chk("والرئيس لا يُنشئ لجنة في قسمٍ آخر (اقتراحها لقائده)", !ceoInMkt.ok);
  const foreign = await createCommittee(aCeo, senior.id, input(`لجنة ${TAG} ٦`, s1.id, [outsider.id]));
  chk("ولا يُضَمّ إلى لجنة الإدارة العليا عضوٌ من قسمٍ آخر", !foreign.ok && foreign.reason.includes("قسمٍ آخر"));
  const opsDecide = c2.ok ? await decideCommittee({ committeeId: c2.id, decision: "rejected", note: "x", session: sess(ops) }) : { ok: false as const, reason: "" };
  chk("ولا يقرّر مسؤول التشغيل في لجنة", !opsDecide.ok);

  // ٥ — الأدوار داخل اللجنة: القائد والعضو والإدارة
  if (c1.ok) {
    const leadActor = await orgActor({ user: { id: s1.id, role: "member", name: s1.fullName, email: s1.email } } as unknown as Session);
    const memberActor = await orgActor({ user: { id: s2.id, role: "member", name: s2.fullName, email: s2.email } } as unknown as Session);
    const row = await prisma.department.findUniqueOrThrow({ where: { id: c1.id }, select: { id: true, parentId: true, committeeStatus: true, leadMemberId: true, actingLeadUserId: true } });
    const leadRole = committeeRoleFor(leadActor, row, true);
    const memberRole = committeeRoleFor(memberActor, row, true);
    const ceoRole = committeeRoleFor(aCeo, row, false);
    chk("قائد اللجنة: يقودها ولا يملك هيكلها", leadRole.lead && !leadRole.manage);
    chk("والعضو: عضوٌ لا قائد ولا مدير", memberRole.member && !memberRole.lead && !memberRole.manage);
    chk("والرئيس التنفيذي: يملك هيكلها كما يملك قائدُ القسم هيكل لجان قسمه", ceoRole.manage && ceoRole.view);

    // ٦ — الخلافة: غياب القائد يُقيم قائماً بالقيادة
    await prisma.member.update({ where: { id: s1.id }, data: { isActive: false, terminatedAt: new Date(), exitReason: "فحص" } });
    await ensureCommitteeSuccession(c1.id, { reason: "فحص الخلافة", source: "automatic", byName: "فحص" });
    const after = await prisma.department.findUniqueOrThrow({ where: { id: c1.id }, select: { leadMemberId: true, actingLeadUserId: true } });
    chk("الخلافة: غاب القائد فقام بالقيادة الرئيسُ أو المؤسس", !!after.actingLeadUserId && [ceo.id, founder.id].includes(after.actingLeadUserId), JSON.stringify(after));
  }

  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  const total = checks.filter((x) => x.startsWith("✓") || x.startsWith("✗")).length;
  console.log(`\n${total - failed}/${total} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
