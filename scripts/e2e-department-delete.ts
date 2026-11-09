import { prisma } from "@/lib/prisma";
import { departmentDeletionPlan, deleteDepartment, canDeleteDepartment, createDepartment } from "@/lib/departments";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { createCandidateAccount } from "@/lib/workflow";

/** **حذفُ الأقسام** — للمؤسس وحده؛ يُحذف القسمُ حين يخلو إلا من قائده، ويُؤرشف إن كان له
 *  تاريخ فلا يُهدَر سجلّ؛ ويُرفض بسببٍ مسمّى إن بقي فيه أحدٌ أو عملٌ مفتوح.
 *
 *  **على نسخةٍ مؤقتة من القاعدة المحلية الاصطناعية** (الأرشفةُ تُغيّر اسم القسم):
 *    createdb -T tlaqi_mk tlaqi_dept_e2e
 *    DATABASE_URL=…/tlaqi_dept_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-department-delete.ts
 *    dropdb tlaqi_dept_e2e */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}
if (!/tlaqi_dept_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_dept_e2e وحدها — الأرشفة تُغيّر اسم القسم");
  process.exit(1);
}
const TAG = `e2e-dd-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const DAY = 86_400_000;

(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const track = await prisma.testTrack.findFirstOrThrow();
  const hr = await prisma.department.findFirstOrThrow({ where: { slug: "hr" } });
  const tech = await prisma.department.findFirstOrThrow({ where: { slug: "tech" } });
  let n = 0;
  const mkUser = (role: "department_admin" | "executive" | "operations_officer", departmentId: string | null) =>
    prisma.user.create({ data: { fullName: `${role} ${TAG}`, email: `${TAG}-${role}-${++n}@example.test`, passwordHash: "!", role, departmentId, isActive: true } });
  async function mkMember(departmentId: string, o: { approved?: boolean; terminated?: boolean; email?: string } = {}) {
    const email = o.email ?? `${TAG}-m${++n}@example.test`;
    const inv = await prisma.invite.create({ data: { fullName: "نموذج", email, targetRole: "member", departmentId, testTrackId: track.id, invitedById: founder.id, status: "used" } });
    return prisma.member.create({
      data: {
        fullName: `نموذج ${n}`, email, departmentId, inviteId: inv.id, passwordHash: "!", credentialsIssuedAt: new Date(),
        approvalStatus: o.approved === false ? "pending_review" : "approved", decidedAt: o.approved === false ? null : new Date(Date.now() - 30 * DAY),
        isActive: !o.terminated, ...(o.terminated ? { terminatedAt: new Date(), exitReason: "فحص" } : {}),
      },
    });
  }

  // ١ — الصلاحية: المؤسس وحده
  chk("الحذف للمؤسس وحده (التنفيذي والتشغيل والقائد والعضو لا)", canDeleteDepartment("super_admin") && !["executive", "operations_officer", "department_admin", "member"].some(canDeleteDepartment));
  for (const role of ["executive", "operations_officer", "department_admin"]) {
    const r = await deleteDepartment({ departmentId: hr.id, confirmName: hr.name, actorRole: role, actorName: "فحص" });
    chk(`الخادم يرفض حذف ${role}`, !r.ok && r.reason.includes("للمؤسس وحده"));
  }

  // ٢ — الموارد البشرية: قائدُها وحده + سجلٌّ تاريخيٌّ كامل
  const hrLead = await mkUser("department_admin", hr.id);
  await mkMember(hr.id, { email: hrLead.email }); // سجلُّ ترشّح القائد نفسه
  const oldMember = await mkMember(hr.id, { terminated: true });
  const sig = await prisma.leaderSignature.create({ data: { userId: hrLead.id, role: "department_admin", departmentId: hr.id, status: "approved", approvedAt: new Date() } });
  const closedTicket = await prisma.ticket.create({
    data: { subject: `${TAG} تذكرة مغلقة`, description: "فحص", targetDepartmentId: hr.id, raisedByUserId: founder.id, status: "resolved", resolvedAt: new Date(), stageDueAt: new Date() },
  });
  const objective = await prisma.departmentObjective.create({
    data: { departmentId: hr.id, title: `${TAG} هدف منجز`, status: "done", proposedByName: "فحص" },
  });

  const plan = await departmentDeletionPlan(hr.id);
  chk("خطة HR: لا مانع — القائد وحده لا يمنع الحذف", !!plan && plan.blockers.length === 0, JSON.stringify(plan?.blockers));
  chk("وتُؤرشف لأن لها سجلّاً (لا حذف نهائي يُهدر التاريخ)", plan?.mode === "archive" && (plan?.preserved.length ?? 0) > 0);
  chk("والقائد مسمّى في الخطة بمصيره", plan?.lead?.id === hrLead.id);

  const wrong = await deleteDepartment({ departmentId: hr.id, confirmName: "اسم خاطئ", actorRole: "super_admin", actorName: "المؤسس", actorId: founder.id });
  chk("الاسم المكتوب خطأً يُرفض ولا يُحذف شيء", !wrong.ok && (await prisma.department.findUniqueOrThrow({ where: { id: hr.id } })).committeeStatus === null);

  const done = await deleteDepartment({ departmentId: hr.id, confirmName: hr.name, actorRole: "super_admin", actorName: "المؤسس", actorId: founder.id });
  chk("المؤسس يحذف HR وقائدُها وحده فيها", done.ok && done.mode === "archive", JSON.stringify(done));
  const hrAfter = await prisma.department.findUniqueOrThrow({ where: { id: hr.id } });
  chk("HR مؤرشف ويُوسَم اسمه ومعرّفه", hrAfter.committeeStatus === "archived" && hrAfter.name.startsWith(`${hr.name} — مؤرشف`) && hrAfter.slug.startsWith("hr-archived-"));
  chk("ويغيب من الأقسام العاملة (القوائم والهيكل والدعوات)", (await prisma.department.count({ where: { id: hr.id, ...OPEN_DEPARTMENT_WHERE } })) === 0);
  const leadAfter = await prisma.user.findUniqueOrThrow({ where: { id: hrLead.id } });
  chk("قائدها: انتهت قيادته بسببٍ مكتوب", !leadAfter.isActive && !!leadAfter.removalReason?.includes("أُرشف"));
  chk("وأُبطلت جلساته", (await prisma.accessRevocation.count({ where: { accountId: hrLead.id, reason: "أرشفة القسم" } })) === 1);
  chk("وأُبطل توقيعه للمستقبل", (await prisma.leaderSignature.findUniqueOrThrow({ where: { id: sig.id } })).status === "superseded");
  chk("السجلات التاريخية باقية تُشير إليه (عضو سابق، دعوات)", (await prisma.member.findUniqueOrThrow({ where: { id: oldMember.id } })).departmentId === hr.id && (await prisma.invite.count({ where: { departmentId: hr.id } })) >= 2);
  chk("والتذكرة المغلقة والهدف المنجز لم يُحذفا", (!closedTicket || (await prisma.ticket.count({ where: { id: closedTicket.id, targetDepartmentId: hr.id } })) === 1) && (!objective || (await prisma.departmentObjective.count({ where: { id: objective.id } })) === 1));
  chk("وسُجّل القرار في سجل الحوكمة", (await prisma.orgAuditEvent.count({ where: { entityId: hr.id, action: "department.archived" } })) === 1);
  const again = await deleteDepartment({ departmentId: hr.id, confirmName: hrAfter.name, actorRole: "super_admin", actorName: "المؤسس" });
  chk("ولا يُؤرشف مرّتين", !again.ok);
  const tryInvite = await createCandidateAccount({ fullName: "مدعو", email: `${TAG}-inv@example.test`, targetRole: "member", departmentId: hr.id, testTrackId: track.id, invitedById: founder.id }).then(() => "created").catch((e: Error) => e.message);
  chk("ولا يُدعى إليه أحد بعد أرشفته", tryInvite !== "created");
  const recreated = await createDepartment({ name: hr.name, colorHex: "#EEF6DF", createdByName: "المؤسس" } as never).then(() => true).catch(() => false);
  chk("واسمُه الأصلي تحرّر: يُنشأ قسمٌ جديد بالاسم نفسه إن شاء المؤسس", recreated);

  // ٣ — التقنية: قائدٌ وعضوٌ نشط → يُرفض بسببٍ واضح
  const techLead = await mkUser("department_admin", tech.id);
  const active = await mkMember(tech.id);
  const blocked = await deleteDepartment({ departmentId: tech.id, confirmName: tech.name, actorRole: "super_admin", actorName: "المؤسس", actorId: founder.id });
  chk("قسمٌ فيه عضوٌ نشط غير القائد يُرفض", !blocked.ok && blocked.reason.includes("عضو نشط"), JSON.stringify(blocked));
  chk("ولا يتغيّر شيء (القسم والقائد)", (await prisma.department.findUniqueOrThrow({ where: { id: tech.id } })).committeeStatus === null && (await prisma.user.findUniqueOrThrow({ where: { id: techLead.id } })).isActive);
  const pending = await mkMember(tech.id, { approved: false });
  const planTech = await departmentDeletionPlan(tech.id);
  chk("والمرشّح قيد الانضمام يُسمّى مانعاً", !!planTech?.blockers.some((b) => b.includes("مرشّح")));
  const openTicket = await prisma.ticket.create({ data: { subject: `${TAG} مفتوحة`, description: "فحص", targetDepartmentId: tech.id, raisedByUserId: founder.id, status: "open", stageDueAt: new Date(Date.now() + 2 * DAY) } });
  if (openTicket) chk("والتذكرة المفتوحة تُسمّى مانعاً", !!(await departmentDeletionPlan(tech.id))?.blockers.some((b) => b.includes("تذكرة مفتوحة")));
  // بعد إنهاء العضوية وإغلاق التذكرة: يُحذف (يُؤرشف) بالشروط نفسها
  await prisma.member.updateMany({ where: { id: { in: [active.id, pending.id] } }, data: { isActive: false, terminatedAt: new Date(), exitReason: "فحص" } });
  if (openTicket) await prisma.ticket.update({ where: { id: openTicket.id }, data: { status: "resolved", resolvedAt: new Date() } });
  const techDone = await deleteDepartment({ departmentId: tech.id, confirmName: tech.name, actorRole: "super_admin", actorName: "المؤسس", actorId: founder.id });
  chk("وبعد إفراغه يُحذف قسمٌ آخر بالشروط نفسها", techDone.ok && techDone.mode === "archive", JSON.stringify(techDone));

  // ٤ — قسمٌ جديدٌ بلا تاريخ ولا قائد: حذفٌ نهائي
  const fresh = await prisma.department.create({ data: { name: `قسم فحص ${TAG}`, slug: `${TAG}-fresh`, colorHex: "#67C090" } });
  await prisma.testTrack.create({ data: { scope: "department_member", departmentId: fresh.id } });
  const freshPlan = await departmentDeletionPlan(fresh.id);
  chk("قسمٌ بلا تاريخ: يُحذف نهائياً", freshPlan?.mode === "delete" && freshPlan.blockers.length === 0);
  const freshDone = await deleteDepartment({ departmentId: fresh.id, confirmName: fresh.name, actorRole: "super_admin", actorName: "المؤسس" });
  chk("وزال صفُّه وبنكُ أسئلته", freshDone.ok && freshDone.mode === "delete" && (await prisma.department.count({ where: { id: fresh.id } })) === 0 && (await prisma.testTrack.count({ where: { departmentId: fresh.id } })) === 0);

  // ٥ — الإدارة العليا لا تُحذف وأهلُها فيها
  let senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
  if (!senior) {
    // القاعدةُ الاصطناعية بلا إدارةٍ عليا: تُنشأ بالمسار نفسه الذي يُنشئها في المنصة
    await createDepartment({ name: `الإدارة العليا ${TAG}`, colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
    senior = await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } });
  }
  if (senior) {
    const ceo = await mkUser("executive", null);
    const sp = await departmentDeletionPlan(senior.id);
    chk("الإدارة العليا: يُسمّى أهلها مانعاً", !!sp?.blockers.some((b) => b.includes("الإدارة العليا")));
    await prisma.user.update({ where: { id: ceo.id }, data: { isActive: false } });
  } else {
    checks.push("… لا قسم إدارة عليا في القاعدة المحلية — تُخطّى");
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
