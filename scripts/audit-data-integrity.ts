import { prisma } from "@/lib/prisma";
import { seatConflicts, halfApprovedLeaders } from "@/lib/workflow";
import { leftoverLeaderIds } from "@/lib/leftoverLeaders";
import { DEPARTMENT_THEME, departmentSlugFor } from "@/lib/brand";

/** **تدقيقُ سلامة البيانات — قراءةٌ فقط، لا كتابة.**
 *
 *  يُشغَّل على أي قاعدة — ومنها الإنتاج بيد من يملك الوصول إليها — ليُجيب بالعدد عن أسئلةٍ لا تُجاب
 *  من الشيفرة: هل في البيانات قائدٌ يُعامَل عضواً؟ مقعدٌ مفردٌ مزدوج؟ سجلٌّ يتيم؟ تذكيرٌ موقوفٌ ما زال
 *  في السجل؟ ولا يُصلح شيئاً: الإصلاحُ قرارٌ يُتّخذ بعد قراءة النتيجة، ولكل بندٍ طريقُه المحكوم.
 *
 *  - لا يستدعي إلا `count` و`findMany` و`groupBy` (يتحقّق `check-data-integrity-script` من ذلك).
 *  - لا يطبع بريداً ولا اسماً كاملاً: البريد مُقنَّع والاسم حرفُه الأول — لتُشارَك النتيجة بلا كشف.
 *
 *    npx tsx --env-file=<ملف البيئة> scripts/audit-data-integrity.ts
 *    (المخرج: سطرٌ لكل فحص — ✓ سليم، أو ⚠ بعدده وعيّنةٍ مقنَّعة وطريقِ معالجته) */

const mask = (email: string) => email.replace(/^(.).*?(@.*)$/, "$1***$2");
const initial = (name: string) => `${name.trim().slice(0, 1)}…`;
const lines: string[] = [];
let issues = 0;
function report(title: string, count: number, sample: string[], remedy: string) {
  if (count === 0) {
    lines.push(`✓ ${title}`);
    return;
  }
  issues += count;
  lines.push(`⚠ ${title}: ${count}${sample.length ? ` — ${sample.slice(0, 5).join("، ")}` : ""}\n    ← ${remedy}`);
}

(async () => {
  const now = Date.now();

  // ── ١) الهوية والأدوار
  const half = await halfApprovedLeaders();
  report(
    "قادةٌ اعتُمدوا ولم يُنشأ حسابُهم القيادي (يدخلون أعضاءً)",
    half.length,
    half.map((m) => `${initial(m.fullName)} ${mask(m.email)} (${m.invite.targetRole})`),
    "الاعتمادات ← «اعتماداتٌ قيادية لم تكتمل» ← أكمل إنشاء الحساب القيادي"
  );

  const conflicts = await seatConflicts();
  report(
    "مقاعدُ مفردة يشغلها أكثرُ من حساب (تنفيذي/تشغيل/قائد قسم)",
    conflicts.length,
    conflicts.map((c) => `${c.roleLabel}${c.departmentName ? ` / ${c.departmentName}` : ""}: ${c.holders.map((h) => mask(h.email)).join(" + ")}`),
    "تنحيةُ الزائد من «الحسابات» بقرار المؤسس — لا تُحذف الحسابات"
  );

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { email: true, fullName: true, role: true, departmentId: true, department: { select: { leadershipOnly: true, parentId: true, committeeStatus: true } } },
  });
  const leadNoDept = users.filter((u) => u.role === "department_admin" && !u.departmentId);
  report("قادةُ أقسامٍ نشطون بلا قسم", leadNoDept.length, leadNoDept.map((u) => mask(u.email)), "تعيينُ القسم من ملفّ الحساب بقرار المؤسس");
  const leadInSenior = users.filter((u) => u.role === "department_admin" && u.department?.leadershipOnly && !u.department.parentId);
  report("قائدُ قسمٍ على الإدارة العليا (لا مقعدَ قائدٍ لها)", leadInSenior.length, leadInSenior.map((u) => mask(u.email)), "مراجعةُ الدور — الإدارة العليا يرأسها المؤسس والتنفيذي");
  const leadInClosedCommittee = users.filter(
    (u) => u.role === "department_admin" && u.department?.parentId && u.department.committeeStatus !== "approved"
  );
  report("قائدُ لجنةٍ لم تُعتمد أو رُدّت", leadInClosedCommittee.length, leadInClosedCommittee.map((u) => mask(u.email)), "مراجعةُ حالة اللجنة أو تنحيةُ قائدها");
  const nonDeptRolesWithDept = users.filter((u) => (u.role === "executive" || u.role === "operations_officer") && u.departmentId);
  report("تنفيذيٌّ أو مسؤولُ تشغيلٍ مربوطٌ بقسم", nonDeptRolesWithDept.length, nonDeptRolesWithDept.map((u) => mask(u.email)), "لا أثرَ له في الصلاحيات (الدور يحسمها) — يُفرَّغ القسمُ للوضوح");

  // بريدٌ واحد بسجلّين: الحسابُ الإداري صاحبُه، وسجلُّ الترشّح يجب ألا يحمل كلمةَ مرور
  const leaderEmails = new Set(users.map((u) => u.email));
  const dualCred = await prisma.member.findMany({
    where: { email: { in: [...leaderEmails] }, passwordHash: { not: null } },
    select: { email: true },
  });
  report(
    "سجلُّ ترشّحٍ يحمل كلمةَ مرور وصاحبُه له حسابٌ إداريٌّ نشط",
    dualCred.length,
    dualCred.map((m) => mask(m.email)),
    "لا يُدخل بها بعد إصلاح 8243e1e — تُفرَّغ عند المراجعة (لا أثرَ لها)"
  );

  // ── ٢) العضوية والأقسام
  const activeTerminated = await prisma.member.count({ where: { isActive: true, terminatedAt: { not: null } } });
  report("أعضاءٌ نشطون ولهم تاريخ إنهاء", activeTerminated, [], "مراجعةُ مسار الإنهاء لكل حالة");
  const inPendingCommittee = await prisma.member.count({
    where: { isActive: true, approvalStatus: "approved", department: { parentId: { not: null }, committeeStatus: { not: "approved" } } },
  });
  report("أعضاءٌ معتمدون في لجنةٍ غير معتمدة", inPendingCommittee, [], "اعتمادُ اللجنة أو نقلُ أعضائها");
  const unassigned = await prisma.member.count({ where: { isActive: true, approvalStatus: "approved", departmentId: null } });
  report("أعضاءٌ معتمدون بلا قسم (غير مصنّفين)", unassigned, [], "التصنيفُ من «الأقسام» بيد المؤسس (مرّةً واحدة)");
  const erased = await leftoverLeaderIds();
  report("بقايا ترشّحِ قادةٍ حُذفت حساباتهم", erased.size, [], "لا تُدخل ولا تُعرض — تُمحى عند الحذف النهائي إن طُلب");

  // (اللجانُ بلا قائد: في القسم ٧ — القائدُ عضوٌ معيَّن أو الحسابُ القياديُّ القديم)

  // ألوانُ الأقسام الرسمية: الإدارة بنفسجي، التسويق برتقالي، التقنية أخضر، الموارد البشرية بيج
  const official = await prisma.department.findMany({ where: { parentId: null }, select: { name: true, slug: true, colorHex: true } });
  const offColour = official.filter((d) => {
    const key = departmentSlugFor(d.slug) ?? departmentSlugFor(d.name);
    return key && d.colorHex.toUpperCase() !== DEPARTMENT_THEME[key].colorHex.toUpperCase();
  });
  report(
    "قسمٌ رسميٌّ لونُه المخزَّن يخالف هوية العلامة",
    offColour.length,
    offColour.map((d) => `${d.name}: ${d.colorHex}`),
    "يُعاد لونُه من «الأقسام» بيد المؤسس أو الرئيس التنفيذي (لا يُغيَّر آلياً)"
  );

  // ── ٣) الدعوات
  const staleOpen = await prisma.invite.count({ where: { status: "open", createdAt: { lt: new Date(now - 30 * 86400_000) } } });
  report("دعواتٌ مفتوحة أقدمُ من ٣٠ يوماً", staleOpen, [], "سقوطُها أو إعادةُ إصدارها من «الدعوات»");

  // ── ٤) التذكيرات الموقوفة (تُقرأ وتُترك: سجلٌّ تاريخيّ، والتقادمُ يمحوها)
  const retired = await prisma.emailLog.groupBy({
    by: ["kind"],
    where: { kind: { in: ["تنبيه حماية", "تذكير مهلة"] } },
    _count: { _all: true },
  });
  const retiredTotal = retired.reduce((n, r) => n + r._count._all, 0);
  report(
    "أسطرُ تذكيرٍ موقوف في سجل الرسائل (التحقق الثنائي/مهلة الدخول)",
    retiredTotal,
    retired.map((r) => `${r.kind}: ${r._count._all}`),
    "لا تُنشأ بعد b9695f0. الموجودُ سجلٌّ تاريخيّ يمحوه التقادمُ (purgeOldEmailLogs) — لا حذفَ يدوياً"
  );

  // ── ٥) التسويق
  const staleMk = await prisma.marketingMember.count({
    where: { active: true, OR: [{ user: { isActive: false } }, { member: { isActive: false } }] },
  });
  report("أعضاءُ فريق تسويقٍ نشطون وحساباتُهم معطّلة", staleMk, [], "لا صلاحيةَ لهم فعلاً (يُفحص الحساب في كل طلب) — يُوقَفون من «الفريق» للوضوح");
  const stuckArchive = await prisma.marketingPostArchive.count({ where: { status: "failed" } }).catch(() => 0);
  report("أرشفةُ منشوراتٍ متعثّرة", stuckArchive, [], "صفحة «النشر» ← إعادةُ المحاولة، أو مراجعة إعدادات ملف الأرشيف");

  // ── ٦) التنفيذ
  const orphanTasks = await prisma.planTask.count({ where: { ownerUserId: null, ownerMemberId: null } });
  report("مهامّ بلا صاحب", orphanTasks, [], "إسنادُها من خطة القسم");
  const escalated = await prisma.planTask.count({ where: { consecutiveCarryover: { gte: 3 } } });
  report("مهامّ رُحِّلت ٣ مرّاتٍ متتالية أو أكثر", escalated, [], "قرارٌ تنفيذيٌّ في مراجعة السبت");

  // ── ٧) الهيكل واللجان
  const leaderless = await prisma.department.findMany({
    where: {
      parentId: { not: null },
      committeeStatus: { in: ["approved", "suspended"] },
      OR: [{ leadMemberId: null }, { leadMember: { OR: [{ isActive: false }, { terminatedAt: { not: null } }] } }],
      admins: { none: { isActive: true, role: "department_admin" } },
    },
    select: { name: true },
    take: 20,
  });
  report("لجانٌ عاملة بلا قائدٍ نشط", leaderless.length, leaderless.map((c) => c.name), "صفحة اللجنة ← الأعضاء ← تعيين القائد (قائدُ القسم، أو المؤسس/الرئيس التنفيذي إن شغر مقعدُه)");
  const nested = await prisma.department.count({ where: { parent: { parentId: { not: null } } } });
  report("لجانٌ داخل لجان (من النظام الأول)", nested, [], "تبقى كما هي وتُقرأ؛ ولا تُنشأ جديدةٌ مثلها — يُقرَّر نقلُها أو إغلاقُها");
  const withLead = await prisma.department.findMany({
    where: { leadMemberId: { not: null } },
    select: { name: true, leadMemberId: true, committeeMemberships: { where: { active: true }, select: { memberId: true } } },
    take: 1000,
  });
  const leadMissing = withLead.filter((c) => !c.committeeMemberships.some((m) => m.memberId === c.leadMemberId)).map((c) => c.name);
  report("قائدُ لجنةٍ ليس عضواً نشطاً فيها", leadMissing.length, leadMissing, "إعادةُ تعيينه من تبويب الأعضاء تُعيد عضويته");
  const crossDept = await prisma.committeeMembership.findMany({
    where: { active: true, committee: { parentId: { not: null } } },
    select: { member: { select: { departmentId: true, department: { select: { parentId: true } } } }, committee: { select: { name: true, parentId: true } } },
    take: 5000,
  });
  const outsiders = crossDept.filter(
    (m) => m.member.departmentId !== m.committee.parentId && m.member.department?.parentId !== m.committee.parentId
  );
  report("أعضاءُ لجانٍ من خارج قسمها (نُقلوا بعد ضمّهم)", outsiders.length, outsiders.map((m) => m.committee.name), "قائدُ القسم يُخرجهم من اللجنة أو يُعيدهم إلى القسم");
  const deputies = await prisma.department.findMany({
    where: { deputyMemberId: { not: null } },
    select: { id: true, name: true, parentId: true, deputyMember: { select: { departmentId: true, isActive: true, terminatedAt: true } } },
    take: 100,
  });
  const badDeputy = deputies.filter(
    (d) => d.parentId || !d.deputyMember || d.deputyMember.departmentId !== d.id || !d.deputyMember.isActive || d.deputyMember.terminatedAt
  );
  report("نوّابٌ خارج أقسامهم أو بحساباتٍ معطّلة", badDeputy.length, badDeputy.map((d) => d.name), "لا صلاحيةَ لهم فعلاً (تُفحص في كل طلب) — قائدُ القسم يسحب النيابة أو يعيّن غيره");
  const staleProposals = await prisma.committeeProposal.count({ where: { status: "pending", createdAt: { lt: new Date(now - 14 * 86_400_000) } } });
  report("اقتراحاتُ عضويةٍ معلّقةٌ أكثر من أسبوعين", staleProposals, [], "قائدُ القسم يقرّرها من تبويب الأعضاء");

  console.log(lines.join("\n"));
  console.log(`\n${issues === 0 ? "سليم — لا ملاحظات" : `ملاحظات: ${issues}`} (قراءةٌ فقط — لم يُغيَّر شيء)`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
