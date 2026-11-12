/** **ألوانُ الأقسام — السببُ الجذري** (على نسخةٍ مؤقتة من القاعدة الاصطناعية):
 *    createdb -O tlaqi -T tlaqi_mk tlaqi_col_e2e
 *    DATABASE_URL=…/tlaqi_col_e2e npx tsx --tsconfig tsconfig.json scripts/e2e-department-colors.ts
 *
 *  لكل قسمٍ لونٌ ثابتٌ لا يتغيّر بترتيبه ولا بحذف غيره ولا بأرشفته ولا بإعادة تسميته؛ ولا يتشارك قسمان لوناً؛
 *  واللجنةُ بلون قسمها دائماً. */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") || !/tlaqi_col_e2e/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على النسخة المؤقتة tlaqi_col_e2e وحدها");
  process.exit(1);
}
if (process.env.VERCEL) process.exit(1);

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const origWarn = console.warn;
console.warn = (...a: unknown[]) => (String(a[0] ?? "").includes("google-sheets") ? undefined : origWarn(...a));

(async () => {
  const { prisma } = await import("@/lib/prisma");
  const D = await import("@/lib/departments");
  const C = await import("@/lib/departmentColor");
  const { buildOrgChart, departmentDisplayColor } = await import("@/lib/orgChart");
  const { portraitColorFor } = await import("@/lib/portraitTone");
  const TAG = `${Date.now() % 100000}`;

  /** لونُ كلِّ قسمٍ ولجنةٍ كما تراه الواجهة: من القاعدة، ومن الهيكل، ومن صور الأعضاء */
  const snapshot = async () => {
    const rows = await prisma.department.findMany({ select: { id: true, name: true, colorHex: true, parent: { select: { colorHex: true } } } });
    return new Map(rows.map((r) => [r.id, `${C.departmentColor(r)}|${portraitColorFor(null, { name: r.name, colorHex: r.parent?.colorHex ?? r.colorHex })}`]));
  };
  const chartColors = async () => {
    const chart = await buildOrgChart("ar");
    const out = new Map<string, string>();
    const walk = (ds: { id: string; displayColor: string; committees: unknown[] }[]) => {
      for (const d of ds) {
        out.set(d.id, d.displayColor);
        walk(d.committees as typeof ds);
      }
    };
    walk(chart.departments as unknown as { id: string; displayColor: string; committees: unknown[] }[]);
    return out;
  };
  const same = (a: Map<string, string>, b: Map<string, string>, except: string[] = []) =>
    [...a.entries()].every(([k, v]) => except.includes(k) || !b.has(k) || b.get(k) === v);

  // ── ١) القسمُ الجديد يبدأ بلونٍ حرّ — لا بلون التسويق
  const taken = await C.takenColors();
  const free = await C.firstFreeSwatch();
  chk("لونُ القسم الجديد الافتراضي حرٌّ (ليس لقسمٍ قائم)", !taken[free], `${free} → ${taken[free]}`);
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing" } });
  chk("وليس لونَ التسويق كما كان", C.normalizeHex(free) !== C.normalizeHex(marketing.colorHex));

  // ── ٢) لا يتشارك قسمان لوناً
  const dup = await D.createDepartment({ name: `مكرّر ${TAG}`, colorHex: marketing.colorHex.toLowerCase(), createdByName: "فحص" }).then(() => "ok").catch((e) => String(e));
  chk("إنشاءُ قسمٍ بلون التسويق (ولو بحروفٍ صغيرة) يُرفض باسم صاحب اللون", dup.includes("التسويق"), dup.slice(0, 120));
  const race = await Promise.allSettled([
    D.createDepartment({ name: `سباق أ ${TAG}`, colorHex: free, createdByName: "فحص" }),
    D.createDepartment({ name: `سباق ب ${TAG}`, colorHex: free, createdByName: "فحص" }),
  ]);
  chk("إنشاءان متزامنان باللون نفسه: يقع واحدٌ وحده", race.filter((r) => r.status === "fulfilled").length === 1);
  const a = await prisma.department.findFirstOrThrow({ where: { name: { startsWith: "سباق" }, colorHex: C.normalizeHex(free) } });
  const recolorClash = await C.updateDepartmentColor(a.id, marketing.colorHex);
  chk("وتغييرُ لونِ قسمٍ إلى لونِ غيره يُرفض", !recolorClash.ok);

  // قسمٌ ثانٍ ولجنةٌ للفحص
  const bColor = await C.firstFreeSwatch();
  const b = await D.createDepartment({ name: `قسم ب ${TAG}`, colorHex: bColor, createdByName: "فحص" });
  const committee = await prisma.department.create({ data: { name: `لجنة ${TAG}`, slug: `c-${TAG}`, colorHex: "#000000", parentId: b.id, committeeStatus: "awaiting_lead" } });
  chk("اللجنةُ بلون قسمها ولو حمل صفُّها لوناً قديماً", C.departmentColor({ colorHex: "#000000", parent: { colorHex: bColor } }) === C.normalizeHex(bColor));

  const before = await snapshot();
  const chartBefore = await chartColors();

  // ── ٣) إعادةُ الترتيب: تغييرُ الاسم يقدّم القسمَ في الترتيب الأبجدي — ولا يتغيّر لونُ أحد
  await prisma.department.update({ where: { id: b.id }, data: { name: `أ-أول ${TAG}` } });
  const afterRename = await snapshot();
  const chartRename = await chartColors();
  chk("إعادةُ الترتيب والتسمية لا تغيّر لونَ أيّ قسمٍ أو لجنة", same(before, afterRename) && same(chartBefore, chartRename), JSON.stringify([...afterRename].filter(([k, v]) => before.get(k) !== v)));
  chk("ولجنةُ القسم في الهيكل بلونه", chartRename.get(committee.id) === C.normalizeHex(bColor) || !chartRename.has(committee.id));

  // ── ٤) الحذفُ (قسمٌ فارغ) لا يغيّر لونَ غيره، ويحرّر لونَه
  const del = await D.deleteDepartment({ departmentId: a.id, confirmName: a.name, actorRole: "super_admin", actorName: "فحص" });
  const afterDelete = await snapshot();
  chk("حذفُ قسمٍ لا يغيّر لونَ أيّ قسمٍ آخر", del.ok && same(before, afterDelete, [a.id]), del.ok ? "" : del.reason);
  chk("ولونُ المحذوف يعود حرّاً", !(await C.takenColors())[C.normalizeHex(a.colorHex)]);

  // ── ٥) الأرشفةُ (قسمٌ له سجلّ): يُعاد تسميتُه — ويبقى لونُه، ولا يرثه من يأتي باسمه
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  await prisma.invite.create({ data: { fullName: "مدعوّ", email: `${TAG}-inv@example.test`, targetRole: "member", departmentId: b.id, testTrackId: track.id, invitedById: founder.id, status: "expired" } });
  // اللجنةُ القائمة تمنع الأرشفة — تُؤرشف أولاً (الإجراءُ المعتمد)
  await prisma.department.update({ where: { id: committee.id }, data: { committeeStatus: "archived", archivedFromStatus: "awaiting_lead" } });
  const nameBefore = (await prisma.department.findUniqueOrThrow({ where: { id: b.id } })).name;
  const arch = await D.deleteDepartment({ departmentId: b.id, confirmName: nameBefore, actorRole: "super_admin", actorName: "فحص" });
  const archived = await prisma.department.findUniqueOrThrow({ where: { id: b.id } });
  const afterArchive = await snapshot();
  chk("الأرشفةُ تقع (القسمُ له سجلّ) وتغيّر الاسم", arch.ok && arch.mode === "archive" && archived.name !== nameBefore, arch.ok ? arch.mode : arch.reason);
  chk("ويبقى لونُ المؤرشف كما هو في كل موضع (صور الأعضاء والهيكل)", afterArchive.get(b.id) === before.get(b.id) && departmentDisplayColor(archived.name, archived.colorHex) === C.normalizeHex(bColor));
  chk("ولا يتغيّر لونُ أيّ قسمٍ آخر بالأرشفة", same(before, afterArchive));
  const reuse = await D.createDepartment({ name: nameBefore, colorHex: bColor, createdByName: "فحص" }).then(() => "ok").catch((e) => String(e));
  chk("ولا يرث قسمٌ جديدٌ بالاسم نفسه لونَ المؤرشف (محجوزٌ له ليعود بلونه)", reuse !== "ok", reuse.slice(0, 100));
  const fresh = await D.createDepartment({ name: nameBefore, colorHex: await C.firstFreeSwatch(), createdByName: "فحص" });
  chk("ويأخذ لوناً حرّاً غيرَه", C.normalizeHex(fresh.colorHex) !== C.normalizeHex(bColor));

  // ── ٦) تغييرُ لون القسم: تتبعه لجانُه في القاعدة والهيكل
  const live = await D.createDepartment({ name: `قسم ج ${TAG}`, colorHex: await C.firstFreeSwatch(), createdByName: "فحص" });
  const liveCommittee = await prisma.department.create({ data: { name: `لجنة ج ${TAG}`, slug: `cj-${TAG}`, colorHex: live.colorHex, parentId: live.id, committeeStatus: "awaiting_lead" } });
  const newColor = await C.firstFreeSwatch();
  const rc = await C.updateDepartmentColor(live.id, newColor);
  const lc = await prisma.department.findUniqueOrThrow({ where: { id: liveCommittee.id }, include: { parent: { select: { colorHex: true } } } });
  chk("تغييرُ لون القسم يقع وتتبعه لجنتُه (لا نسخةَ قديمة)", rc.ok && C.normalizeHex(lc.colorHex) === C.normalizeHex(newColor) && C.departmentColor(lc) === C.normalizeHex(newColor));
  const toCommittee = await C.updateDepartmentColor(liveCommittee.id, "#123456");
  chk("ولا يُغيَّر لونُ لجنةٍ مباشرةً — لونُها لون قسمها", !toCommittee.ok);

  // ── ٧) لا قسمان نشطان بلونٍ واحد في القاعدة الآن
  const tops = await prisma.department.findMany({ where: { parentId: null, OR: [{ committeeStatus: null }, { committeeStatus: { not: "rejected" } }] }, select: { colorHex: true, name: true } });
  const counts = new Map<string, string[]>();
  for (const t of tops) counts.set(C.normalizeHex(t.colorHex), [...(counts.get(C.normalizeHex(t.colorHex)) ?? []), t.name]);
  const clashes = [...counts.values()].filter((v) => v.length > 1);
  chk("لا لونَ يحمله قسمان (نشطاً أو مؤرشفاً)", clashes.length === 0, JSON.stringify(clashes));

  console.warn = origWarn;
  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(`\n${checks.length - failed}/${checks.length} ✓${failed ? ` — ${failed} فشل` : ""}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log(checks.join("\n"));
  console.error(e);
  process.exit(1);
});
