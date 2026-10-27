import sharp from "sharp";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { marketingActor, type MkActor } from "@/lib/marketing/access";
import { addTeamMember } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { saveDraft, submitContent, decideContent } from "@/lib/marketing/content";
import { uploadDesign, submitDesign, decideDesign } from "@/lib/marketing/design";
import { sendToQuality, recordQuality, QUALITY_ITEMS } from "@/lib/marketing/review";
import { createTask } from "@/lib/marketing/tasks";
import { submitPlan, decidePlan } from "@/lib/marketing/plan";
import { completePlanForTest, finalCheckForTest } from "./marketing-plan-fixture";

const FIXTURE_PASSWORD = "Fixture#2026aa";

/** بياناتُ فحصٍ بصريٍّ لوكيل التسويق — على القاعدة المحلية وحدها، بحسابات `fixtures-roles`.
 *
 *  أصحابُ القرار من هيكل المنصة:
 *  - **قائدُ التسويق** (`mklead@fixture.test` — قائدُ قسم التسويق، حسابٌ مؤقّت يُنشأ هنا):
 *    يبني الفريق، وينسّق، ويعتمد الخطة في مرحلة القسم.
 *  - **مسؤولُ التشغيل** (`ops`) والرئيسُ التنفيذي (`exec`): مرحلتا الخطة التاليتان.
 *  الفريق: مسؤولُ التشغيل كاتبٌ وناشر، والتنفيذيُّ مراجعُ جودة، والعضوُ مصمّم، و`crew@fixture.test`
 *  (حسابٌ مؤقّت) كاتبٌ ومصمّمٌ ثانٍ ليعتمد ما لم يكتبه. **والمؤسسُ لا يشارك**، وقائدُ قسم التقنية
 *  (`lead`) خارج الفريق — ليُفحص المنع.
 *  - حملة «أ» قيد التنفيذ بعد اعتماد خطتها الثلاثي، بأربعة مخرجات في مراحل مختلفة.
 *  - حملة «ب» فكرةٌ بلا خطة ولا مسؤول التشغيل — فلا يراها.
 *  - حملة «ج» خطتُها اعتمدها قائدُ التسويق وتنتظر مسؤولَ التشغيل.
 *
 *    npx tsx --env-file=.env scripts/fixtures-marketing.ts setup <totpSecret> | teardown */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const PREFIX = "qa-mk";
const TEMP_USERS = ["mklead@fixture.test", "crew@fixture.test"];
const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);
const actorOf = async (s: Session): Promise<MkActor> => (await marketingActor(s))!;
const must = <T extends { ok: boolean }>(r: T, what: string): T & { ok: true } => {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
  return r as T & { ok: true };
};

async function png(width: number, height: number, label: string) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#341D2B"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#C34900"/><text x="50%" y="${height * 0.12}" font-size="${Math.round(width / 12)}" text-anchor="middle" fill="#EEF6DF" font-family="sans-serif">${label}</text></svg>`
  );
  return new Uint8Array(await sharp(svg).png().toBuffer());
}

async function teardown() {
  const campaigns = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  for (const c of campaigns) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingEvent.deleteMany({ where: { actorName: { startsWith: PREFIX } } });
  const temp = await prisma.user.findMany({ where: { email: { in: TEMP_USERS } }, select: { id: true } });
  await prisma.marketingMember.deleteMany({ where: { OR: [{ addedByName: { startsWith: PREFIX } }, { userId: { in: temp.map((u) => u.id) } }] } });
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: temp.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { email: { in: TEMP_USERS } } });
}

async function setup(totpSecret: string) {
  if (!totpSecret) throw new Error("setup <totpSecret>");
  await teardown();
  const execU = await prisma.user.findFirstOrThrow({ where: { email: "exec@fixture.test" } });
  const opsU = await prisma.user.findFirstOrThrow({ where: { email: "ops@fixture.test" } });
  const memberM = await prisma.member.findFirstOrThrow({ where: { email: "member@fixture.test" } });
  for (const where of [{ userId: execU.id }, { userId: opsU.id }, { memberId: memberM.id }]) {
    if (await prisma.marketingMember.count({ where })) throw new Error("حسابٌ له عضويةٌ تسويقيةٌ سابقة — شغّل teardown أو احذفها يدوياً");
  }
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const hr = await prisma.department.findFirstOrThrow({ where: { slug: "hr" } });
  const passwordHash = await hashPassword(FIXTURE_PASSWORD);
  const temp = (email: string, fullName: string, departmentId: string) =>
    prisma.user.create({
      data: {
        fullName, email, passwordHash, role: "department_admin", departmentId,
        totpEnabled: true, totpSecret, profileCompletedAt: new Date(), passwordChangedAt: new Date(), jobTitle: "حساب فحص",
      },
    });
  const leadU = await temp("mklead@fixture.test", "فحص قائد التسويق", marketing.id);
  const crewU = await temp("crew@fixture.test", "فحص كاتب ومصمّم", hr.id);

  const N = (w: string) => `${PREFIX} ${w}`;
  const lead = await actorOf(asRole(leadU.id, "department_admin", N("mklead")));
  const cm = must(await addTeamMember(lead, { kind: "user", id: crewU.id, capabilities: ["writer", "designer"] }), "crew");
  const em = must(await addTeamMember(lead, { kind: "user", id: execU.id, capabilities: ["reviewer"] }), "exec");
  const om = must(await addTeamMember(lead, { kind: "user", id: opsU.id, capabilities: ["writer", "publisher"] }), "ops");
  const mm = must(await addTeamMember(lead, { kind: "member", id: memberM.id, capabilities: ["designer"] }), "member");
  const crew = await actorOf(asRole(crewU.id, "department_admin", N("crew")));
  const exec = await actorOf(asRole(execU.id, "executive", N("exec")));
  const ops = await actorOf(asRole(opsU.id, "operations_officer", N("ops")));
  const member = await actorOf(asRole(memberM.id, "member", N("member")));

  /** تقديمٌ ثم مراحلُ بأصحابها حتى `upTo` */
  async function approve(campaignId: string, upTo: "department" | "operations" | "executive") {
    // الخطةُ تُقدَّم مكتملةً وإلا رُدّت (`plan_incomplete`) — يُكمل الفحصُ ناقصَها بقيمٍ للفحص
    await completePlanForTest(lead, campaignId);
    const p = must(await submitPlan(lead, campaignId, { note: "خطة الإطلاق" }), "plan");
    for (const [a, stage] of [[lead, "department"], [ops, "operations"], [exec, "executive"]] as const) {
      must(await decidePlan(a, campaignId, { planVersionId: p.planVersionId, stage, decision: "approved" }), `plan ${stage}`);
      if (stage === upTo) break;
    }
  }

  const A = must(await createCampaign(lead, { name: `${PREFIX} حملة الإطلاق`, channels: ["instagram", "x"], priority: "high" }), "A").campaignId;
  await transitionCampaign(lead, A, "briefing");
  await updateBrief(lead, A, {
    name: `${PREFIX} حملة الإطلاق`,
    objective: "تعريف طلاب الجامعات بمنصة تَـــلاقِ وفتح باب الانضمام",
    audience: "طلاب الجامعات في الرياض",
    keyMessage: "نلتقي · نفكّر · نصنع",
    deadline: new Date(Date.now() + 10 * 86400_000),
    channels: ["instagram", "x"],
    priority: "high",
  });
  const d1 = must(await createDeliverable(lead, A, { title: "ستوري الإطلاق", platform: "instagram", formatKey: "story" }), "d1").deliverableId;
  const d2 = must(await createDeliverable(lead, A, { title: "منشور مربّع", platform: "instagram", formatKey: "square" }), "d2").deliverableId;
  const d3 = must(await createDeliverable(lead, A, { title: "تغريدة الإعلان", platform: "x", formatKey: "landscape" }), "d3").deliverableId;
  const d4 = must(await createDeliverable(lead, A, { title: "منشور طولي", platform: "instagram", formatKey: "portrait" }), "d4").deliverableId;
  await transitionCampaign(lead, A, "ready_for_planning");
  for (const [id, role] of [[om.memberId, "writer"], [om.memberId, "publisher"], [cm.memberId, "writer"], [cm.memberId, "designer"], [mm.memberId, "designer"], [em.memberId, "reviewer"]] as const) {
    must(await addCampaignMember(lead, A, { marketingMemberId: id, role }), `assign ${role}`);
  }
  await approve(A, "executive");
  must(await transitionCampaign(lead, A, "in_progress"), "A in_progress");

  // d1: بانتظار مراجعة التصميم — كتبه مسؤول التشغيل واعتمده الكاتبُ الثاني، وصمّمه العضو
  const v1 = must(await submitContent(ops, d1, { body: "نلتقي لنفكّر معاً، ونصنع ما يبقى.\nانضم إلى تَـــلاقِ — الرابط في الحساب.", sources: "—" }), "d1 content");
  must(await decideContent(crew, d1, { versionId: v1.versionId, decision: "approved" }), "d1 approve");
  const dv1 = must(await uploadDesign(member, d1, { file: { name: "story-v1.png", type: "image/png", bytes: await png(1080, 1920, "v1") }, changeNote: "النسخة الأولى" }), "d1 design");
  const dv2 = must(await uploadDesign(member, d1, { file: { name: "story-v2.png", type: "image/png", bytes: await png(1080, 1920, "v2") }, changeNote: "تكبير الشعار" }), "d1 design 2");
  void dv1;
  must(await submitDesign(member, d1, dv2.versionId), "d1 submit design");

  // d2: جاهزٌ للنشر — مرّ بكل شيء
  const v2 = must(await submitContent(ops, d2, { body: "تَـــلاقِ: مجتمعٌ طلابيٌّ يلتقي فيه من يفكّر ومن يصنع." }), "d2 content");
  must(await decideContent(crew, d2, { versionId: v2.versionId, decision: "approved" }), "d2 approve");
  const dd2 = must(await uploadDesign(member, d2, { file: { name: "square.png", type: "image/png", bytes: await png(1080, 1080, "sq") } }), "d2 design");
  must(await submitDesign(member, d2, dd2.versionId), "d2 submit");
  must(await decideDesign(crew, d2, { designVersionId: dd2.versionId, decision: "approved" }), "d2 design approve");
  must(await sendToQuality(member, d2), "d2 quality");
  must(await recordQuality(exec, d2, { contentVersionId: v2.versionId, designVersionId: dd2.versionId, items: QUALITY_ITEMS.map((key) => ({ key, passed: true })) }), "d2 quality pass");
  // «مرّ بكل شيء» صار يشمل فحصَ الناشر الأخير — شرطَ النشر (`final_check_missing`)
  await finalCheckForTest(ops, d2);

  // d3: مسودةٌ يكتبها مسؤول التشغيل (فيها رقمٌ بلا مصدر — تنبيهٌ آلي)
  await saveDraft(ops, d3, "انضم ٣٠٠ طالب في أسبوع — كن التالي http://example.com");

  // d4: بانتظار مراجعة النص — كتبها الكاتبُ الثاني، فيعتمدها مسؤول التشغيل
  must(await submitContent(crew, d4, { body: "فكرةٌ واحدة تكفي لتبدأ. نلتقي في تَـــلاقِ.", changeNote: "صياغة أولى" }), "d4 content");

  await createTask(lead, A, { title: "تحديد موعد النشر", kind: "publishing", assigneeId: om.memberId, dueAt: new Date(Date.now() - 86400_000), priority: "high" });
  await createTask(lead, A, { title: "صور الحملة", kind: "design", assigneeId: mm.memberId, deliverableId: d1, dueAt: new Date(Date.now() + 3 * 86400_000) });

  // حملة «ب»: فكرةٌ بلا خطة، ولا يُعيَّن فيها مسؤول التشغيل — فلا يراها
  const B = must(await createCampaign(lead, { name: `${PREFIX} حملة داخلية` }), "B").campaignId;

  // حملة «ج»: خطةٌ اعتمدها القائد وتنتظر مسؤولَ التشغيل
  const C = must(await createCampaign(lead, { name: `${PREFIX} حملة المعرض` }), "C").campaignId;
  await transitionCampaign(lead, C, "briefing");
  await updateBrief(lead, C, { name: `${PREFIX} حملة المعرض`, objective: "دعوة الطلاب إلى المعرض", audience: "طلاب السنة الأولى", keyMessage: "تعال واصنع", deadline: new Date(Date.now() + 30 * 86400_000), channels: ["instagram"] });
  must(await createDeliverable(lead, C, { title: "منشور الدعوة", platform: "instagram", formatKey: "square" }), "c1");
  must(await transitionCampaign(lead, C, "ready_for_planning"), "C planning");
  // الخطةُ تسمّي كاتبَ كل قطعةٍ ومصمّمَها من فريق الحملة (`plan_incomplete` بدونهما)
  must(await addCampaignMember(lead, C, { marketingMemberId: cm.memberId, role: "writer" }), "C writer");
  must(await addCampaignMember(lead, C, { marketingMemberId: mm.memberId, role: "designer" }), "C designer");
  await approve(C, "department");

  console.log(JSON.stringify({ A, B, C, d1, d2, d3, d4, design: dv2.versionId }));
}

const cmd = process.argv[2];
(cmd === "setup" ? setup(process.argv[3] ?? "") : cmd === "teardown" ? teardown().then(() => console.log("ok")) : Promise.reject(new Error("setup | teardown")))
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
