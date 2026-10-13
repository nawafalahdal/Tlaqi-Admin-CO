import { prisma } from "@/lib/prisma";
import {
  createDepartment,
  deleteDepartment,
  assignMemberDepartment,
  canDeleteDepartment,
} from "@/lib/departments";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const F = { actorRole: "super_admin", actorName: "المؤسس" };
const STAMP = Date.now();

/** حذف الأقسام وتصنيف غير المصنّف.
 *
 *  والقاعدة التي يُثبتها هذا الاختبار أساساً: **من صُنِّف لا يُعاد
 *  تصنيفه.** والحرس في `where` لا قبله، فيُختبَر بالكتابة لا بالقراءة. */
(async () => {
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  // ── ١) التصريح: الحذف للمؤسس وحده
  chk("الحذف للمؤسس وحده", canDeleteDepartment("super_admin") === true);
  chk("والتنفيذي لا يملكه", canDeleteDepartment("executive") === false);
  chk("ولا قائد القسم", canDeleteDepartment("department_admin") === false);

  const denied = await deleteDepartment({
    departmentId: "x", confirmName: "x", actorRole: "executive", actorName: "تنفيذي",
  });
  chk("ويُفرَض في الخادم لا بإخفاء زرّ", denied.ok === false,
      denied.ok === false ? denied.reason : "مرّ!");

  // ── ٢) قسمٌ فارغ يُحذف، وبالاسم مكتوباً
  const empty = await createDepartment({
    name: `قسم اختبار فارغ ${STAMP}`, colorHex: "#67C090", createdByName: "اختبار",
  });
  const wrongName = await deleteDepartment({
    departmentId: empty.id, confirmName: "اسم غلط", ...F });
  chk("اسمٌ خاطئ يمنع الحذف", wrongName.ok === false,
      wrongName.ok === false ? wrongName.reason : "حُذف!");
  chk("والقسم ما يزال قائماً",
      (await prisma.department.findUnique({ where: { id: empty.id } })) !== null);

  const trackBefore = await prisma.testTrack.count({ where: { departmentId: empty.id } });
  chk("أُنشئ معه بنك أسئلة", trackBefore === 1, String(trackBefore));

  const gone = await deleteDepartment({ departmentId: empty.id, confirmName: empty.name, ...F });
  chk("القسم الفارغ يُحذف", gone.ok, gone.ok ? "" : (gone as { reason: string }).reason);
  chk("ولم يبقَ له صفّ",
      (await prisma.department.findUnique({ where: { id: empty.id } })) === null);
  chk("وبنك أسئلته زال معه",
      (await prisma.testTrack.count({ where: { departmentId: empty.id } })) === 0);

  // ── ٣) قسمٌ يحمل عضواً لا يُحذف — ويُسمّى المانع بعدده
  const held = await createDepartment({
    name: `قسم اختبار مأهول ${STAMP}`, colorHex: "#C34900", createdByName: "اختبار",
  });
  const heldInvite = await prisma.invite.create({
    data: { fullName: "عضو في قسمٍ مأهول", email: `held-dept-${STAMP}@example.test`,
            departmentId: held.id, targetRole: "member", testTrackId: track.id,
            invitedById: founder.id, status: "used" },
  });
  const heldMember = await prisma.member.create({
    data: { fullName: "عضو في قسمٍ مأهول", email: `held-dept-${STAMP}@example.test`,
            inviteId: heldInvite.id, departmentId: held.id,
            approvalStatus: "approved", isActive: true },
  });

  const blocked = await deleteDepartment({ departmentId: held.id, confirmName: held.name, ...F });
  chk("القسم المأهول لا يُحذف", blocked.ok === false);
  chk("**والمانع يُسمّى بعدده**",
      blocked.ok === false && blocked.reason.includes("سجلّ عضوية") && blocked.reason.includes("دعوة"),
      blocked.ok === false ? blocked.reason : "");
  chk("ولم يُحذف عضوُه ليُفرَّغ القسم",
      (await prisma.member.findUnique({ where: { id: heldMember.id } })) !== null);

  // ── ٤) التصنيف: غير المصنّف يُصنَّف
  const freeInvite = await prisma.invite.create({
    data: { fullName: "عضو غير مصنّف", email: `unclassified-${STAMP}@example.test`,
            targetRole: "member", testTrackId: track.id,
            invitedById: founder.id, status: "used" },
  });
  const free = await prisma.member.create({
    data: { fullName: "عضو غير مصنّف", email: `unclassified-${STAMP}@example.test`,
            inviteId: freeInvite.id, approvalStatus: "approved", isActive: true },
  });
  chk("العضو غير مصنّف ابتداءً", free.departmentId === null);

  const notFounder = await assignMemberDepartment({
    memberId: free.id, departmentId: held.id,
    actorRole: "department_admin", actorName: "قائد",
  });
  chk("التصنيف للمؤسس وحده — ويُفرَض في الخادم", notFounder.ok === false,
      notFounder.ok === false ? notFounder.reason : "مرّ!");
  chk("ولم يُكتب شيء",
      (await prisma.member.findUniqueOrThrow({ where: { id: free.id } })).departmentId === null);

  const assigned = await assignMemberDepartment({
    memberId: free.id, departmentId: held.id, ...F });
  chk("المؤسس يصنّف غير المصنّف", assigned.ok,
      assigned.ok ? assigned.departmentName : (assigned as { reason: string }).reason);
  const afterAssign = await prisma.member.findUniqueOrThrow({ where: { id: free.id } });
  chk("وصار في القسم فعلاً", afterAssign.departmentId === held.id);

  // ── ٥) **ومن صُنِّف لا يُعاد تصنيفه** — وهو شرط المؤسس
  const other = await createDepartment({
    name: `قسم اختبار آخر ${STAMP}`, colorHex: "#341D2B", createdByName: "اختبار",
  });
  const reassign = await assignMemberDepartment({
    memberId: free.id, departmentId: other.id, ...F });
  chk("**المصنّف لا يُعاد تصنيفه**", reassign.ok === false,
      reassign.ok === false ? reassign.reason : "أُعيد تصنيفه!");
  const afterReassign = await prisma.member.findUniqueOrThrow({ where: { id: free.id } });
  chk("وقسمُه لم يتبدّل", afterReassign.departmentId === held.id);
  chk("والرفض يُسمّي قسمَه الحالي",
      reassign.ok === false && reassign.reason.includes(held.name),
      reassign.ok === false ? reassign.reason : "");

  // ── ٦) ولا يُصنَّف في قسمٍ غير موجود
  const ghost = await prisma.member.create({
    data: { fullName: "عضو آخر غير مصنّف", email: `unclassified2-${STAMP}@example.test`,
            inviteId: (await prisma.invite.create({
              data: { fullName: "عضو آخر", email: `unclassified2-${STAMP}@example.test`,
                      targetRole: "member", testTrackId: track.id,
                      invitedById: founder.id, status: "used" } })).id,
            approvalStatus: "approved", isActive: true },
  });
  const noDept = await assignMemberDepartment({
    memberId: ghost.id, departmentId: "لا-قسم-بهذا-المعرّف", ...F });
  chk("ولا يُصنَّف في قسمٍ غير موجود", noDept.ok === false,
      noDept.ok === false ? noDept.reason : "مرّ!");

  // ── تنظيف
  await prisma.member.deleteMany({ where: { id: { in: [heldMember.id, free.id, ghost.id] } } });
  await prisma.invite.deleteMany({
    where: { email: { in: [`held-dept-${STAMP}@example.test`, `unclassified-${STAMP}@example.test`,
                           `unclassified2-${STAMP}@example.test`] } } });
  for (const d of [held.id, other.id]) {
    await prisma.testTrack.deleteMany({ where: { departmentId: d } });
    await prisma.department.deleteMany({ where: { id: d } });
  }

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
