import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import {
  canManagePlans,
  savePlanIntro,
  addPlanDoc,
  movePlanDoc,
  renamePlanDoc,
  removePlanDoc,
  planDocFile,
  readPlanLibrary,
  planCounts,
  MAX_PLAN_FILE_BYTES,
} from "@/lib/plans";
import { alertsForUser } from "@/lib/alerts";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}
const STAMP = Date.now();

function sess(role: string, id: string, name = "اختبار"): Session {
  return { user: { id, role, name, departmentId: null } } as unknown as Session;
}

/** مركزُ الخطط: نبذةٌ للجميع، وملفّاتٌ مرتَّبةٌ يرفعها المؤسس والتنفيذي.
 *
 *  والقاعدةُ التي يُثبتها هذا الاختبار أساساً: **القراءةُ للجميع
 *  والكتابةُ لاثنين** — ومعها حدودُ الملف ونوعُه وبروتوكولُ الرابط،
 *  وأن الترتيب مبادلةٌ لا إعادةُ رفع. */
(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive" } });
  const lead = await prisma.user.findFirst({ where: { role: "department_admin", isActive: true } });

  const F = sess("super_admin", founder.id, founder.fullName);
  const E = sess("executive", exec.id, exec.fullName);
  const L = sess("department_admin", lead?.id ?? "ghost", lead?.fullName ?? "قائد");
  const M = sess("member", "member-ghost");

  const made: string[] = [];

  // ── ١) الصلاحية: الكتابةُ لاثنين لا لغيرهما
  chk("المؤسس يكتب في المركز", canManagePlans("super_admin"));
  chk("والتنفيذي كذلك", canManagePlans("executive"));
  chk("ولا يكتب قائدُ قسم", canManagePlans("department_admin") === false);
  chk("ولا عضو", canManagePlans("member") === false);

  const byLead = await addPlanDoc({
    title: `وثيقة قائد ${STAMP}`,
    linkUrl: "https://example.com/x",
    session: L,
  });
  chk("ويُفرَض في الخادم لا بإخفاء زرّ", byLead.ok === false,
      byLead.ok === false ? byLead.reason : "مرّ!");

  const introByMember = await savePlanIntro({ heading: "x", intro: "y", session: M });
  chk("ولا يكتب العضوُ النبذة", introByMember.ok === false,
      introByMember.ok === false ? introByMember.reason : "مرّ!");

  // ── ٢) المادةُ الفارغة لا تُضاف، ولا تُجمَع بين ملفٍّ ورابط
  const empty = await addPlanDoc({ title: `فارغة ${STAMP}`, session: F });
  chk("لا تُضاف مادةٌ بلا ملفٍّ ولا رابط", empty.ok === false,
      empty.ok === false ? empty.reason : "مرّ!");

  const both = await addPlanDoc({
    title: `الاثنان ${STAMP}`,
    linkUrl: "https://example.com/a",
    file: { name: "a.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2, 3]) },
    session: F,
  });
  chk("ولا ملفٌّ ورابطٌ معاً", both.ok === false, both.ok === false ? both.reason : "مرّ!");

  // ── ٣) الرابطُ https وحده — و`javascript:` بابُ تنفيذٍ لا رابطٌ خاطئ
  for (const bad of ["javascript:alert(1)", "http://example.com/x", "ليس رابطاً"]) {
    const res = await addPlanDoc({ title: `رابط ${bad} ${STAMP}`, linkUrl: bad, session: F });
    chk(`يُرفَض الرابط «${bad.slice(0, 22)}»`, res.ok === false,
        res.ok === false ? res.reason : "مرّ!");
  }

  // ── ٤) النوعُ والحجم
  const badType = await addPlanDoc({
    title: `نوع مرفوض ${STAMP}`,
    file: { name: "x.svg", type: "image/svg+xml", bytes: new Uint8Array([1]) },
    session: F,
  });
  chk("يُرفَض SVG — سكربتٌ يُنفَّذ في أصل المنصة", badType.ok === false,
      badType.ok === false ? badType.reason.slice(0, 60) : "مرّ!");

  const tooBig = await addPlanDoc({
    title: `كبير ${STAMP}`,
    file: {
      name: "big.pdf",
      type: "application/pdf",
      bytes: new Uint8Array(MAX_PLAN_FILE_BYTES + 1024),
    },
    session: F,
  });
  chk("ويُرفَض ما تجاوز الحدّ — ويُسمّى حجمُه", tooBig.ok === false,
      tooBig.ok === false ? tooBig.reason.slice(0, 70) : "مرّ!");

  // ── ٥) الإضافةُ تُذيَّل آخرَ الترتيب
  const pdf = Buffer.from("%PDF-1.4\n% تجربة\n", "utf8");
  const first = await addPlanDoc({
    title: `خطة تَـــلاقِ ${STAMP}`,
    note: "الوثيقة الأمّ",
    file: { name: "plan.pdf", type: "application/pdf", bytes: new Uint8Array(pdf) },
    session: F,
  });
  chk("المؤسس يرفع ملفاً", first.ok, first.ok ? "" : first.reason);
  if (!first.ok) {
    console.log(log.join("\n"));
    process.exit(1);
  }
  made.push(first.id);

  const second = await addPlanDoc({
    title: `الأهداف ${STAMP}`,
    linkUrl: "https://tlaqiteam.site/goals",
    session: E,
  });
  chk("والتنفيذي يضيف رابطاً", second.ok, second.ok ? "" : second.reason);
  if (second.ok) made.push(second.id);

  const lib1 = await readPlanLibrary();
  const mine = lib1.docs.filter((d) => made.includes(d.id));
  chk("والمادتان مرتَّبتان بالإضافة", mine.length === 2 && mine[0].id === made[0],
      mine.map((d) => d.order).join(","));
  chk("ولا تُقرأ البايتاتُ في القائمة",
      Object.prototype.hasOwnProperty.call(mine[0], "data") === false);
  chk("والحجمُ والنوعُ محفوظان",
      mine[0].byteSize === pdf.byteLength && mine[0].mimeType === "application/pdf",
      String(mine[0].byteSize));

  // ── ٦) الترتيب مبادلةٌ لا إعادةُ رفع
  const moved = await movePlanDoc({ id: made[1], direction: "up", session: F });
  chk("التنزيلُ في الترتيب يُبدِّل الجارتين", moved.ok, moved.ok ? "" : moved.reason);
  const lib2 = await readPlanLibrary();
  const after = lib2.docs.filter((d) => made.includes(d.id));
  chk("فصارت الثانيةُ أولاً — والمعرّفان كما هما",
      after[0].id === made[1] && after[1].id === made[0],
      after.map((d) => `${d.order}`).join(","));

  const byMember = await movePlanDoc({ id: made[0], direction: "up", session: M });
  chk("ولا يُرتّب عضوٌ شيئاً", byMember.ok === false,
      byMember.ok === false ? byMember.reason : "مرّ!");

  // ── ٧) التنزيل يقرأ البايتات كما رُفعت
  const fileOut = await planDocFile(made[0]);
  chk("والملفُّ يُقرأ كما رُفع بايتاً ببايت",
      Boolean(fileOut) && Buffer.compare(fileOut!.bytes, pdf) === 0);
  chk("ويُفتَح في المتصفح لا يُنزَّل — PDF", fileOut?.inline === true);
  chk("والرابطُ ليس ملفاً يُنزَّل", (await planDocFile(made[1])) === null);

  // ── ٨) النبذة تُحفَظ وتُنسَب
  const intro = await savePlanIntro({
    heading: `خطط تَـــلاقِ ${STAMP}`,
    intro: "من نحن.\n\nلماذا وُجدنا.\n\nكيف نعمل.",
    session: F,
  });
  chk("النبذة تُحفَظ", intro.ok, intro.ok ? "" : intro.reason);
  const lib3 = await readPlanLibrary();
  chk("وتُقرأ منسوبةً لكاتبها بتاريخها",
      lib3.intro.includes("من نحن") && lib3.updatedByName === founder.fullName,
      String(lib3.updatedByName));

  // ── ٩) العدّان: الكلُّ والجديد
  const counts = await planCounts();
  chk("العدّادُ يَعدّ ولا يَجلب", counts.total >= 2 && counts.fresh >= 2,
      `${counts.total}/${counts.fresh}`);

  // ── ١٠) التنبيهات: الجديدُ يظهر في لوحة «ما ينتظرك»
  const alerts = await alertsForUser(F);
  chk("ووثائقُ الأسبوع تُذكَر في تنبيهات المؤسس",
      alerts.some((a) => a.id === "plans"),
      alerts.map((a) => a.id).join("، "));
  chk("وكلُّ تنبيهٍ له وجهةٌ تُفضي إلى موضع الحلّ",
      alerts.every((a) => a.href.startsWith("/") && a.cta.length > 0));

  // ── ١١) التسميةُ تُعدَّل، والحذفُ لمن يملكه
  const renamed = await renamePlanDoc({
    id: made[0],
    title: `خطة تَـــلاقِ (مُحدَّثة) ${STAMP}`,
    note: "نسخةٌ ثانية",
    session: E,
  });
  chk("التنفيذي يُعدّل العنوان", renamed.ok, renamed.ok ? "" : renamed.reason);
  const delByMember = await removePlanDoc({ id: made[0], session: M });
  chk("ولا يحذف عضوٌ مادةً", delByMember.ok === false,
      delByMember.ok === false ? delByMember.reason : "مرّ!");

  // ── تنظيف
  for (const id of made) await prisma.planDoc.deleteMany({ where: { id } });
  await prisma.planLibrary.deleteMany({ where: { id: "main" } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
