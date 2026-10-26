import sharp from "sharp";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { marketingActor, type MkActor } from "@/lib/marketing/access";
import { addTeamMember } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { saveDraft, submitContent, decideContent } from "@/lib/marketing/content";
import { uploadDesign, submitDesign, decideDesign } from "@/lib/marketing/design";
import { sendToQuality, recordQuality, QUALITY_ITEMS } from "@/lib/marketing/review";
import { createTask } from "@/lib/marketing/tasks";

/** بياناتُ فحصٍ بصريٍّ لوكيل التسويق — على القاعدة المحلية وحدها، بحسابات `fixtures-roles`.
 *
 *  الفريق: المؤسس (كاتبٌ ومصمّمٌ ثانٍ ليعتمد)، والتنفيذي (منسّقٌ ومراجع)، ومسؤولُ
 *  التشغيل (كاتبٌ وناشر)، والعضو (مصمّم). **وقائدُ القسم خارج الفريق** — ليُفحص المنع.
 *  حملة «أ» قيد التنفيذ بأربعة مخرجات في مراحل مختلفة؛ وحملة «ب» بلا مسؤول التشغيل.
 *
 *    npx tsx --env-file=.env scripts/fixtures-marketing.ts setup|teardown */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const PREFIX = "qa-mk";
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
  // العضوياتُ التي أنشأها هذا السكربت وحده (بإضافة المؤسس باسمه المعلَّم)
  await prisma.marketingMember.deleteMany({ where: { addedByName: { startsWith: PREFIX } } });
}

async function setup() {
  await teardown();
  const founderU = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const execU = await prisma.user.findFirstOrThrow({ where: { email: "exec@fixture.test" } });
  const opsU = await prisma.user.findFirstOrThrow({ where: { email: "ops@fixture.test" } });
  const memberM = await prisma.member.findFirstOrThrow({ where: { email: "member@fixture.test" } });
  for (const where of [{ userId: founderU.id }, { userId: execU.id }, { userId: opsU.id }, { memberId: memberM.id }]) {
    if (await prisma.marketingMember.count({ where })) throw new Error("حسابٌ له عضويةٌ تسويقيةٌ سابقة — شغّل teardown أو احذفها يدوياً");
  }
  const N = (w: string) => `${PREFIX} ${w}`;
  const founder0 = await actorOf(asRole(founderU.id, "super_admin", N("founder")));
  const fm = must(await addTeamMember(founder0, { kind: "user", id: founderU.id, capabilities: ["writer", "designer"] }), "founder");
  const em = must(await addTeamMember(founder0, { kind: "user", id: execU.id, capabilities: ["coordinator", "reviewer", "manager"] }), "exec");
  const om = must(await addTeamMember(founder0, { kind: "user", id: opsU.id, capabilities: ["writer", "publisher"] }), "ops");
  const mm = must(await addTeamMember(founder0, { kind: "member", id: memberM.id, capabilities: ["designer"] }), "member");
  const founder = await actorOf(asRole(founderU.id, "super_admin", N("founder")));
  const exec = await actorOf(asRole(execU.id, "executive", N("exec")));
  const ops = await actorOf(asRole(opsU.id, "operations_officer", N("ops")));
  const member = await actorOf(asRole(memberM.id, "member", N("member")));

  const A = must(await createCampaign(exec, { name: `${PREFIX} حملة الإطلاق`, channels: ["instagram", "x"], priority: "high" }), "A").campaignId;
  await transitionCampaign(exec, A, "briefing");
  await updateBrief(exec, A, {
    name: `${PREFIX} حملة الإطلاق`,
    objective: "تعريف طلاب الجامعات بمنصة تَـــلاقِ وفتح باب الانضمام",
    audience: "طلاب الجامعات في الرياض",
    keyMessage: "نلتقي · نفكّر · نصنع",
    deadline: new Date(Date.now() + 10 * 86400_000),
    channels: ["instagram", "x"],
    priority: "high",
  });
  const d1 = must(await createDeliverable(exec, A, { title: "ستوري الإطلاق", platform: "instagram", formatKey: "story" }), "d1").deliverableId;
  const d2 = must(await createDeliverable(exec, A, { title: "منشور مربّع", platform: "instagram", formatKey: "square" }), "d2").deliverableId;
  const d3 = must(await createDeliverable(exec, A, { title: "تغريدة الإعلان", platform: "x", formatKey: "landscape" }), "d3").deliverableId;
  const d4 = must(await createDeliverable(exec, A, { title: "منشور طولي", platform: "instagram", formatKey: "portrait" }), "d4").deliverableId;
  await transitionCampaign(exec, A, "ready_for_planning");
  for (const [id, role] of [[om.memberId, "writer"], [om.memberId, "publisher"], [fm.memberId, "writer"], [fm.memberId, "designer"], [mm.memberId, "designer"], [em.memberId, "reviewer"]] as const) {
    must(await addCampaignMember(exec, A, { marketingMemberId: id, role }), `assign ${role}`);
  }
  must(await transitionCampaign(exec, A, "in_progress"), "A in_progress");

  // d1: بانتظار مراجعة التصميم — كتبه مسؤول التشغيل واعتمده المؤسس، وصمّمه العضو
  const v1 = must(await submitContent(ops, d1, { body: "نلتقي لنفكّر معاً، ونصنع ما يبقى.\nانضم إلى تَـــلاقِ — الرابط في الحساب.", sources: "—" }), "d1 content");
  must(await decideContent(founder, d1, { versionId: v1.versionId, decision: "approved" }), "d1 approve");
  const dv1 = must(await uploadDesign(member, d1, { file: { name: "story-v1.png", type: "image/png", bytes: await png(1080, 1920, "v1") }, changeNote: "النسخة الأولى" }), "d1 design");
  const dv2 = must(await uploadDesign(member, d1, { file: { name: "story-v2.png", type: "image/png", bytes: await png(1080, 1920, "v2") }, changeNote: "تكبير الشعار" }), "d1 design 2");
  void dv1;
  must(await submitDesign(member, d1, dv2.versionId), "d1 submit design");

  // d2: جاهزٌ للنشر — مرّ بكل شيء
  const v2 = must(await submitContent(ops, d2, { body: "تَـــلاقِ: مجتمعٌ طلابيٌّ يلتقي فيه من يفكّر ومن يصنع." }), "d2 content");
  must(await decideContent(founder, d2, { versionId: v2.versionId, decision: "approved" }), "d2 approve");
  const dd2 = must(await uploadDesign(member, d2, { file: { name: "square.png", type: "image/png", bytes: await png(1080, 1080, "sq") } }), "d2 design");
  must(await submitDesign(member, d2, dd2.versionId), "d2 submit");
  must(await decideDesign(founder, d2, { designVersionId: dd2.versionId, decision: "approved" }), "d2 design approve");
  must(await sendToQuality(member, d2), "d2 quality");
  must(await recordQuality(exec, d2, { contentVersionId: v2.versionId, designVersionId: dd2.versionId, items: QUALITY_ITEMS.map((key) => ({ key, passed: true })) }), "d2 quality pass");

  // d3: مسودةٌ يكتبها مسؤول التشغيل (فيها رقمٌ بلا مصدر — تنبيهٌ آلي)
  await saveDraft(ops, d3, "انضم ٣٠٠ طالب في أسبوع — كن التالي http://example.com");

  // d4: بانتظار مراجعة النص — كتبها المؤسس، فيعتمدها مسؤول التشغيل
  must(await submitContent(founder, d4, { body: "فكرةٌ واحدة تكفي لتبدأ. نلتقي في تَـــلاقِ.", changeNote: "صياغة أولى" }), "d4 content");

  await createTask(exec, A, { title: "تحديد موعد النشر", kind: "publishing", assigneeId: om.memberId, dueAt: new Date(Date.now() - 86400_000), priority: "high" });
  await createTask(exec, A, { title: "صور الحملة", kind: "design", assigneeId: mm.memberId, deliverableId: d1, dueAt: new Date(Date.now() + 3 * 86400_000) });

  // حملة «ب»: لا يُعيَّن فيها مسؤول التشغيل — فلا يراها
  const B = must(await createCampaign(exec, { name: `${PREFIX} حملة داخلية` }), "B").campaignId;

  console.log(JSON.stringify({ A, B, d1, d2, d3, d4, design: dv2.versionId }));
}

const cmd = process.argv[2];
(cmd === "setup" ? setup() : cmd === "teardown" ? teardown().then(() => console.log("ok")) : Promise.reject(new Error("setup | teardown")))
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
