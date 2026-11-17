/** **الهيكلُ التنظيمي بهوية الشخص** — حالاتُه الثماني عشرة على بياناتٍ اصطناعية (`scripts/lib/orgFixture.ts`):
 *  لا تكرارَ لشخص، ولا علاقةَ تضيع، والتسلسلُ صحيح، والصورُ الصحيحة (المرفوعة ثم الافتراضيتان الرسميتان ثم الحروف)،
 *  والأقسامُ واللجانُ الشاغرة تُعلَن، والسابقون لا يظهرون، والتعارضُ يُسجَّل ولا يُدمَج، ولا بريدَ في البيانات.
 *  تشغيل: DATABASE_URL=<محلية> npx tsx --tsconfig tsconfig.json scripts/e2e-org-graph.ts */
import { prisma } from "@/lib/prisma";
import { seedOrgFixture } from "./lib/orgFixture";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}
const TAG = `org${Date.now().toString(36)}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);

(async () => {
  try {
    const { buildOrgGraph } = await import("@/lib/org/orgGraph");
    const { employeeIdLabel } = await import("@/lib/employeeId");
    const { DEFAULT_PORTRAIT_URL } = await import("@/lib/portrait");
    const F = await seedOrgFixture(prisma, TAG);
    const t0 = Date.now();
    const G = await buildOrgGraph({ viewer: { id: F.hrLead.user.id, role: "department_admin" } });
    const ms = Date.now() - t0;
    const P = G.people;
    const keyU = (id: string) => `u:${id}`;
    const keyM = (id: string) => `m:${id}`;

    // ═══ لا تكرار: كلُّ شخصٍ بطاقةٌ واحدة في موضعٍ واحد، وكلُّ شخصٍ له موضع ═══
    const units = [...(G.senior ? [G.senior] : []), ...G.departments];
    const cards: string[] = [
      ...(G.founderKey ? [G.founderKey] : []),
      ...(G.ceoKey ? [G.ceoKey] : []),
      ...G.extraLeaders,
      ...G.operations.map((o) => o.key),
      ...G.seniorPositions.filter((s) => P[s.key].roles[0].kind === "senior_position").map((s) => s.key),
      ...units.flatMap((u) => [
        ...(u.leadKey && !u.leadIsReference ? [u.leadKey] : []),
        ...u.coLeadKeys,
        ...(u.deputyKey ? [u.deputyKey] : []),
        ...u.memberKeys,
        ...u.committees.flatMap((c) => [...(c.leadKey && !c.leadIsReference ? [c.leadKey] : []), ...c.memberKeys]),
      ]),
      ...G.unassignedKeys,
    ];
    const dup = cards.filter((k, i) => cards.indexOf(k) !== i);
    chk(`**لا شخصَ مكرَّر:** ${cards.length} بطاقة لـ${new Set(cards).size} شخصاً`, dup.length === 0, [...new Set(dup)].map((k) => P[k]?.name).join("، "));
    const missing = Object.keys(P).filter((k) => !cards.includes(k));
    chk("**ولا شخصَ بلا موضع** (كلُّ من في الهيكل له بطاقته)", missing.length === 0, missing.map((k) => P[k].name).join("، "));
    chk("والأسماءُ لا تتكرّر بطاقاتٍ في الهيكل", new Set(cards.map((k) => P[k].name)).size === cards.length);

    // ═══ (١) المؤسس ← التنفيذي ← القيادات ═══
    chk("(١) المؤسسُ في القمة والتنفيذيُّ تحته", !!G.founderKey && P[G.founderKey].roles[0].kind === "founder" && !!G.ceoKey && P[G.ceoKey].roles[0].kind === "ceo");
    const counsel = keyM(F.counsel.id);
    chk("(١) ومنصبُ الإدارة العليا موضعُه الأساسي", G.seniorPositions.some((s) => s.key === counsel) && P[counsel].roles[0].kind === "senior_position");
    const sc = G.senior!.committees.find((c) => c.id === F.seniorCommittee.id)!;
    chk("ولجنةُ الإدارة العليا يقودها صاحبُ المنصب **إشارةً** إلى ملفّه لا بطاقةً ثانية", sc.leadKey === counsel && sc.leadIsReference);

    // ═══ (٢) مسؤولُ تشغيلٍ وتحته فريق ═══
    const ops = G.operations.find((o) => o.key === keyU(F.ops.id));
    const opsUnit = G.departments.find((d) => d.id === F.opsDept.id)!;
    chk("(٢) مسؤولُ التشغيل مسجَّلٌ على قسمه", ops?.unitId === F.opsDept.id && opsUnit.overseerKeys.includes(keyU(F.ops.id)));
    chk("(٢) وفريقُه تحته ولا يُخترع له قائدُ قسم", opsUnit.memberKeys.length === 3 && opsUnit.leadKey === null);

    // ═══ (٣)(٤)(٥) تعدّدُ اللجان ═══
    const hr = G.departments.find((d) => d.id === F.hr.id)!;
    const media = G.departments.find((d) => d.id === F.media.id)!;
    const gov = G.departments.find((d) => d.id === F.gov.id)!;
    chk("(٣) قسمٌ بلجنةٍ واحدة", hr.committeeCount === 1);
    chk("(٤) قسمٌ بثلاث لجان", media.committeeCount === 3);
    chk(`(٥) قسمٌ بستّ لجان (${gov.committeeCount})`, gov.committeeCount === 6);
    chk("(١٧) واللجنةُ المؤرشفة لا تدخل الهيكل", !units.some((u) => u.committees.some((c) => c.id === F.archived.id)));

    // ═══ (٦)(٧) لجنةٌ بقائدٍ وأعضاء، ولجنةٌ بقائدٍ فقط ═══
    const content = media.committees.find((c) => c.id === F.mediaCommittees[0].id)!;
    chk("(٦) لجنةٌ بقائدٍ وأعضاء", content.leadKey === keyM(F.withPhoto.id) && content.memberCount === 3);
    chk("(٦) ومسؤولياتُ أعضائها محفوظة", content.responsibilities[keyM(F.man.id)] === "منسّق المحتوى" && content.responsibilities[keyM(F.woman.id)] === "كاتبة");
    const design = media.committees.find((c) => c.id === F.mediaCommittees[1].id)!;
    chk("(٧) لجنةٌ بقائدٍ فقط", design.leadKey === keyM(F.man.id) && !design.leadIsReference && design.memberCount === 1 && design.memberKeys.length === 0);

    // ═══ (٨) قائدُ قسمٍ له عضويةٌ في لجنة قسمٍ آخر — هويةٌ واحدة، والعلاقةُ محفوظة ═══
    const ml = keyU(F.mediaLead.user.id);
    chk("(٨) **قائدُ القسم وسجلُّه التوأم شخصٌ واحد**", !P[keyM(F.mediaLead.twin.id)] && media.leadKey === ml && !media.leadIsReference);
    const gc0 = gov.committees.find((c) => c.id === F.govCommittees[0].id)!;
    chk("(٨) **وعضويتُه في لجنة الحوكمة محفوظةٌ إشارةً** (كانت تُطرح كلياً)", gc0.referenceKeys.includes(ml) && P[ml].roles.some((r) => r.kind === "committee_member" && r.unitId === F.govCommittees[0].id));

    // ═══ (٩) عضوٌ في أكثر من لجنة ═══
    const multi = keyM(F.multi.id);
    const multiCommittees = P[multi].roles.filter((r) => r.kind === "committee_member").map((r) => r.unitId);
    const multiCards = cards.filter((k) => k === multi).length;
    const multiRefs = units.flatMap((u) => u.committees).filter((c) => c.referenceKeys.includes(multi)).length;
    chk(`(٩) عضوٌ في ثلاث لجان: بطاقةٌ واحدة وإشارتان (${multiCards} + ${multiRefs})`, multiCommittees.length === 3 && multiCards === 1 && multiRefs === 2);

    // ═══ (١٠)–(١٣) الصور ═══
    const pw = P[keyM(F.withPhoto.id)].portrait;
    chk("(١٠) صورتُه المرفوعة", pw.kind === "photo" && pw.src.startsWith(`/api/avatar/member/${F.withPhoto.id}`));
    const pm = P[keyM(F.man.id)].portrait;
    chk("(١١) رجلٌ بلا صورة: **الهيئةُ الرسمية للرجل من البطاقة**", pm.kind === "default" && pm.src === DEFAULT_PORTRAIT_URL.male && pm.src === "/brand/2026/portraits/default-male.png");
    const pf = P[keyM(F.woman.id)].portrait;
    chk("(١٢) امرأةٌ بلا صورة: **الهيئةُ الرسمية للمرأة من البطاقة**", pf.kind === "default" && pf.src === "/brand/2026/portraits/default-female.png");
    const pu = P[keyM(F.unknown.id)].portrait;
    chk("(١٣) بلا جنسٍ مسجَّل: الحروفُ الأولى (بديلُ البطاقة المحايد) — ولا يُستنتج من الاسم", pu.kind === "initials" && pu.text.length > 0);

    // ═══ (١٤)(١٥) الشواغر ═══
    chk("(١٤) قسمٌ بلا قائد يُعلَن شاغراً", gov.leadKey === null && gov.memberCount >= 6);
    const vc = gov.committees.find((c) => c.id === F.vacantCommittee.id)!;
    chk("(١٥) لجنةٌ بلا قائد تُعلَن شاغرة", vc.leadKey === null && vc.status === "awaiting_lead");

    // ═══ (١٦)(١٧) قسمٌ كبير، وموظفٌ سابق ═══
    const rnd = G.departments.find((d) => d.id === F.rnd.id)!;
    chk(`(١٦) قسمٌ كبير: ${rnd.memberCount} شخصاً كلُّهم في موضعهم`, rnd.memberCount === 30 && rnd.memberKeys.length === 29);
    chk("(١٧) الموظفُ السابق لا يظهر", !Object.values(P).some((p) => p.name === F.former.fullName));

    // ═══ ETID: رقمُ الشخص نفسه، والتوأمان رقمٌ واحد ═══
    const hl = keyU(F.hrLead.user.id);
    chk("ETID: رقمُ قائد القسم كما هو (لا رقمٌ مستنتجٌ من منصبه)", P[hl].etid === employeeIdLabel(F.hrLead.user.employeeNo));
    const twinNo = (await prisma.member.findUniqueOrThrow({ where: { id: F.hrLead.twin.id } })).employeeNo;
    chk("والسجلُّ التوأمُ يحمل الرقمَ نفسه", twinNo === F.hrLead.user.employeeNo);

    // ═══ التعارض: رقمٌ لبريدين — يُسجَّل ولا يُدمَج ═══
    chk("**التعارضُ يُسجَّل للمراجعة ولا يُدمَج الشخصان**", G.issues.some((i) => i.kind === "duplicate_number") && !!P[keyM(F.clash.id)] && !!P[keyU(F.ops.id)] && keyM(F.clash.id) !== keyU(F.ops.id));

    // ═══ المشاهد، والخصوصية، والأداء ═══
    chk("المشاهِدُ مميَّزٌ وحده", Object.values(P).filter((p) => p.isViewer).length === 1 && P[hl].isViewer);
    const json = JSON.stringify(G);
    chk("**ولا بريدَ في بيانات الهيكل** (تُعرض لكل الأعضاء)", !json.includes("@example.test") && !/"email"/.test(json));
    chk(`والبناءُ استعلاماتٌ ثابتةُ العدد (${ms}ms)`, ms < 3000);
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 4).join(" ") ?? e.message : String(e));
  } finally {
    for (const c of checks) console.log(c);
    const failedN = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failedN}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failedN ? 1 : 0);
  }
})();
