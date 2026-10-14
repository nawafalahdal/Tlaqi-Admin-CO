import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import {
  requestCommittee,
  decideCommittee,
  withdrawCommittee,
  canRequestCommitteeIn,
  canDecideCommittee,
  committeeLeadTitle,
  committeesOf,
  pendingCommittees,
  OPEN_DEPARTMENT_WHERE,
  MAX_COMMITTEE_DEPTH,
} from "@/lib/committees";
import { buildOrgChart } from "@/lib/orgChart";
import { createDepartment } from "@/lib/departments";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const STAMP = Date.now();

/** جلسةٌ مصغّرة — الدوالُّ تقرأ `role` و`departmentId` و`id` و`name` فقط */
function sess(role: string, departmentId: string | null, id: string, name = "اختبار"): Session {
  return { user: { id, role, departmentId, name } } as unknown as Session;
}

/** اللجان: قسمٌ داخل قسم، بلونٍ مميّز ومسمّى، يقترحه قائدُ القسم
 *  ويعتمده التنفيذي — ثم تدور الدائرةُ فيصير لها قائدٌ بلوحته.
 *
 *  والقاعدةُ التي يُثبتها هذا الاختبار أساساً: **الاقتراحُ ليس فتحاً.**
 *  فما لم يُعتمد لا يظهر في قائمةٍ ولا في الهيكل، ولا تُدعى له قيادة. */
(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive" } });

  const parent = await createDepartment({
    name: `قسم لجان ${STAMP}`,
    colorHex: "#C34900",
    createdByName: "اختبار",
  });
  const lead = await prisma.user.create({
    data: {
      fullName: "قائد قسم اللجان",
      email: `cmt-lead-${STAMP}@example.test`,
      passwordHash: "x",
      role: "department_admin",
      departmentId: parent.id,
    },
  });
  const leadSess = sess("department_admin", parent.id, lead.id, lead.fullName);
  const created: string[] = [];

  // ── ١) التصريح: لقائد القسم نفسه، ومن يعلوه
  chk("قائدُ القسم يقترح في قسمه", canRequestCommitteeIn(leadSess, parent.id));
  chk(
    "ولا يقترح في قسمٍ غيره",
    canRequestCommitteeIn(leadSess, "قسم-آخر") === false
  );
  chk("والمؤسس والتنفيذي يملكانه", canRequestCommitteeIn(sess("executive", null, exec.id), parent.id));
  chk("والاعتماد للتنفيذي", canDecideCommittee("executive"));
  chk("ومعه المؤسس", canDecideCommittee("super_admin"));
  chk("ولا يملكه قائدُ القسم", canDecideCommittee("department_admin") === false);

  const foreign = await requestCommittee({
    parentId: parent.id,
    name: `لجنة دخيلة ${STAMP}`,
    colorHex: "#1F6F8B",
    session: sess("department_admin", "قسم-آخر", "ghost"),
  });
  chk("ويُفرَض في الخادم لا بإخفاء زرّ", foreign.ok === false,
      foreign.ok === false ? foreign.reason : "مرّ!");

  // ── ٢) اللون لا بدّ أن يميّزها
  const sameAsParent = await requestCommittee({
    parentId: parent.id,
    name: `لجنة بلون أبيها ${STAMP}`,
    colorHex: "#c34900",
    session: leadSess,
  });
  chk("لونُ الأب يُرفَض — ولو بحروفٍ صغيرة", sameAsParent.ok === false,
      sameAsParent.ok === false ? sameAsParent.reason : "مرّ!");

  // ── ٣) الاقتراح يُنشئ صفّاً ساكناً: لا بنك أسئلة، ولا ظهور
  const dev = await requestCommittee({
    parentId: parent.id,
    name: `التطوير ${STAMP}`,
    colorHex: "#1F6F8B",
    leadTitle: `مسؤول لجنة التطوير`,
    session: leadSess,
  });
  chk("الاقتراح يُقبل من قائد القسم", dev.ok, dev.ok ? "" : dev.reason);
  if (!dev.ok) {
    console.log(log.join("\n"));
    process.exit(1);
  }
  created.push(dev.id);

  const row = await prisma.department.findUniqueOrThrow({ where: { id: dev.id } });
  chk("حالتُها: بانتظار الاعتماد", row.committeeStatus === "pending_review", String(row.committeeStatus));
  chk("وأبوها مسجَّل", row.parentId === parent.id);
  chk("ومسمّى قائدها محفوظ", committeeLeadTitle(row.name, row.leadTitle) === "مسؤول لجنة التطوير");
  chk("ومقترِحُها منسوبٌ باسمه", row.requestedByName === lead.fullName, String(row.requestedByName));
  chk(
    "ولا بنكَ أسئلةٍ قبل الفتح",
    (await prisma.testTrack.count({ where: { departmentId: dev.id } })) === 0
  );

  const openNow = await prisma.department.findMany({
    where: { ...OPEN_DEPARTMENT_WHERE, id: dev.id },
  });
  chk("ولا تظهر في قوائم الأقسام المفتوحة", openNow.length === 0);

  const chartBefore = await buildOrgChart();
  const inChartBefore = JSON.stringify(chartBefore).includes(dev.id);
  chk("ولا تدخل الهيكل أصلاً", inChartBefore === false);

  chk(
    "وتظهر في طابور التنفيذي",
    (await pendingCommittees()).some((p) => p.id === dev.id)
  );
  chk(
    "وفي لوحة قائد قسمها — هو من اقترحها",
    (await committeesOf(parent.id)).some((c) => c.id === dev.id)
  );

  // ── ٤) لونُ أختها يُرفَض كذلك
  const sameAsSibling = await requestCommittee({
    parentId: parent.id,
    name: `لجنة ثانية ${STAMP}`,
    colorHex: "#1F6F8B",
    session: leadSess,
  });
  chk("لونُ لجنةٍ أختٍ يُرفَض", sameAsSibling.ok === false,
      sameAsSibling.ok === false ? sameAsSibling.reason : "مرّ!");

  // ── ٥) لا تُفرَّع لجنةٌ قبل أن تُفتح
  const prematureChild = await requestCommittee({
    parentId: dev.id,
    name: `فرعٌ قبل الفتح ${STAMP}`,
    colorHex: "#7A4EAB",
    session: sess("executive", null, exec.id),
  });
  chk("ولا تُفرَّع لجنةٌ لم تُعتمد", prematureChild.ok === false,
      prematureChild.ok === false ? prematureChild.reason : "مرّ!");

  // ── ٦) الردُّ لا يقع بلا سبب، والاعتماد ليس بيد غير أهله
  const noNote = await decideCommittee({
    committeeId: dev.id,
    decision: "rejected",
    note: "   ",
    session: sess("executive", null, exec.id),
  });
  chk("الردُّ بلا سببٍ مكتوب يُرفَض", noNote.ok === false,
      noNote.ok === false ? noNote.reason : "مرّ!");

  const byLead = await decideCommittee({
    committeeId: dev.id,
    decision: "approved",
    session: leadSess,
  });
  chk("وقائدُ القسم لا يعتمد لجنتَه بنفسه", byLead.ok === false,
      byLead.ok === false ? byLead.reason : "مرّ!");

  // ── ٧) الاعتماد يفتحها: بنكٌ، وظهورٌ، وهيكل
  const approved = await decideCommittee({
    committeeId: dev.id,
    decision: "approved",
    session: sess("executive", null, exec.id, exec.fullName),
  });
  chk("التنفيذي يعتمدها", approved.ok, approved.ok ? "" : approved.reason);
  chk(
    "فيُنشأ بنكُ أسئلتها حينه",
    (await prisma.testTrack.count({ where: { departmentId: dev.id } })) === 1
  );
  chk(
    "وتظهر في القوائم المفتوحة",
    (await prisma.department.findMany({ where: { ...OPEN_DEPARTMENT_WHERE, id: dev.id } })).length === 1
  );
  const decided = await prisma.department.findUniqueOrThrow({ where: { id: dev.id } });
  chk("والقرار منسوبٌ لصاحبه بتاريخه",
      decided.decidedByName === exec.fullName && decided.decidedAt !== null);

  // ── ٨) ولا يُقرَّر أمرُها مرّتين — الحرسُ في `where`
  const twice = await decideCommittee({
    committeeId: dev.id,
    decision: "rejected",
    note: "محاولةٌ متأخّرة",
    session: sess("super_admin", null, founder.id, founder.fullName),
  });
  chk("ولا يُنقَض قرارٌ وقع", twice.ok === false,
      twice.ok === false ? twice.reason : "مرّ!");

  // ── ٩) الهيكل: فرعٌ داخل أبيه لا قسمٌ بجانبه
  const chart = await buildOrgChart();
  const parentNode = chart.departments.find((d) => d.id === parent.id);
  chk("وأبوها جذرٌ في الهيكل", Boolean(parentNode));
  chk("واللجنةُ ليست قسماً بجانبه",
      chart.departments.some((d) => d.id === dev.id) === false);
  const nested = parentNode?.committees.find((c) => c.id === dev.id);
  chk("بل فرعٌ داخله", Boolean(nested));
  chk("ويُعلَم أنها لجنة", nested?.isCommittee === true);
  chk("بلونها هي لا بلون أبيها", nested?.colorHex === "#1F6F8B");
  chk("ومقعدُ قيادتها يُعلَن شاغراً باسمها",
      nested?.lead.kind === "vacant" &&
        nested.lead.title === `قائد لجنة ${decided.name}`,
      nested?.lead.kind === "vacant" ? nested.lead.title : "مملوء!");
  chk("وتُعَدّ لجنةً في العدّادات", chart.counts.committees >= 1, String(chart.counts.committees));
  chk(
    "ولجنةٌ بلا قائدٍ تمنع النسخة الرسمية — بالاسم لا بالإبهام",
    chart.readiness.blockers.some((b) => b.includes(decided.name) && b.includes("بلا قائد")),
    chart.readiness.blockers.join(" | ").slice(0, 160)
  );

  // ── ١٠) الدائرةُ تدور: لجنةٌ داخل لجنةٍ معتمدة — إلى حدٍّ مكتوب
  const sub = await requestCommittee({
    parentId: dev.id,
    name: `لجنة فرعية ${STAMP}`,
    colorHex: "#7A4EAB",
    session: sess("executive", null, exec.id, exec.fullName),
  });
  chk("لجنةٌ داخل لجنةٍ معتمدة تُقبل", sub.ok, sub.ok ? "" : sub.reason);
  if (sub.ok) {
    created.push(sub.id);
    await decideCommittee({
      committeeId: sub.id,
      decision: "approved",
      session: sess("executive", null, exec.id, exec.fullName),
    });
    const deep = await requestCommittee({
      parentId: sub.id,
      name: `طبقة رابعة ${STAMP}`,
      colorHex: "#0F766E",
      session: sess("executive", null, exec.id, exec.fullName),
    });
    chk(`وما بعد ${MAX_COMMITTEE_DEPTH} مستويَين يُمنَع بحدٍّ يُسمّى`, deep.ok === false,
        deep.ok === false ? deep.reason : "مرّ!");

    const chart2 = await buildOrgChart();
    const lvl1 = chart2.departments.find((d) => d.id === parent.id)?.committees.find((c) => c.id === dev.id);
    chk("والفرعُ الفرعيُّ يُرسَم في عمقه", lvl1?.committees.some((c) => c.id === sub.id) === true);
  }

  // ── ١١) السحبُ للساكن وحده
  const liveWithdraw = await withdrawCommittee({
    committeeId: dev.id,
    session: sess("executive", null, exec.id, exec.fullName),
  });
  chk("ولا تُسحَب لجنةٌ مفتوحة من هنا", liveWithdraw.ok === false,
      liveWithdraw.ok === false ? liveWithdraw.reason : "مرّ!");

  const spare = await requestCommittee({
    parentId: parent.id,
    name: `لجنة تُسحَب ${STAMP}`,
    colorHex: "#B38B2D",
    session: leadSess,
  });
  if (spare.ok) {
    const pulled = await withdrawCommittee({ committeeId: spare.id, session: leadSess });
    chk("والمقترحةُ يسحبها مقترِحُها", pulled.ok, pulled.ok ? "" : pulled.reason);
    chk("ولا يبقى لها صفّ",
        (await prisma.department.findUnique({ where: { id: spare.id } })) === null);
  } else {
    chk("والمقترحةُ يسحبها مقترِحُها", false, spare.reason);
  }

  // ── تنظيف: الأعمقُ أولاً — الأبُ مقيَّدٌ بفرعه (Restrict) عن قصد
  await prisma.user.delete({ where: { id: lead.id } });
  for (const id of created.reverse()) {
    await prisma.testTrack.deleteMany({ where: { departmentId: id } });
    await prisma.department.deleteMany({ where: { id } });
  }
  await prisma.testTrack.deleteMany({ where: { departmentId: parent.id } });
  await prisma.department.deleteMany({ where: { id: parent.id } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
