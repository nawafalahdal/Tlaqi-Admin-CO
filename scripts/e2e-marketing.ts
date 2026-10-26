import sharp from "sharp";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { marketingActor, canEnterMarketing, type MkActor } from "@/lib/marketing/access";
import { addTeamMember, setCapabilities, setMemberActive, updateSettings } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign, listCampaigns, campaignWorkspace } from "@/lib/marketing/campaigns";
import { createDeliverable, changeFormat, deliverableWorkspace, setDeliverableBlocked } from "@/lib/marketing/deliverables";
import { saveDraft, submitContent, decideContent, keepApprovedContent } from "@/lib/marketing/content";
import { uploadDesign, submitDesign, decideDesign, returnToWriter, readCampaignFile } from "@/lib/marketing/design";
import { sendToQuality, recordQuality, recordPublication, recordResults, QUALITY_ITEMS } from "@/lib/marketing/review";
import { createTask, updateTask, setTaskStatus } from "@/lib/marketing/tasks";
import { actionItems } from "@/lib/marketing/inbox";

/** وكيلُ التسويق — على القاعدة المحلية وحدها، بحساباتِ الفحص وحملاتٍ تُنشأ وتُحذف.
 *
 *  الصلاحيات (من لا يدخل، ومن لا يرى حملةَ غيره، ومن لا يمنح نفسه)، ثم
 *  المسار كاملاً: موجز ← نص ← تصميم ← جودة ← نشر — مع كل ما يُبطل اعتماداً،
 *  والتزامن، وتكرار الطلب، وملفاتٍ تالفة ومقاساتٍ خاطئة، والمهامّ. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const MARK = `e2e-mk-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code ?? "?");

const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);

async function actorOf(s: Session): Promise<MkActor> {
  return (await marketingActor(s))!;
}

async function png(width: number, height: number, color = "#C34900") {
  // صورةٌ بنقشٍ لا بلونٍ واحد — كتصميمٍ حقيقيٍّ لا تصديرٍ فارغ
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#EEF6DF"/></svg>`);
  return new Uint8Array(await sharp(svg).png().toBuffer());
}

async function cleanup() {
  const campaigns = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: "e2e-mk-" } }, select: { id: true } });
  for (const c of campaigns) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingEvent.deleteMany({ where: { actorName: { startsWith: "e2e-mk" } } });
  await prisma.marketingMember.deleteMany({ where: { addedByName: { startsWith: "e2e-mk" } } });
  await prisma.marketingSettings.upsert({ where: { id: "default" }, update: { requireSeparateApprover: true }, create: { id: "default", requireSeparateApprover: true, updatedByName: "e2e" } });
}

(async () => {
  await cleanup();
  const founderU = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const execU = await prisma.user.findFirstOrThrow({ where: { email: "exec@fixture.test" } });
  const opsU = await prisma.user.findFirstOrThrow({ where: { email: "ops@fixture.test" } });
  const leadU = await prisma.user.findFirstOrThrow({ where: { email: "lead@fixture.test" } });
  const memberM = await prisma.member.findFirstOrThrow({ where: { email: "member@fixture.test" } });
  const outsiderU = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: "department_admin", email: { not: "lead@fixture.test" } } });
  for (const p of [execU.id, opsU.id, leadU.id, outsiderU.id]) {
    if (await prisma.marketingMember.count({ where: { userId: p } })) throw new Error("حسابُ فحصٍ له عضويةٌ تسويقية سابقة — احذفها قبل الفحص");
  }
  if (await prisma.marketingMember.count({ where: { memberId: memberM.id } })) throw new Error("العضوُ له عضويةٌ تسويقية سابقة");

  const N = (who: string) => `e2e-mk ${who}`;
  const S = {
    founder: asRole(founderU.id, "super_admin", N("founder")),
    exec: asRole(execU.id, "executive", N("exec")),
    ops: asRole(opsU.id, "operations_officer", N("ops")),
    lead: asRole(leadU.id, "department_admin", N("lead")),
    member: asRole(memberM.id, "member", N("member")),
    outsider: asRole(outsiderU.id, "department_admin", N("outsider")),
  };

  // ── ١) الوصولُ مغلقٌ افتراضياً
  const outsider0 = await actorOf(S.outsider);
  const exec0 = await actorOf(S.exec);
  chk("من ليس في الفريق لا يدخل الوكيل — ولو كان تنفيذياً", !canEnterMarketing(exec0) && !canEnterMarketing(outsider0));
  chk("والعضوُ العاديّ كذلك", !canEnterMarketing(await actorOf(S.member)));
  chk("والمؤسسُ يدخل ليدير الفريق", canEnterMarketing(await actorOf(S.founder)));
  chk("ومن ليس في الفريق لا ينشئ حملةً باستدعاء الخادم مباشرة", code(await createCampaign(exec0, { name: `${MARK} x` })) === "forbidden");

  // ── ٢) المنحُ: للمؤسس، ولا أحدَ يرفع صلاحيته بيده
  const founder = await actorOf(S.founder);
  chk("غيرُ المدير لا يضيف أحداً", code(await addTeamMember(exec0, { kind: "user", id: opsU.id, capabilities: ["writer"] })) === "forbidden");
  const addExec = await addTeamMember(founder, { kind: "user", id: execU.id, capabilities: ["coordinator", "reviewer", "manager"] });
  chk("المؤسسُ يضيف المنسّق والمراجع ويمنحه الإدارة", addExec.ok);
  const exec = await actorOf(S.exec);
  chk("المديرُ غيرُ المؤسس لا يمنح الإدارة", code(await addTeamMember(exec, { kind: "user", id: opsU.id, capabilities: ["manager"] })) === "forbidden");
  chk("ولا يعدّل مسؤولياته هو", code(await setCapabilities(exec, addExec.ok ? addExec.memberId : "", ["coordinator", "reviewer", "writer"])) === "self_escalation");
  const addOps = await addTeamMember(exec, { kind: "user", id: opsU.id, capabilities: ["writer", "publisher"] });
  const addLead = await addTeamMember(exec, { kind: "user", id: leadU.id, capabilities: ["writer", "designer"] });
  const addMember = await addTeamMember(exec, { kind: "member", id: memberM.id, capabilities: ["designer"] });
  chk("والمديرُ يضيف الكاتب والمصمّم والعضو", addOps.ok && addLead.ok && addMember.ok);
  chk("ولا يُضاف أحدٌ مرتين", code(await addTeamMember(exec, { kind: "user", id: opsU.id, capabilities: ["writer"] })) === "already_member");
  chk("وإضعافُ فصل الاعتماد للمؤسس وحده", code(await updateSettings(exec, { requireSeparateApprover: false })) === "forbidden");

  const ops = await actorOf(S.ops);
  const lead = await actorOf(S.lead);
  const member = await actorOf(S.member);
  chk("العضوُ (حسابُ عضو) يدخل بعد منحه", canEnterMarketing(member));

  // ── ٣) الحملة: موجزٌ ثم تخطيطٌ ثم تنفيذ — بشروطها
  chk("الكاتبُ لا ينشئ حملة (ليس منسّقاً)", code(await createCampaign(ops, { name: `${MARK} y` })) === "forbidden");
  const c1 = await createCampaign(exec, { name: `${MARK} حملة أ`, channels: ["instagram"] });
  const c2 = await createCampaign(exec, { name: `${MARK} حملة ب` });
  chk("المنسّقُ ينشئ حملتين", c1.ok && c2.ok);
  if (!c1.ok || !c2.ok) throw new Error("stop");
  const A = c1.campaignId, B = c2.campaignId;
  chk("لا قفزَ من الفكرة إلى التنفيذ", code(await transitionCampaign(exec, A, "in_progress")) === "invalid_state");
  chk("ولا إلى «منشورة» يدوياً", code(await transitionCampaign(exec, A, "published")) === "invalid_state");
  chk("فكرة ← موجز", (await transitionCampaign(exec, A, "briefing")).ok);
  const early = await transitionCampaign(exec, A, "ready_for_planning");
  chk("موجزٌ ناقص لا يُخطَّط له — ويُسمّى ما ينقص", code(early) === "brief_incomplete" && !early.ok && String(early.params?.missing).includes("objective"));
  await updateBrief(exec, A, { name: `${MARK} حملة أ`, objective: "تعريفٌ بالمنصة", audience: "طلاب الجامعات", keyMessage: "نلتقي ونفكّر ونصنع", deadline: new Date(Date.now() + 14 * 86400_000), channels: ["instagram"] });
  const del1 = await createDeliverable(exec, A, { title: "ستوري الإطلاق", platform: "instagram", formatKey: "story" });
  chk("مخرجٌ بمقاسٍ من القوالب", del1.ok);
  if (!del1.ok) throw new Error("stop");
  const D = del1.deliverableId;
  chk("الموجزُ المكتمل يُخطَّط له", (await transitionCampaign(exec, A, "ready_for_planning")).ok);
  const noTeam = await transitionCampaign(exec, A, "in_progress");
  chk("ولا تنفيذَ بلا كاتبٍ ومصمّم", code(noTeam) === "team_incomplete");
  chk("التعيينُ لا يمنح مسؤولية: الناشرُ لا يُعيَّن مصمّماً", code(await addCampaignMember(exec, A, { marketingMemberId: addOps.ok ? addOps.memberId : "", role: "designer" })) === "capability_required");
  for (const [m, role] of [
    [addOps, "writer"], [addOps, "publisher"], [addLead, "writer"], [addLead, "designer"], [addMember, "designer"], [addExec, "reviewer"],
  ] as const) {
    if (m.ok) await addCampaignMember(exec, A, { marketingMemberId: m.memberId, role });
  }
  chk("مع الفريق: إلى التنفيذ", (await transitionCampaign(exec, A, "in_progress")).ok);
  chk("وتغييرٌ بمراجعةٍ قديمة يُردّ (تزامن)", code(await transitionCampaign(exec, A, "blocked", { reason: "x", expectedRevision: 0 })) === "stale");

  // ── ٤) عزلُ الحملات
  chk("من في حملة أ لا يرى حملة ب", (await campaignWorkspace(ops, B)) === null && (await listCampaigns(ops)).every((c) => c.id !== B));
  const del2 = await createDeliverable(exec, B, { title: "منشور ب", platform: "instagram", formatKey: "square" });
  chk("ولا يكتب فيها باستدعاءٍ مباشر", del2.ok && code(await saveDraft(ops, del2.deliverableId, "اختراق")) === "not_found");
  chk("والغريبُ لا يرى مخرجاً", (await deliverableWorkspace(outsider0, D)) === null);

  // ── ٥) النص: مسودة ← نسخة ← قرار على النسخة بعينها
  chk("الحفظُ ليس تقديماً", (await saveDraft(ops, D, "مسودة أولى")).ok && (await prisma.marketingContentVersion.count({ where: { deliverableId: D } })) === 0);
  chk("المصمّمُ لا يكتب النص", code(await submitContent(member, D, { body: "نصّ" })) === "forbidden");
  const key1 = `${MARK}-v1`;
  const v1 = await submitContent(ops, D, { body: "انضمّ إلى تَـــلاقِ — نلتقي ونفكّر ونصنع", requestId: key1 });
  const v1again = await submitContent(ops, D, { body: "انضمّ إلى تَـــلاقِ — نلتقي ونفكّر ونصنع", requestId: key1 });
  chk("إعادةُ التقديم بالطلب نفسه لا تُنشئ نسخةً ثانية", v1.ok && v1again.ok && v1again.duplicate === true && (await prisma.marketingContentVersion.count({ where: { deliverableId: D } })) === 1);
  if (!v1.ok) throw new Error("stop");
  chk("ومن كتب لا يعتمد ما كتب", code(await decideContent(ops, D, { versionId: v1.versionId, decision: "approved" })) === "separate_approver_required");
  chk("والرفضُ بلا سببٍ مكتوب يُردّ", code(await decideContent(lead, D, { versionId: v1.versionId, decision: "changes_requested" })) === "invalid_input");

  // التزامن: قراران متزامنان على النسخة نفسها — يمرّ واحدٌ فقط
  const [r1, r2] = await Promise.all([
    decideContent(lead, D, { versionId: v1.versionId, decision: "approved" }),
    decideContent(lead, D, { versionId: v1.versionId, decision: "approved" }),
  ]);
  chk("قراران متزامنان: يمرّ أحدهما ويُردّ الآخر", [r1, r2].filter((r) => r.ok).length === 1, `${code(r1)} / ${code(r2)}`);
  chk("ويُسجَّل اعتمادٌ واحد", (await prisma.marketingApproval.count({ where: { deliverableId: D, kind: "content", decision: "approved" } })) === 1);

  // ── ٦) التصميم: على نصٍّ معتمد، بمقاسه، وغيرُ صاحبه يعتمده
  const wrong = await uploadDesign(member, D, { file: { name: "wrong.png", type: "image/png", bytes: await png(1080, 1080) } });
  chk("مقاسٌ غيرُ مطابق يُرفع مسودةً بفحصٍ فاشل", wrong.ok && wrong.checks.some((c) => c.key === "aspect_mismatch" && c.level === "fail"));
  chk("ولا يُقدَّم للمراجعة", wrong.ok && code(await submitDesign(member, D, wrong.versionId)) === "design_checks_failed");
  const low = await uploadDesign(member, D, { file: { name: "low.png", type: "image/png", bytes: await png(540, 960) } });
  chk("الدقةُ الأقلّ من المطلوب تُكشف", low.ok && low.checks.some((c) => c.key === "resolution_low" && c.level === "fail"));
  const goodPng = await png(1080, 1920);
  const corrupt = goodPng.slice(0, Math.floor(goodPng.length / 2));
  chk("الملفُّ التالف يُرفض", code(await uploadDesign(member, D, { file: { name: "bad.png", type: "image/png", bytes: corrupt } })) === "file_corrupt");
  chk("والنوعُ المُعلَن المخالفُ للمحتوى يُرفض", code(await uploadDesign(member, D, { file: { name: "x.jpg", type: "image/jpeg", bytes: goodPng } })) === "file_type");
  chk("والنوعُ غيرُ المسموح يُرفض", code(await uploadDesign(member, D, { file: { name: "x.svg", type: "image/svg+xml", bytes: new TextEncoder().encode("<svg/>") } })) === "file_type");
  const good = await uploadDesign(member, D, { file: { name: "story.png", type: "image/png", bytes: goodPng }, requestId: `${MARK}-d1` });
  chk("المقاسُ الصحيح يجتاز الفحص الآلي", good.ok && good.checks.some((c) => c.key === "dimensions_exact"));
  if (!good.ok) throw new Error("stop");
  chk("الرفعُ وحده لا يغيّر الحالة", (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } })).status === "content_approved");
  chk("وتقديمُه يضعه للمراجعة", (await submitDesign(member, D, good.versionId)).ok);
  chk("ومن صمّم لا يعتمد تصميمه", code(await decideDesign(member, D, { designVersionId: good.versionId, decision: "approved" })) === "separate_approver_required");
  chk("والكاتبُ وحده لا يعتمد التصميم", code(await decideDesign(ops, D, { designVersionId: good.versionId, decision: "approved" })) === "forbidden");
  chk("والمصمّمُ الآخر يعتمده", (await decideDesign(lead, D, { designVersionId: good.versionId, decision: "approved" })).ok);

  // ── ٧) لا نشرَ قبل الجودة، وتغييرُ النص يُسقط اعتمادَ التصميم
  chk("لا نشرَ قبل فحص الجودة", code(await recordPublication(ops, D, { url: "https://instagram.com/p/x", publishedAt: new Date(), confirmedLive: true })) === "invalid_state");
  const v2 = await submitContent(ops, D, { body: "انضمّ إلى تَـــلاقِ اليوم — نلتقي ونفكّر ونصنع" });
  chk("نسخةُ نصٍّ جديدة بعد اعتماد التصميم تعيد المخرج للمراجعة", v2.ok && (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } })).status === "content_review");
  const ws1 = await deliverableWorkspace(ops, D);
  chk("فيسقط اعتمادُ النص القديم واعتمادُ التصميم", !!ws1 && !ws1.facts.contentApproved && !ws1.facts.designApproved && ws1.blockers.includes("design_outdated"));
  chk("ولا يُعتمد النصُّ القديم لتجاوز الجديد", code(await decideContent(lead, D, { versionId: v1.versionId, decision: "approved" })) === "version_not_current");
  chk("والقراراتُ القديمة باقيةٌ في السجلّ مختومةً بإبطالها", (await prisma.marketingApproval.count({ where: { deliverableId: D, invalidatedAt: { not: null } } })) >= 2);
  if (!v2.ok) throw new Error("stop");
  await decideContent(lead, D, { versionId: v2.versionId, decision: "approved" });
  chk("والتصميمُ المبنيُّ على النسخة القديمة لا يُقدَّم", code(await submitDesign(member, D, good.versionId)) === "invalid_state" || code(await submitDesign(member, D, good.versionId)) === "design_not_current_content");

  // المصمّمُ يعيد النص للكاتب، والكاتبُ يُبقيه
  chk("المصمّمُ يعيد النص للكاتب بسبب", (await returnToWriter(member, D, "العنوان طويلٌ على الستوري")).ok);
  chk("والكاتبُ يُبقي النصّ المعتمد", (await keepApprovedContent(ops, D)).ok);

  const d2 = await uploadDesign(member, D, { file: { name: "story2.png", type: "image/png", bytes: await png(1080, 1920, "#341D2B") } });
  if (!d2.ok) throw new Error("stop");
  await submitDesign(member, D, d2.versionId);
  await decideDesign(lead, D, { designVersionId: d2.versionId, decision: "approved" });

  // ── ٨) الجودة
  const writeTask = await createTask(exec, A, { title: "كتابة نص الستوري", kind: "content", deliverableId: D, assigneeId: addOps.ok ? addOps.memberId : null });
  const designTask = await createTask(exec, A, { title: "تصميم الستوري", kind: "design", deliverableId: D, assigneeId: addMember.ok ? addMember.memberId : null, dependsOn: writeTask.ok ? [writeTask.taskId] : [] });
  if (!writeTask.ok || !designTask.ok) throw new Error("stop");
  chk("مهمّةٌ لا تبدأ قبل ما تنتظره", code(await setTaskStatus(member, designTask.taskId, "in_progress")) === "dependency_open");
  chk("ولا تُضاف اعتماديةٌ تصنع حلقة", code(await updateTask(exec, writeTask.taskId, { title: "كتابة نص الستوري", kind: "content", deliverableId: D, dependsOn: [designTask.taskId] })) === "dependency_cycle");
  chk("وغيرُ المُسنَد إليه لا يحرّكها", code(await setTaskStatus(lead, writeTask.taskId, "done")) === "forbidden");
  await setTaskStatus(ops, writeTask.taskId, "done");
  await setTaskStatus(member, designTask.taskId, "done");

  chk("إلى فحص الجودة", (await sendToQuality(member, D)).ok);
  const cur = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } });
  const allPass = QUALITY_ITEMS.map((key) => ({ key, passed: true }));
  chk("بندٌ لم يُجب لا يُجتاز", code(await recordQuality(exec, D, { contentVersionId: cur.currentContentVersionId!, designVersionId: cur.currentDesignVersionId!, items: allPass.slice(1) })) === "invalid_input");
  chk("والكاتبُ لا يفحص", code(await recordQuality(ops, D, { contentVersionId: cur.currentContentVersionId!, designVersionId: cur.currentDesignVersionId!, items: allPass })) === "forbidden");
  const failItems = allPass.map((i) => (i.key === "safe_area_text" ? { ...i, passed: false, note: "النص قريبٌ من الحافة" } : i));
  const qFail = await recordQuality(exec, D, { contentVersionId: cur.currentContentVersionId!, designVersionId: cur.currentDesignVersionId!, items: failItems, note: "أعد ضبط الهوامش" });
  const afterFail = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } });
  chk("فحصٌ فاشلٌ يعيد المخرج للتصميم", qFail.ok && !qFail.passed && afterFail.status === "revision_required" && afterFail.revisionTarget === "design");
  chk("ويعيد فتحَ مهمّة التصميم", (await prisma.marketingTask.findUniqueOrThrow({ where: { id: designTask.taskId } })).status === "todo");

  const d3 = await uploadDesign(member, D, { file: { name: "story3.png", type: "image/png", bytes: await png(1080, 1920, "#0E6B57") } });
  if (!d3.ok) throw new Error("stop");
  await submitDesign(member, D, d3.versionId);
  await decideDesign(lead, D, { designVersionId: d3.versionId, decision: "approved" });
  await sendToQuality(lead, D);
  const cur2 = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } });
  chk("فحصٌ قديمٌ لا يُسجَّل على زوجٍ جديد", code(await recordQuality(exec, D, { contentVersionId: cur.currentContentVersionId!, designVersionId: cur.currentDesignVersionId!, items: allPass })) === "version_not_current");
  const qPass = await recordQuality(exec, D, { contentVersionId: cur2.currentContentVersionId!, designVersionId: cur2.currentDesignVersionId!, items: allPass });
  chk("فحصٌ ناجح: جاهزٌ للنشر", qPass.ok && qPass.passed && (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } })).status === "ready_to_publish");

  // ── ٩) النشر
  chk("لا نشرَ بلا تأكيدٍ أنه حيّ", code(await recordPublication(ops, D, { url: "https://instagram.com/p/abc", publishedAt: new Date(), confirmedLive: false })) === "not_verified");
  chk("ولا برابطٍ غير آمن", code(await recordPublication(ops, D, { url: "http://instagram.com/p/abc", publishedAt: new Date(), confirmedLive: true })) === "url_invalid");
  chk("ولا بوقتٍ في المستقبل", code(await recordPublication(ops, D, { url: "https://instagram.com/p/abc", publishedAt: new Date(Date.now() + 86400_000), confirmedLive: true })) === "invalid_input");
  chk("والمصمّمُ لا ينشر", code(await recordPublication(member, D, { url: "https://instagram.com/p/abc", publishedAt: new Date(), confirmedLive: true })) === "forbidden");
  const pubKey = `${MARK}-pub`;
  const [p1, p2] = await Promise.all([
    recordPublication(ops, D, { url: "https://instagram.com/p/abc", publishedAt: new Date(), confirmedLive: true, requestId: pubKey }),
    recordPublication(ops, D, { url: "https://instagram.com/p/abc", publishedAt: new Date(), confirmedLive: true, requestId: pubKey }),
  ]);
  chk("النشرُ المتكرر بالطلب نفسه يُسجَّل مرّةً واحدة", (await prisma.marketingPublication.count({ where: { deliverableId: D } })) === 1, `${code(p1)} / ${code(p2)}`);
  chk("والمخرجُ منشور — والحملةُ كذلك حين نُشر آخرُ مخرجاتها",
    (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } })).status === "published" &&
    (await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: A } })).status === "published");
  const pubId = p1.ok ? p1.publicationId : p2.ok ? p2.publicationId : "";
  chk("النتائجُ السالبة تُرفض", code(await recordResults(ops, pubId, { metrics: { reach: -5 }, asOf: new Date(), source: "Instagram Insights" })) === "invalid_input");
  chk("والنتائجُ بلا مصدرٍ تُرفض", code(await recordResults(ops, pubId, { metrics: { reach: 100 }, asOf: new Date(), source: "" })) === "invalid_input");
  chk("والنتائجُ الفعلية بمصدرها تُحفظ", (await recordResults(ops, pubId, { metrics: { reach: 1200, engagements: 85 }, asOf: new Date(), source: "Instagram Insights" })).ok);
  chk("ولا كتابةَ بعد النشر", code(await submitContent(ops, D, { body: "تعديل بعد النشر" })) === "campaign_closed");

  // ── ١٠) الملفات وتغييرُ المقاس والإيقاف
  const designFileId = (await prisma.marketingDesignVersion.findUniqueOrThrow({ where: { id: d3.versionId } })).fileId;
  chk("الغريبُ لا يقرأ ملفَّ حملةٍ ليست له", (await readCampaignFile(outsider0, designFileId)) === null && (await readCampaignFile(ops, designFileId)) !== null);

  // حملةُ ب: تغييرُ المقاس يُسقط التصميم واعتمادَه
  if (!del2.ok) throw new Error("stop");
  const DB = del2.deliverableId;
  await updateBrief(exec, B, { name: `${MARK} حملة ب`, objective: "o", audience: "a", keyMessage: "k", deadline: new Date(Date.now() + 86400_000 * 7) });
  await transitionCampaign(exec, B, "briefing");
  await transitionCampaign(exec, B, "ready_for_planning");
  for (const [m, role] of [[addOps, "writer"], [addLead, "writer"], [addLead, "designer"], [addMember, "designer"]] as const) if (m.ok) await addCampaignMember(exec, B, { marketingMemberId: m.memberId, role });
  await transitionCampaign(exec, B, "in_progress");
  const bv1 = await submitContent(ops, DB, { body: "منشورٌ مربع" });
  if (!bv1.ok) throw new Error("stop");
  await decideContent(lead, DB, { versionId: bv1.versionId, decision: "approved" });
  const bd1 = await uploadDesign(member, DB, { file: { name: "sq.png", type: "image/png", bytes: await png(1080, 1080) } });
  if (!bd1.ok) throw new Error("stop");
  await submitDesign(member, DB, bd1.versionId);
  await decideDesign(lead, DB, { designVersionId: bd1.versionId, decision: "approved" });
  chk("تغييرُ المقاس للمنسّق وحده", code(await changeFormat(ops, DB, "portrait")) === "forbidden");
  chk("وتغييرُ المقاس يُسقط التصميمَ واعتمادَه", (await changeFormat(exec, DB, "portrait")).ok && (await deliverableWorkspace(exec, DB))!.blockers.includes("design_missing"));
  chk("والتصميمُ المربعُ لا يُقدَّم للمقاس الرأسي", code(await submitDesign(member, DB, bd1.versionId)) !== "ok");
  chk("الإيقافُ يحتاج سبباً", code(await setDeliverableBlocked(exec, DB, true)) === "invalid_input");
  chk("والمخرجُ الموقوفُ لا يُعمل عليه", (await setDeliverableBlocked(exec, DB, true, "بانتظار حقوق الصورة")).ok && code(await saveDraft(ops, DB, "x")) === "invalid_state");
  chk("ورفعُه يعيده إلى ما كان", (await setDeliverableBlocked(exec, DB, false)).ok && (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: DB } })).status === "content_approved");

  // ── ١١) ما ينتظرني
  const inboxLead = await actionItems(lead);
  chk("قائمةُ «ينتظرني» للمصمّم فيها مخرجُ حملة ب", inboxLead.items.some((i) => i.id === DB && i.kind === "design"));
  chk("ولا تعرض على الكاتب اعتمادَ نصّه هو", !(await actionItems(ops)).items.some((i) => i.kind === "approve_content"));

  // ── ١٢) الإيقافُ وسحبُ المسؤولية فوريّان
  const revoked = addOps.ok ? await setCapabilities(exec, addOps.memberId, ["publisher"]) : { ok: false };
  // في حملة ب لم يكن له إلا الكتابة: بسحبها لا يبقى له فيها دور، فلا يراها أصلاً (أشدّ من «ممنوع»)
  const afterRevoke = await saveDraft(await actorOf(S.ops), DB, "y");
  chk("سحبُ الكتابة يوقفها في كل حملة فوراً — ولا يبقى يرى حملةً لا دورَ له فيها", revoked.ok && code(afterRevoke) === "not_found", code(afterRevoke));
  if (addMember.ok) await setMemberActive(exec, addMember.memberId, false);
  const memberOff = await actorOf(S.member);
  chk("والعضوُ الموقوف لا يدخل ولا يرى", !canEnterMarketing(memberOff) && (await deliverableWorkspace(memberOff, DB)) === null);

  // ── ١٣) سجلُّ التدقيق
  const events = await prisma.marketingEvent.groupBy({ by: ["action"], where: { campaignId: A }, _count: { _all: true } });
  const actions = new Set(events.map((e) => e.action));
  chk("كلُّ مرحلةٍ في السجلّ", ["campaign.created", "content.submitted", "content.approved", "design.approved", "approvals.invalidated", "quality.failed", "quality.passed", "publication.recorded", "task.reopened"].every((a) => actions.has(a)), [...actions].join(","));

  await cleanup();
  const left = await prisma.marketingCampaign.count({ where: { name: { startsWith: "e2e-mk-" } } }) + (await prisma.marketingMember.count({ where: { addedByName: { startsWith: "e2e-mk" } } }));
  chk("لا بقايا بعد الفحص", left === 0);

  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
