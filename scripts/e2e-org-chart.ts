import { prisma } from "@/lib/prisma";
import {
  buildOrgChart,
  needsOutline,
  outlineFor,
  departmentDisplayColor,
  MIN_DEPARTMENT_MEMBERS,
} from "@/lib/orgChart";
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
    chk("**البطاقة خمسةُ حقولٍ فقط — بلا بريد ولا جوّال**",
        keys === "avatarUrl,fullName,id,scope,title", keys);
    // والصورةُ رابطٌ لا بيانات: كانت data URL تُدمَج في الصفحة فبلغت
    // صفحةُ الهيكل ٣١٩٩ ك.ب منها ٢٤٥٧ ك.ب وثيقةٌ واحدة. فالحقلُ الآن
    // مسارٌ يُخزَّن في المتصفّح — وهذا الفحصُ يَمنع عودةَ الدمج.
    chk("**وصورتُه رابطٌ يُخزَّن لا بياناتٌ تُدمَج في الصفحة**",
        sample.avatarUrl === null ||
          (sample.avatarUrl.startsWith("/api/avatar/") && !sample.avatarUrl.startsWith("data:")),
        String(sample.avatarUrl));
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

  // ── الإدارة العليا تُرفَع إلى الأعلى ولا تُكرَّر بين الأقسام
  const senior = await prisma.department.findFirst({ where: { leadershipOnly: true } });
  const temporarySenior = senior
    ? null
    : await prisma.department.create({
        data: {
          name: `إدارة عليا اختبار ${STAMP}`, slug: `senior-chart-${STAMP}`,
          colorHex: "#1A0E1C", leadershipOnly: true,
        },
      });
  const withSenior = await buildOrgChart();
  chk("**الإدارة العليا تُقرأ في الأعلى لا بين الأقسام**", withSenior.senior !== null,
      withSenior.senior?.name ?? "لا قسم استثنائي");
  chk("**ولا تُكرَّر في فروع العمل**",
      withSenior.departments.every((d) => !d.leadershipOnly),
      withSenior.departments.map((d) => d.name).join("، "));
  chk("وعدُّ الأقسام يَعدّ الفروع لا الطبقة العليا",
      withSenior.counts.departments === withSenior.departments.length,
      String(withSenior.counts.departments));

  // ── اكتمالُ الهيكل: شرطُ النسخة الرسمية
  const r = withSenior.readiness;
  chk("قياسُ الاكتمال محسوبٌ في المحرّك لا في الواجهة", typeof r.ready === "boolean");
  chk("**والمانعُ يُسمّى بعينه لا يُقال «غير مكتمل»**",
      r.ready || r.blockers.every((b) => b.trim().length > 5),
      r.blockers.slice(0, 2).join(" | ") || "مكتمل");

  // قسمٌ بقائدٍ وعضوٍ واحد: ليس فريقاً — فيُمنَع التنزيل ويُسمّى سببُه
  const thin = await createDepartment({
    name: `قسم ناقص ${STAMP}`, colorHex: "#67C090", createdByName: "اختبار",
  });
  const thinTrack = await prisma.testTrack.findFirstOrThrow({ where: { departmentId: thin.id } });
  const thinInvite = await prisma.invite.create({
    data: {
      fullName: "عضو وحيد", email: `thin-${STAMP}@example.test`, targetRole: "member",
      testTrackId: thinTrack.id, invitedById: founder.id, status: "used", departmentId: thin.id,
    },
  });
  const thinMember = await prisma.member.create({
    data: {
      fullName: "عضو وحيد", email: `thin-${STAMP}@example.test`, inviteId: thinInvite.id,
      departmentId: thin.id, approvalStatus: "approved", isActive: true,
    },
  });
  const afterThin = await buildOrgChart();
  chk("**قسمٌ بعضوٍ واحد يمنع النسخة الرسمية**", afterThin.readiness.ready === false);
  chk(`ويُقال إنه ١ من ${MIN_DEPARTMENT_MEMBERS}`,
      afterThin.readiness.blockers.some(
        (b) => b.includes(thin.name) && b.includes(String(MIN_DEPARTMENT_MEMBERS))
      ),
      afterThin.readiness.blockers.filter((b) => b.includes(thin.name)).join(" | ") || "لا مانع باسمه");

  await prisma.member.delete({ where: { id: thinMember.id } });
  await prisma.invite.delete({ where: { id: thinInvite.id } });
  await prisma.testTrack.deleteMany({ where: { departmentId: thin.id } });
  await prisma.department.delete({ where: { id: thin.id } });
  if (temporarySenior) {
    await prisma.testTrack.deleteMany({ where: { departmentId: temporarySenior.id } });
    await prisma.department.delete({ where: { id: temporarySenior.id } });
  }

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
