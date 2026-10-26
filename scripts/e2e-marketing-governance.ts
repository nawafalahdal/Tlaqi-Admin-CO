import sharp from "sharp";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { marketingActor, canEnterMarketing, hasCapability, type MkActor } from "@/lib/marketing/access";
import { addTeamMember, setCapabilities, updateSettings } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign, listCampaigns, campaignWorkspace } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { submitContent, decideContent } from "@/lib/marketing/content";
import { uploadDesign, submitDesign, decideDesign } from "@/lib/marketing/design";
import { sendToQuality, recordQuality, recordPublication, QUALITY_ITEMS } from "@/lib/marketing/review";
import { submitPlan, decidePlan, campaignPlan, plansAwaiting } from "@/lib/marketing/plan";
import { requestTextSuggestion, processJob, adoptSuggestion, type JobDeps } from "@/lib/marketing/ai/jobs";
import type { TextProvider } from "@/lib/marketing/ai/provider";

/** حوكمةُ وكيل التسويق — أصحابُ القرار وسلسلةُ اعتماد الخطة، على القاعدة المحلية وحدها.
 *
 *  كلُّ فحصٍ هنا يستدعي الخدمةَ كما يستدعيها إجراءُ الخادم (`runMarketingOp`) — بما فيه
 *  معاملاتٌ مصطنعة (مرحلةٌ لا يملكها صاحبُ الطلب، نسخةٌ قديمة)، فلا يُعتمد على أن
 *  الواجهة أخفت الزرّ. والحساباتُ المؤقّتة تُنشأ وتُحذف هنا.
 *
 *  ١) السلطة: قائدُ التسويق من هيكل المنصة؛ والمؤسسُ لا يشارك؛ ولا يرفع أحدٌ صلاحيته.
 *  ٢) الخطة: قائد التسويق ← مسؤول التشغيل ← الرئيس التنفيذي، بالترتيب، على نسخةٍ بعينها،
 *     والردُّ بسببٍ يُبطلها، والتعديلُ يُبطلها، والتنفيذُ لا يبدأ قبلها ولا بالرجوع من إيقاف.
 *  ٣) الوكيل: اقتراحُه مسودةٌ لا نسخةٌ ولا اعتماد.
 *  ٤) النشر: لا قبل الاعتمادات، ودليلُه رابطٌ على منصة المخرج نفسها. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const MARK = `e2e-gv-${Date.now()}`;
const DOMAIN = "@gv.example.test";
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code ?? "?");
const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);
const png = async (w: number, h: number) =>
  new Uint8Array(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#C34900"/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 3}" fill="#EEF6DF"/></svg>`)).png().toBuffer());

async function cleanup() {
  const cs = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: "e2e-gv-" } }, select: { id: true } });
  for (const c of cs) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingEvent.deleteMany({ where: { actorName: { startsWith: "e2e-gv" } } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  await prisma.marketingMember.deleteMany({ where: { OR: [{ addedByName: { startsWith: "e2e-gv" } }, { userId: { in: users.map((u) => u.id) } }] } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const committee = await prisma.department.findFirst({ where: { parentId: marketing.id } });
  const tech = await prisma.department.findFirstOrThrow({ where: { slug: "tech" } });
  const passwordHash = await hashPassword(`${MARK}-x`);
  const mkUser = (key: string, role: "department_admin", departmentId: string) =>
    prisma.user.create({ data: { fullName: `e2e-gv ${key}`, email: `${key}${DOMAIN}`, passwordHash, role, departmentId, isActive: true } });
  const leadU = await mkUser("lead", "department_admin", marketing.id);
  const committeeU = committee ? await mkUser("committee", "department_admin", committee.id) : null;
  const w1U = await mkUser("w1", "department_admin", tech.id);
  const w2U = await mkUser("w2", "department_admin", tech.id);
  const d2U = await mkUser("d2", "department_admin", tech.id);
  const rvU = await mkUser("rv", "department_admin", tech.id);
  const founderU = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const ceoU = await prisma.user.findFirstOrThrow({ where: { email: "exec@fixture.test" } });
  const opsU = await prisma.user.findFirstOrThrow({ where: { email: "ops@fixture.test" } });
  const memberM = await prisma.member.findFirstOrThrow({ where: { email: "member@fixture.test" } });
  for (const w of [{ userId: founderU.id }, { userId: ceoU.id }, { userId: opsU.id }, { memberId: memberM.id }]) {
    if (await prisma.marketingMember.count({ where: w })) throw new Error("حسابُ فحصٍ له عضويةٌ تسويقيةٌ سابقة — نظّفها قبل الفحص");
  }

  const N = (k: string) => `e2e-gv ${k}`;
  const S = {
    founder: asRole(founderU.id, "super_admin", N("founder")),
    lead: asRole(leadU.id, "department_admin", N("lead")),
    committee: committeeU ? asRole(committeeU.id, "department_admin", N("committee")) : null,
    ceo: asRole(ceoU.id, "executive", N("ceo")),
    ops: asRole(opsU.id, "operations_officer", N("ops")),
    w1: asRole(w1U.id, "department_admin", N("w1")),
    w2: asRole(w2U.id, "department_admin", N("w2")),
    d2: asRole(d2U.id, "department_admin", N("d2")),
    rv: asRole(rvU.id, "department_admin", N("rv")),
    member: asRole(memberM.id, "member", N("member")),
  };
  const A = async (s: Session): Promise<MkActor> => (await marketingActor(s))!;

  // ── ١) السلطة من هيكل المنصة
  const founder = await A(S.founder);
  const lead = await A(S.lead);
  chk("قائدُ قسم التسويق يدير الفريق وينسّق — من الهيكل بلا منح", canEnterMarketing(lead) && hasCapability(lead, "manager") && hasCapability(lead, "coordinator") && lead.planStage === "department");
  chk("المؤسسُ لا يدخل الوكيل ولا يدير فريقه", !canEnterMarketing(founder) && !hasCapability(founder, "manager") && founder.planStage === null);
  chk("والمؤسسُ لا ينشئ حملة", code(await createCampaign(founder, { name: `${MARK} f` })) === "founder_excluded");
  chk("ولا يضيف أحداً إلى الفريق", code(await addTeamMember(founder, { kind: "user", id: w1U.id, capabilities: ["writer"] })) === "founder_excluded");
  chk("ولا يغيّر سياسة الاعتماد", code(await updateSettings(founder, { requireSeparateApprover: false })) === "founder_excluded" || code(await updateSettings(founder, { requireSeparateApprover: false })) === "forbidden");
  if (S.committee) {
    const cl = await A(S.committee);
    chk("قائدُ لجنةٍ داخل التسويق ليس قائدَ التسويق", !hasCapability(cl, "manager") && cl.planStage === null);
  }
  const ops = await A(S.ops);
  const ceo = await A(S.ceo);
  chk("مسؤولُ التشغيل والرئيسُ التنفيذي معتمِدا مرحلتَيهما من دورهما", ops.planStage === "operations" && ceo.planStage === "executive" && !hasCapability(ops, "manager") && !hasCapability(ceo, "manager"));

  chk("القائدُ لا يضيف المؤسس", code(await addTeamMember(lead, { kind: "user", id: founderU.id, capabilities: ["writer"] })) === "founder_excluded");
  chk("ولا يمنح «قائد التسويق» لأحد", code(await addTeamMember(lead, { kind: "user", id: w1U.id, capabilities: ["writer", "manager"] })) === "invalid_input");
  chk("ولا يمنح نفسه مسؤولية", code(await addTeamMember(lead, { kind: "user", id: leadU.id, capabilities: ["writer"] })) === "self_escalation");
  const t = {
    w1: await addTeamMember(lead, { kind: "user", id: w1U.id, capabilities: ["writer"] }),
    w2: await addTeamMember(lead, { kind: "user", id: w2U.id, capabilities: ["writer", "publisher"] }),
    d1: await addTeamMember(lead, { kind: "member", id: memberM.id, capabilities: ["designer"] }),
    d2: await addTeamMember(lead, { kind: "user", id: d2U.id, capabilities: ["designer"] }),
    rv: await addTeamMember(lead, { kind: "user", id: rvU.id, capabilities: ["reviewer"] }),
  };
  chk("والقائدُ يبني الفريق بالمسؤوليات", Object.values(t).every((r) => r.ok));
  if (!t.w1.ok || !t.w2.ok || !t.d1.ok || !t.d2.ok || !t.rv.ok) throw new Error("stop team");
  const w1 = await A(S.w1);
  chk("وغيرُ القائد لا يضيف ولا يعدّل", code(await addTeamMember(w1, { kind: "user", id: rvU.id, capabilities: ["writer"] })) === "forbidden" && code(await setCapabilities(w1, t.rv.memberId, ["writer"])) === "forbidden");
  chk("وسياسةُ فصل الاعتماد للقائد", (await updateSettings(lead, { requireSeparateApprover: true })).ok && code(await updateSettings(w1, { requireSeparateApprover: false })) === "forbidden");

  // ── ٢) الحملة والخطة
  const c = await createCampaign(lead, { name: `${MARK} حملة` });
  chk("القائدُ ينشئ الحملة (يُنشأ صفُّه عند أول عمل)", c.ok && !!(await prisma.marketingMember.findUnique({ where: { userId: leadU.id } })));
  if (!c.ok) throw new Error("stop c");
  const C = c.campaignId;
  await transitionCampaign(lead, C, "briefing");
  const brief = { name: `${MARK} حملة`, objective: "تعريف", audience: "طلاب", keyMessage: "نلتقي", deadline: new Date(Date.now() + 9 * 86400_000), channels: ["instagram"] };
  await updateBrief(lead, C, brief);
  const del = await createDeliverable(lead, C, { title: "منشور", platform: "instagram", formatKey: "square" });
  if (!del.ok) throw new Error("stop d");
  const D = del.deliverableId;
  chk("التخطيطُ بعد اكتمال الموجز", (await transitionCampaign(lead, C, "ready_for_planning")).ok);
  for (const [m, role] of [[t.w1, "writer"], [t.w2, "writer"], [t.w2, "publisher"], [t.d1, "designer"], [t.d2, "designer"], [t.rv, "reviewer"]] as const) {
    if (m.ok) await addCampaignMember(lead, C, { marketingMemberId: m.memberId, role });
  }
  chk("لا تنفيذَ قبل اعتماد الخطة — ولو اكتمل الفريق", code(await transitionCampaign(lead, C, "in_progress")) === "plan_not_approved");
  chk("ولا تكتب نصاً قبل التنفيذ", code(await submitContent(w1, D, { body: "نص" })) === "campaign_closed");

  chk("الكاتبُ لا يقدّم الخطة", code(await submitPlan(w1, C)) === "forbidden");
  chk("ولا المؤسس", code(await submitPlan(founder, C)) === "founder_excluded");
  const p1 = await submitPlan(lead, C, { note: "النسخة الأولى" });
  chk("القائدُ يقدّم الخطة — نسخةٌ برقم", p1.ok && p1.number === 1);
  if (!p1.ok) throw new Error("stop p1");
  chk("والتقديمُ المكرَّر بلا تعديلٍ لا يمحو مراحلها", code(await submitPlan(lead, C)) === "plan_live");
  chk("الخطةُ تنتظر قائدَ التسويق وحده", (await plansAwaiting(lead)).some((x) => x.id === C) && !(await plansAwaiting(ops)).some((x) => x.id === C));

  const dec = (a: MkActor, v: string, stage: string, decision: "approved" | "changes_requested" = "approved", note?: string) =>
    decidePlan(a, C, { planVersionId: v, stage, decision, note });
  chk("الترتيب: مسؤولُ التشغيل لا يعتمد قبل القائد", code(await dec(ops, p1.planVersionId, "operations")) === "invalid_state");
  chk("ولا الرئيسُ التنفيذي قبلهما", code(await dec(ceo, p1.planVersionId, "executive")) === "invalid_state");
  chk("مرحلةٌ مصطنعة: مسؤولُ التشغيل يدّعي مرحلة القسم", code(await dec(ops, p1.planVersionId, "department")) === "forbidden");
  chk("والقائدُ يدّعي مرحلة التشغيل", code(await dec(lead, p1.planVersionId, "operations")) === "forbidden");
  chk("والكاتبُ والعضوُ لا مرحلةَ لهما", code(await dec(w1, p1.planVersionId, "department")) === "forbidden" && code(await dec(await A(S.member), p1.planVersionId, "department")) === "forbidden");
  chk("والمؤسسُ لا يعتمد خطة", code(await dec(founder, p1.planVersionId, "executive")) === "founder_excluded");
  chk("القائدُ يعتمد مرحلة القسم", (await dec(lead, p1.planVersionId, "department")).ok);
  chk("ولا تُقرَّر المرحلةُ مرتين", code(await dec(lead, p1.planVersionId, "department")) === "invalid_state");
  chk("الردُّ للتعديل بلا سببٍ يُرفض", code(await dec(ops, p1.planVersionId, "operations", "changes_requested")) === "invalid_input");
  chk("ومسؤولُ التشغيل يردّها بسبب", (await dec(ops, p1.planVersionId, "operations", "changes_requested", "الموعد قريبٌ جداً")).ok);
  const v1 = await prisma.marketingPlanVersion.findUniqueOrThrow({ where: { id: p1.planVersionId }, include: { decisions: true } });
  const back = v1.decisions.find((d) => d.stage === "operations");
  chk("الردُّ يُبطل النسخة ويُحفظ بصاحبه وسببه ووقته ونسخته", !!v1.invalidatedAt && v1.invalidatedReason === "returned_for_revision" && back?.decision === "changes_requested" && back.note === "الموعد قريبٌ جداً" && back.deciderId === opsU.id && back.deciderRole === "operations_officer" && back.planVersionId === v1.id && !!back.createdAt);
  chk("ولا يُعتمد ما رُدّ", code(await dec(ceo, p1.planVersionId, "executive")) === "plan_stale");

  await updateBrief(lead, C, { ...brief, deadline: new Date(Date.now() + 20 * 86400_000) });
  const p2 = await submitPlan(lead, C, { note: "موعدٌ أبعد" });
  if (!p2.ok) throw new Error("stop p2 " + code(p2));
  chk("النسخةُ الأولى تبقى في السجلّ بقرارها", (await prisma.marketingPlanDecision.count({ where: { planVersionId: p1.planVersionId } })) === 2);
  chk("المراحلُ الثلاث بالترتيب على النسخة الثانية", (await dec(lead, p2.planVersionId, "department")).ok && (await dec(ops, p2.planVersionId, "operations")).ok && (await dec(ceo, p2.planVersionId, "executive")).ok);
  chk("الخطةُ معتمدة", !!(await campaignPlan(lead, C))?.approved);

  // التعديلُ بعد الاعتماد يُسقطه
  await updateBrief(lead, C, { ...brief, keyMessage: "نلتقي · نفكّر · نصنع", deadline: new Date(Date.now() + 20 * 86400_000) });
  const v2 = await prisma.marketingPlanVersion.findUniqueOrThrow({ where: { id: p2.planVersionId } });
  chk("تعديلُ الموجز بعد الاعتماد يُبطل الخطة", v2.invalidatedReason === "plan_changed" && code(await transitionCampaign(lead, C, "in_progress")) === "plan_not_approved");
  const p3 = await submitPlan(lead, C);
  if (!p3.ok) throw new Error("stop p3");
  chk("قرارٌ على نسخةٍ قديمة يُرفض", code(await dec(lead, p2.planVersionId, "department")) === "version_not_current");
  await dec(lead, p3.planVersionId, "department");
  await dec(ops, p3.planVersionId, "operations");
  // مخرجٌ جديدٌ قبل الاعتماد الأخير يُبطل النسخة — والرئيسُ يرى «تغيّرت»
  await createDeliverable(lead, C, { title: "ستوري", platform: "instagram", formatKey: "story" });
  chk("إضافةُ مخرجٍ تُبطل نسخةً قيد الاعتماد", code(await dec(ceo, p3.planVersionId, "executive")) === "plan_stale");
  const p4 = await submitPlan(lead, C);
  if (!p4.ok) throw new Error("stop p4");
  for (const [a, s] of [[lead, "department"], [ops, "operations"], [ceo, "executive"]] as const) await dec(a, p4.planVersionId, s);

  // صلاحيةٌ سُحبت: رئيسٌ تنفيذيٌّ نُحّي لا يعتمد
  await prisma.user.update({ where: { id: ceoU.id }, data: { isActive: false } });
  chk("رئيسٌ تنفيذيٌّ نُحّي يفقد مرحلته فوراً", (await A(S.ceo)).planStage === null);
  await prisma.user.update({ where: { id: ceoU.id }, data: { isActive: true } });

  chk("مسؤولُ التشغيل يرى الحملة اطّلاعاً لأن خطتها قُدّمت", (await campaignWorkspace(ops, C)) !== null && (await listCampaigns(ops)).some((x) => x.id === C));
  chk("وتبدأ الحملةُ بعد الاعتمادات الثلاثة", (await transitionCampaign(lead, C, "in_progress")).ok);
  chk("ولا يُعدَّل الموجزُ تحت التنفيذ", code(await updateBrief(lead, C, { ...brief, objective: "هدفٌ آخر" })) === "plan_locked");
  chk("ولا يُضاف مخرجٌ تحت التنفيذ", code(await createDeliverable(lead, C, { title: "متأخّر", platform: "x", formatKey: "landscape" })) === "plan_locked");

  // الرجوعُ من الإيقاف لا يتجاوز الخطة
  await transitionCampaign(lead, C, "blocked", { reason: "انتظار" });
  chk("ولا يُعدَّل وهو موقوفٌ من التنفيذ", code(await updateBrief(lead, C, { ...brief, objective: "هدفٌ آخر" })) === "plan_locked");
  await prisma.marketingPlanVersion.update({ where: { id: p4.planVersionId }, data: { invalidatedAt: new Date(), invalidatedReason: "plan_changed" } });
  chk("رفعُ الإيقاف إلى التنفيذ يُرفض إن بطلت الخطة", code(await transitionCampaign(lead, C, "in_progress")) === "plan_not_approved");
  await prisma.marketingPlanVersion.update({ where: { id: p4.planVersionId }, data: { invalidatedAt: null, invalidatedReason: null } });
  chk("ويُقبل حين تكون معتمدة", (await transitionCampaign(lead, C, "in_progress")).ok);

  // ── ٣) الوكيل: اقتراحُه مسودة
  const fake: TextProvider = { id: "gv-fake", model: "fake", simulated: false, generate: async () => ({ model: "fake", variants: [{ text: "اقتراحٌ آلي", rationale: "—" }] }) };
  const deps: JobDeps = { status: () => ({ state: "ready", provider: "gv-fake", model: "fake", simulated: false, reason: null }), providerFor: () => fake };
  const job = await requestTextSuggestion(w1, D, { requestId: `${MARK}-j` }, deps);
  if (!job.ok) throw new Error("stop job " + code(job));
  await processJob(job.jobId, deps);
  await adoptSuggestion(w1, job.jobId, { variant: 0 });
  const afterAi = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D }, select: { status: true, contentDraft: true } });
  chk("اقتراحُ الوكيل يصير مسودة — بلا نسخةٍ ولا اعتمادٍ ولا تغيير حالة", afterAi.contentDraft === "اقتراحٌ آلي" && afterAi.status === "draft" && (await prisma.marketingContentVersion.count({ where: { deliverableId: D } })) === 0 && (await prisma.marketingApproval.count({ where: { deliverableId: D } })) === 0);
  const ev = await prisma.marketingEvent.findMany({ where: { campaignId: C, action: { startsWith: "job." } }, select: { action: true, actorKind: true } });
  chk("وأعمالُه في السجلّ: الطلبُ والتبنّي باسم صاحبهما، والناتجُ باسم النظام", ev.some((e) => e.action === "job.queued" && e.actorKind === "user") && ev.some((e) => e.action === "job.adopted" && e.actorKind === "user") && ev.some((e) => e.action === "job.succeeded" && e.actorKind === "system"));

  // ── ٤) الاعتمادات البشرية ثم النشر بدليل
  const w2 = await A(S.w2);
  const d1 = await A(S.member);
  const d2 = await A(S.d2);
  const rv = await A(S.rv);
  const cv = await submitContent(w1, D, { body: "اقتراحٌ آلي — بعد مراجعة الكاتب" });
  if (!cv.ok) throw new Error("stop cv");
  chk("الناشرُ لا ينشر قبل الاعتمادات", code(await recordPublication(w2, D, { url: "https://www.instagram.com/p/x", publishedAt: new Date(), confirmedLive: true })) === "invalid_state");
  chk("الكاتبُ لا يعتمد ما كتب", code(await decideContent(w1, D, { versionId: cv.versionId, decision: "approved" })) === "separate_approver_required");
  chk("والمصمّمُ لا يعتمد النص", code(await decideContent(d1, D, { versionId: cv.versionId, decision: "approved" })) === "forbidden");
  chk("وكاتبٌ آخر يعتمد النسخةَ بعينها", (await decideContent(w2, D, { versionId: cv.versionId, decision: "approved" })).ok);
  const dv = await uploadDesign(d1, D, { file: { name: "a.png", type: "image/png", bytes: await png(1080, 1080) } });
  if (!dv.ok) throw new Error("stop dv");
  await submitDesign(d1, D, dv.versionId);
  chk("المصمّمُ لا يعتمد تصميمه", code(await decideDesign(d1, D, { designVersionId: dv.versionId, decision: "approved" })) === "separate_approver_required");
  chk("ومصمّمٌ آخر يعتمده", (await decideDesign(d2, D, { designVersionId: dv.versionId, decision: "approved" })).ok);
  await sendToQuality(d1, D);
  chk("المراجعُ وحده يسجّل الجودة", code(await recordQuality(w2, D, { contentVersionId: cv.versionId, designVersionId: dv.versionId, items: QUALITY_ITEMS.map((key) => ({ key, passed: true })) })) === "forbidden");
  chk("والمراجعُ يسجّلها على النسختين بعينهما", (await recordQuality(rv, D, { contentVersionId: cv.versionId, designVersionId: dv.versionId, items: QUALITY_ITEMS.map((key) => ({ key, passed: true })) })).ok);
  chk("غيرُ الناشر لا يسجّل النشر", code(await recordPublication(w1, D, { url: "https://www.instagram.com/p/x", publishedAt: new Date(), confirmedLive: true })) === "forbidden");
  chk("ولا نشرَ بلا تأكيد رؤيته حيّاً", code(await recordPublication(w2, D, { url: "https://www.instagram.com/p/x", publishedAt: new Date(), confirmedLive: false })) === "not_verified");
  const wrong = await recordPublication(w2, D, { url: "https://example.com/not-instagram", publishedAt: new Date(), confirmedLive: true });
  chk("ولا برابطٍ ليس على منصة المخرج", code(wrong) === "url_platform_mismatch" && !wrong.ok && wrong.params?.platform === "instagram");
  chk("ولا بنطاقٍ يتنكّر باسمها", code(await recordPublication(w2, D, { url: "https://instagram.com.evil.example/p/x", publishedAt: new Date(), confirmedLive: true })) === "url_platform_mismatch");
  chk("وبرابط المنشور نفسه يُسجَّل", (await recordPublication(w2, D, { url: "https://www.instagram.com/p/abc123", publishedAt: new Date(), confirmedLive: true })).ok);

  // ── ٥) السجلّ
  const acts = new Set((await prisma.marketingEvent.findMany({ where: { campaignId: C }, select: { action: true } })).map((e) => e.action));
  chk("كلُّ قرارٍ في السجلّ", ["plan.submitted", "plan.approved", "plan.changes_requested", "plan.invalidated", "content.approved", "design.approved", "quality.passed", "publication.recorded"].every((a) => acts.has(a)), [...acts].filter((a) => a.startsWith("plan.")).join(","));

  await cleanup();
  const left = (await prisma.marketingCampaign.count({ where: { name: { startsWith: "e2e-gv-" } } })) + (await prisma.user.count({ where: { email: { endsWith: DOMAIN } } }));
  chk("لا بقايا بعد الفحص", left === 0);
  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  console.log(checks.join("\n"));
  await prisma.user.updateMany({ where: { email: "exec@fixture.test" }, data: { isActive: true } }).catch(() => {});
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
