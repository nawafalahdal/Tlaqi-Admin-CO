import { prisma } from "@/lib/prisma";
import { buildOrgChart, needsOutline, outlineFor, departmentDisplayColor } from "@/lib/orgChart";
import { createDepartment, assignMemberDepartment } from "@/lib/departments";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}
const STAMP = Date.now();
const F = { actorRole: "super_admin", actorName: "المؤسس" };

/** الهيكل التنظيمي — يتحدّث وحده، ولا يُحرَّر.
 *
 *  والدعوى التي يُثبتها هذا الاختبار: **لا يُضاف أحدٌ في مكانين.**
 *  يُعتمد عضوٌ فيظهر، ويُصنَّف فينتقل، ويُنهى فيختفي — بلا لمس الهيكل. */
(async () => {
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  // ── ١) لا دالّة تُحرّر الهيكل — وهذا الحرس الحقيقي
  const orgModule = await import("@/lib/orgChart");
  const writers = Object.keys(orgModule).filter((k) =>
    /move|reorder|setParent|update|save|create|delete/i.test(k)
  );
  chk("**لا دالّة تُحرّك بطاقةً أو تُعيد ترتيباً**", writers.length === 0, writers.join(", ") || "صفر");

  // ── ٢) الشاغر يُعلَن شاغراً ولا يُسنَد
  const base = await buildOrgChart();
  chk("الهيكل يُبنى", base.counts.people > 0, `${base.counts.people} أشخاص`);
  const vacant = [base.founder, base.ceo, ...base.underCeo, ...base.departments.map((d) => d.lead)]
    .filter((s) => s.kind === "vacant");
  chk("والمقاعد الشاغرة تُعلَن ولا تُملأ ببديل",
      vacant.every((v) => v.kind === "vacant" && v.title.length > 0),
      `${vacant.length} شاغر`);

  // ── ٣) قسمٌ جديد يُفتَح له فرعٌ تلقائياً
  const before = base.departments.length;
  const dept = await createDepartment({
    name: `قسم الهيكل ${STAMP}`, colorHex: "#4C6EF5", createdByName: "اختبار",
  });
  const afterDept = await buildOrgChart();
  chk("**القسم الجديد يظهر فرعاً بلا لمس الهيكل**",
      afterDept.departments.length === before + 1,
      `${before} → ${afterDept.departments.length}`);
  const branch = afterDept.departments.find((d) => d.id === dept.id);
  chk("وقائدُه يُعلَن شاغراً", branch?.lead.kind === "vacant");
  chk("ولونُه المسجَّل يُستعمَل بلا تعديلٍ في الكود",
      branch?.displayColor === "#4C6EF5", branch?.displayColor);

  // ── ٤) عضوٌ معتمد يظهر، وتصنيفُه يَنقله
  const inv = await prisma.invite.create({
    data: { fullName: "عضو الهيكل", email: `org-${STAMP}@example.test`,
            targetRole: "member", testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  const m = await prisma.member.create({
    data: { fullName: "عضو الهيكل", email: `org-${STAMP}@example.test`, inviteId: inv.id,
            jobTitle: "مُحلّل", approvalStatus: "approved", isActive: true },
  });
  const unassigned = await buildOrgChart();
  chk("المعتمد بلا قسم يظهر في «غير المصنّفين»",
      unassigned.unassigned.some((p) => p.id === m.id));
  chk("وبطاقتُه تحمل مسمّاه", unassigned.unassigned.find((p) => p.id === m.id)?.title === "مُحلّل");

  await assignMemberDepartment({ memberId: m.id, departmentId: dept.id, ...F });
  const assigned = await buildOrgChart();
  chk("**وتصنيفُه يَنقله إلى فرع قسمه تلقائياً**",
      assigned.departments.find((d) => d.id === dept.id)?.members.some((p) => p.id === m.id) === true);
  chk("ولا يبقى في «غير المصنّفين»",
      assigned.unassigned.every((p) => p.id !== m.id));

  // ── ٥) وإنهاء عضويته يُخرجه
  await prisma.member.update({ where: { id: m.id }, data: { isActive: false } });
  const gone = await buildOrgChart();
  chk("**وإنهاء عضويته يُخرجه تلقائياً**",
      gone.departments.find((d) => d.id === dept.id)?.members.every((p) => p.id !== m.id) === true);

  // ── ٦) البطاقة لا تحمل بريداً ولا جوّالاً
  const sample = [...gone.unassigned, ...gone.departments.flatMap((d) => d.members)][0]
    ?? (gone.founder.kind === "filled" ? gone.founder.person : null);
  if (sample) {
    const keys = Object.keys(sample).sort().join(",");
    chk("**البطاقة أربعة حقول فقط — بلا بريد ولا جوّال**",
        keys === "avatarData,fullName,id,scope,title", keys);
  }

  // ── ٧) المرقَّى لا يُعرَض مرّتين
  const leadEmails = new Set(
    (await prisma.user.findMany({ where: { isActive: true }, select: { email: true } }))
      .map((u) => u.email.toLowerCase())
  );
  const twinsShown = await prisma.member.findMany({
    where: { isActive: true, approvalStatus: "approved",
             email: { in: [...leadEmails] } },
    select: { id: true },
  });
  const shownIds = new Set([
    ...gone.unassigned.map((p) => p.id),
    ...gone.departments.flatMap((d) => d.members.map((p) => p.id)),
  ]);
  chk("**ومن له حسابٌ قياديٌّ لا يُعرَض عضواً أيضاً**",
      twinsShown.every((t) => !shownIds.has(t.id)),
      `${twinsShown.length} توأماً مطروحاً`);

  // ── ٨) الألوان الفاتحة تأخذ حدّاً يُرى
  chk("الأبيض يُرصَد لوناً لا يُرى", needsOutline("#FFFFFF") === true);
  chk("ويأخذ حدّاً داكناً", outlineFor("#FFFFFF") !== "#FFFFFF", outlineFor("#FFFFFF"));
  chk("والبرتقالي يبقى بلونه", outlineFor("#C34900") === "#C34900");
  chk("والموارد البشرية لونُها أبيضُ الهوية",
      departmentDisplayColor("الموارد البشرية", "#000000") === "#FFFFFF");
  chk("والإدارة العليا بنفسجيُّها الداكن",
      departmentDisplayColor("الإدارة العليا", "#000000") === "#1A0E1C");

  // تنظيف
  await prisma.member.deleteMany({ where: { id: m.id } });
  await prisma.invite.deleteMany({ where: { id: inv.id } });
  await prisma.testTrack.deleteMany({ where: { departmentId: dept.id } });
  await prisma.department.deleteMany({ where: { id: dept.id } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
