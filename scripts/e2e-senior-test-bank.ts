import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { createDepartment } from "@/lib/departments";
import { canEditDepartmentTrack, canEditTrack, ensureMemberTrack } from "@/lib/testTracks";
import { isSeniorLeader, reconcileSeniorLeadership } from "@/lib/governance/leadership";

/** **بنكُ أسئلة أعضاء الإدارة العليا يملكه قائدُها** — الرئيسُ التنفيذي، أو المؤسسُ بالخلافة.
 *
 *  الخطأ (نوفمبر 2026): صفحةُ اختبار القسم تسأل عن «قائد القسم» وحده، والإدارةُ العليا لا قائدَ قسمٍ لها —
 *  فرُدَّ الرئيسُ التنفيذي عن اختبار أعضاء إدارته، ولم يكن للإدارة العليا بنكٌ أصلاً.
 *  يُشغَّل على نسخةٍ مؤقتة محلية وحدها. */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_seniorbank_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_seniorbank_e2e وحدها");
  process.exit(1);
}
const TAG = `e2e-stb-${Date.now()}`;
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
  const marketing = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  // رئيسٌ تنفيذيٌّ نشطٌ واحد (قيدٌ في القاعدة): يُعطَّل القائمُ إن وُجد ويُعاد في الختام
  const priorCeos = await prisma.user.findMany({ where: { role: "executive", isActive: true }, select: { id: true } });
  await prisma.user.updateMany({ where: { id: { in: priorCeos.map((c) => c.id) } }, data: { isActive: false } });
  let n = 0;
  const mkUser = (role: "executive" | "operations_officer" | "department_admin", departmentId: string | null) =>
    prisma.user.create({ data: { fullName: `${role} ${TAG}`, email: `${TAG}-${role}-${++n}@example.test`, passwordHash: "!", role, departmentId, isActive: true } });
  const ceo = await mkUser("executive", null);
  const ops = await mkUser("operations_officer", null);
  const mktLead = await mkUser("department_admin", marketing.id);
  await reconcileSeniorLeadership("فحص: رئيسٌ تنفيذيٌّ نشط");

  try {
    chk("الرئيسُ التنفيذي النشط قائدُ الإدارة العليا", await isSeniorLeader({ kind: "user", id: ceo.id }));
    // ── الخطأ نفسه: صفحةُ اختبار الإدارة العليا للرئيس التنفيذي
    chk("الرئيسُ التنفيذي يعدّل اختبار أعضاء الإدارة العليا", await canEditDepartmentTrack(sess(ceo), senior));
    chk("المؤسسُ لا يعدّله والرئيسُ التنفيذي نشط (القائدُ يملكه)", !(await canEditDepartmentTrack(sess(founder), senior)));
    chk("مسؤولُ التشغيل لا يعدّله", !(await canEditDepartmentTrack(sess(ops), senior)));
    chk("قائدُ قسمٍ آخر لا يعدّله", !(await canEditDepartmentTrack(sess(mktLead), senior)));
    chk("عضوٌ لا يعدّله", !(await canEditDepartmentTrack(sess({ id: "m", role: "member", fullName: "عضو", departmentId: senior.id }), senior)));
    // ── لا تراجع: قائدُ القسم يملك بنكَ قسمه وحده، والرئيسُ التنفيذي لا يدخل بنكَ قسمٍ عادي من صفحته
    chk("قائدُ التسويق يعدّل بنكَ قسمه", await canEditDepartmentTrack(sess(mktLead), marketing));
    chk("الرئيسُ التنفيذي لا يدخل صفحةَ بنك قسمٍ عادي (ملكُ قائده)", !(await canEditDepartmentTrack(sess(ceo), marketing)));

    // ── البنك: يُنشأ عند أول فتح، ولا يتكرّر
    const before = await prisma.testTrack.count({ where: { scope: "department_member", departmentId: senior.id } });
    const t1 = await ensureMemberTrack(senior.id);
    const t2 = await ensureMemberTrack(senior.id);
    const after = await prisma.testTrack.count({ where: { scope: "department_member", departmentId: senior.id } });
    chk("بنكُ الإدارة العليا يُنشأ عند أول فتح", after === 1, `قبل ${before} بعد ${after}`);
    chk("الفتحُ الثاني لا يُنشئ بنكاً ثانياً", t1.id === t2.id);

    // ── إجراءاتُ الخادم (إضافة/تعديل/حذف سؤال) بالصلاحية نفسها
    chk("الخادم: الرئيسُ التنفيذي يحفظ أسئلةَ البنك", canEditTrack(sess(ceo), t1));
    chk("الخادم: مسؤولُ التشغيل يُردّ", !canEditTrack(sess(ops), t1));
    chk("الخادم: قائدُ قسمٍ آخر يُردّ", !canEditTrack(sess(mktLead), t1));
    const q = await prisma.testQuestion.create({ data: { trackId: t1.id, prompt: `سؤال ${TAG}`, options: ["أ", "ب", "ج", "د"], correctIndex: 0, order: 0 } });
    chk("السؤالُ يُحفظ في بنك الإدارة العليا", (await ensureMemberTrack(senior.id)).questions.some((x) => x.id === q.id));

    // ── الخلافة: لا رئيسَ تنفيذياً نشطاً → المؤسسُ قائدٌ ويملك البنك
    await prisma.user.update({ where: { id: ceo.id }, data: { isActive: false } });
    await reconcileSeniorLeadership("فحص: غياب الرئيس التنفيذي");
    chk("بالخلافة: المؤسسُ يعدّل اختبار الإدارة العليا", await canEditDepartmentTrack(sess(founder), senior));
    chk("بالخلافة: الرئيسُ التنفيذي المعطَّل لا يعدّله", !(await canEditDepartmentTrack(sess(ceo), senior)));
    await prisma.user.update({ where: { id: ceo.id }, data: { isActive: true } });
    await reconcileSeniorLeadership("فحص: عودة الرئيس التنفيذي");
    chk("بعد العودة: الرئيسُ التنفيذي يعدّله من جديد", await canEditDepartmentTrack(sess(ceo), senior));

    await prisma.testQuestion.delete({ where: { id: q.id } });
  } finally {
    for (const c of checks) console.log(c);
    // الختام بترتيبه: تُنقل القيادةُ عن حسابات الفحص أولاً (القائدُ مرجعٌ في صفّ القسم)، ثم تُحذف
    await prisma.user.updateMany({ where: { email: { startsWith: TAG } }, data: { isActive: false } });
    await prisma.user.updateMany({ where: { id: { in: priorCeos.map((c) => c.id) } }, data: { isActive: true } });
    await reconcileSeniorLeadership("فحص: الختام");
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
    const failed = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failed}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  }
})();
