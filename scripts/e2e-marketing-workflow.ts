import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import type { ArchiveStore } from "@/lib/marketing/archiveSheet";
import { ARCHIVE_TABS, ARCHIVE_FILE_LABEL, COL, POSTS_TAB } from "@/lib/marketing/archiveLayout";
import { marketingActor, canEnterMarketing, type MkActor } from "@/lib/marketing/access";
import { addTeamMember } from "@/lib/marketing/team";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign, campaignWorkspace } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { saveDraft, submitContent, decideContent } from "@/lib/marketing/content";
import { linkDesign, setDesignDescription, decideDesign } from "@/lib/marketing/design";
import { sendToQuality, recordQuality, recordPublication, QUALITY_ITEMS } from "@/lib/marketing/review";
import { submitPlan, decidePlan, campaignPlan, plansAwaiting } from "@/lib/marketing/plan";
import { archiveBlockers } from "@/lib/marketing/archive";
import { processPostArchive, processDuePostArchives, enqueueMissingPostArchives, retryPostArchive, unseenNotices, markNoticesSeen } from "@/lib/marketing/postArchive";
import { workQueue, workCounts, WORK_PAGE_SIZE, type WorkStage } from "@/lib/marketing/workQueue";
import { sendChatMessage, processChatReply, chatView, assistantView, type ChatDeps } from "@/lib/marketing/ai/chat";
import { transferFromChat } from "@/lib/marketing/ai/chatTransfer";
import { CHAT_RULES, systemPromptFor } from "@/lib/marketing/chatRules";
import type { ChatRequest, ChatResult, TextProvider } from "@/lib/marketing/ai/provider";
import type { AiStatus } from "@/lib/marketing/ai/registry";
import { runAiSelfTest } from "@/lib/marketing/ai/aiSelfTest";
import { GET as aiSelfTestRoute } from "@/app/api/marketing/ai-selftest/route";
import { ar } from "@/i18n/dictionaries/ar";
import { en } from "@/i18n/dictionaries/en";
import { completePlanForTest, finalCheckForTest } from "./marketing-plan-fixture";

/** **مسارُ العمل الجديد للمنشورات** — على القاعدة المحلية وحدها، بلا شبكةٍ ولا تكلفة.
 *
 *  ١) الاعتماد: قائدةُ القسم ثم مسؤولُ التشغيل، كلاهما مطلوب؛ والتنفيذيُّ يطّلع ولا يعتمد.
 *  ٢) المحتوى مرتبطٌ بحملته ورقمِه فيها، ويظهر في «المحتوى» لمن عليه الخطوة.
 *  ٣) التصميمُ رابطاً: إضافتُه وتحديثُه ووصفُه — بصلاحياته.
 *  ٤) الاعتمادُ ثم النشرُ الفعليُّ ثم أرشفةُ المنشور وحده في الملف ثم خروجُه من قوائم العمل.
 *  ٥) تعذّرُ الملف: البياناتُ باقية، والحالةُ ظاهرة، والإعادةُ (آلياً ثم يدوياً) بلا تكرار.
 *  ٦) الإشعار: «تم نشر المنشور الأول في الحملة» — لكل عضوٍ مرّةً واحدة.
 *  ٧) مساعدُ القسم: سياقُه، واستمرارُه، ونقلُ ردّه إلى المسودة ووصفِ التصميم، ولا يعتمد ولا ينشر.
 *  ٨) الأداء: آلافُ المنشورات المؤرشفة لا تُثقل صفحاتِ العمل.
 *
 *  الملفُّ مخزنٌ مُحقَنٌ بواجهة التكامل الحقيقي (`ArchiveStore`)، والمساعدُ مزوّدٌ مُحقَن. والحساباتُ
 *  والحملاتُ مؤقّتةٌ بعلامةٍ وتُحذف هنا. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const MARK = `e2e-wf-${Date.now()}`;
const DOMAIN = "@wf.example.test";
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);
const section = (t: string) => checks.push(`── ${t}`);
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code ?? "?");
const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);

// ── المساعدُ المُحقَن: يسجّل ما طُلب منه، ويردّ بعلامات النقل
const seen: ChatRequest[] = [];
const REPLY = "اقتراحٌ للمنشور:\n---نص---\nنلتقي في ورشة الإبداع — سجّل الآن\n---/نص---\n---وصف التصميم---\nخلفيةٌ بيج وشعارٌ أعلى اليمين\n---/وصف التصميم---";
const provider: TextProvider = {
  id: "test-chat", model: "fake-chat", simulated: false,
  generate: async () => { throw new Error("not used"); },
  chat: async (req): Promise<ChatResult> => { seen.push(req); return { text: REPLY, model: "fake-chat", usage: { inputTokens: 9, outputTokens: 5 } }; },
};
const READY: AiStatus["text"] = { state: "ready", provider: "test-chat", model: "fake-chat", simulated: false, reason: null };
const cdeps: ChatDeps = { status: () => READY, providerFor: (id) => (id === "test-chat" ? provider : null), attemptTimeoutMs: 2000 };

// ── الملفُّ المُحقَن: تبويباتٌ بأسمائها، وفشلٌ يُطلب
class FakeSheet implements ArchiveStore {
  readonly sheet = ARCHIVE_FILE_LABEL;
  tabs = new Map<string, string[][]>();
  appends = 0;
  reads = 0;
  fail: null | "append" | "partial" | "always" = null;
  get rows() { return [...this.tabs.values()].flat(); }
  tab(name: string) { if (!this.tabs.has(name)) this.tabs.set(name, []); return this.tabs.get(name)!; }
  async ensure() { for (const t of ARCHIVE_TABS) this.tab(t.name); return { created: [], fixedHeaders: [] }; }
  async read(tabs: readonly string[], columns: number | Readonly<Record<string, number>>, windows: Partial<Record<string, { from: number; to: number }>> = {}) {
    this.reads++;
    const out: Record<string, string[][]> = {};
    for (const name of tabs) {
      const n = typeof columns === "number" ? columns : columns[name] ?? 0;
      const w = windows[name];
      const all = this.tabs.get(name) ?? [];
      out[name] = (w ? all.slice(w.from, w.to + 1) : all).map((r) => { const v = r.slice(0, n); while (v.length && v[v.length - 1] === "") v.pop(); return v; });
    }
    return out;
  }
  async append(tab: string, rows: string[][]) {
    if (rows.length === 0) return;
    this.appends++;
    if (this.fail === "always") throw Object.assign(new Error("forbidden"), { code: 403 });
    if (this.fail === "append") { this.fail = null; throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); }
    if (this.fail === "partial") {
      this.fail = null;
      this.tab(tab).push(...rows.slice(0, Math.ceil(rows.length / 2)).map((r) => [...r]));
      throw Object.assign(new Error("connection reset mid-write"), { code: "ECONNRESET" });
    }
    this.tab(tab).push(...rows.map((r) => [...r]));
  }
}

async function cleanup() {
  const cs = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: "e2e-wf-" } }, select: { id: true } });
  for (const c of cs) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingPlanningCycle.deleteMany({ where: { campaignName: { startsWith: "e2e-wf-" } } });
  await prisma.marketingEvent.deleteMany({ where: { OR: [{ actorName: { startsWith: "e2e-wf" } }, { campaignId: { in: cs.map((c) => c.id) } }] } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  await prisma.marketingMember.deleteMany({ where: { OR: [{ addedByName: { startsWith: "e2e-wf" } }, { userId: { in: users.map((u) => u.id) } }] } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const tech = await prisma.department.findFirstOrThrow({ where: { slug: "tech" } });
  const passwordHash = await hashPassword(`${MARK}-x`);
  const mkUser = (key: string, role: "department_admin" | "operations_officer" | "executive", departmentId?: string) =>
    prisma.user.create({ data: { fullName: `e2e-wf ${key}`, email: `${key}${DOMAIN}`, passwordHash, role, departmentId, isActive: true } });
  const U = {
    lead: await mkUser("lead", "department_admin", marketing.id),
    ops: await mkUser("ops", "operations_officer"),
    ceo: await mkUser("ceo", "executive"),
    w1: await mkUser("w1", "department_admin", tech.id), w2: await mkUser("w2", "department_admin", tech.id),
    d1: await mkUser("d1", "department_admin", tech.id), d2: await mkUser("d2", "department_admin", tech.id),
    rv: await mkUser("rv", "department_admin", tech.id), pb: await mkUser("pb", "department_admin", tech.id),
    out: await mkUser("out", "department_admin", tech.id),
  };
  const N = (k: string) => `e2e-wf ${k}`;
  const roleOf = (k: string) => (k === "ops" ? "operations_officer" : k === "ceo" ? "executive" : "department_admin");
  const A = async (k: keyof typeof U): Promise<MkActor> => (await marketingActor(asRole(U[k].id, roleOf(k), N(k))))!;
  const lead = await A("lead");
  const team: Record<string, string> = {};
  for (const [k, caps] of [["w1", ["writer"]], ["w2", ["writer"]], ["d1", ["designer"]], ["d2", ["designer"]], ["rv", ["reviewer"]], ["pb", ["publisher"]]] as const) {
    const r = await addTeamMember(lead, { kind: "user", id: U[k].id, capabilities: [...caps] });
    if (!r.ok) throw new Error("team " + k + " " + code(r));
    team[k] = r.memberId;
  }
  const [w1, w2, d1, d2, rv, pb, out, ops, ceo] = await Promise.all((["w1", "w2", "d1", "d2", "rv", "pb", "out", "ops", "ceo"] as const).map(A));

  // ── الحملة: منشوراتٌ برقمٍ ثابتٍ في حملتها
  const c = await createCampaign(lead, { name: `${MARK} حملة الورش`, channels: ["instagram"] });
  const cOther = await createCampaign(lead, { name: `${MARK} حملة أخرى`, channels: ["instagram"] });
  if (!c.ok || !cOther.ok) throw new Error("stop campaign");
  const C = c.campaignId;
  await transitionCampaign(lead, C, "briefing");
  await transitionCampaign(lead, cOther.campaignId, "briefing");
  await updateBrief(lead, C, { name: `${MARK} حملة الورش`, objective: "تسجيلُ الطلاب في الورش", audience: "طلاب الجامعات", keyMessage: "نلتقي ونصنع", channels: ["instagram"], deadline: new Date(Date.now() + 20 * 86400_000) });
  const made = await Promise.all([1, 2, 3].map((n) => createDeliverable(lead, C, { title: `منشور ${n}`, platform: "instagram", formatKey: "square" })));
  const other = await createDeliverable(lead, cOther.campaignId, { title: "منشورٌ في حملةٍ أخرى", platform: "instagram", formatKey: "square" });
  if (made.some((m) => !m.ok) || !other.ok) throw new Error("stop deliverables");
  const ids = made.map((m) => (m.ok ? m.deliverableId : ""));
  const seqs = await prisma.marketingDeliverable.findMany({ where: { id: { in: [...ids, other.deliverableId] } }, select: { id: true, seq: true } });
  const seqOf = (id: string) => seqs.find((s) => s.id === id)?.seq;
  section("١) المحتوى مرتبطٌ بحملته برقمه");
  chk("ثلاثةُ منشوراتٍ أُنشئت معاً تأخذ الأرقام ١ و٢ و٣ في حملتها — بلا تكرارٍ ولو تزامنت", JSON.stringify(ids.map(seqOf).sort()) === JSON.stringify([1, 2, 3]), ids.map(seqOf).join(","));
  chk("وحملةٌ أخرى تبدأ ترقيمَها من ١", seqOf(other.deliverableId) === 1);
  // العناوينُ برقم المنشور كما وُزّع (الإنشاءُ المتزامن لا يضمن ترتيبَ الطلبات) — تهيئةٌ للفحص قبل التخطيط
  for (const id of ids) await prisma.marketingDeliverable.update({ where: { id }, data: { title: `منشور ${seqOf(id)}` } });
  const byNo = (n: number) => ids.find((id) => seqOf(id) === n)!;
  const P1 = byNo(1), P2 = byNo(2), P3 = byNo(3);

  // ── ٢) الاعتماد: القسمُ ثم التشغيل، كلاهما مطلوب — والتنفيذيُّ يطّلع ولا يعتمد
  section("٢) صلاحياتُ الاعتماد: قائدةُ القسم، مسؤولُ التشغيل، التنفيذي");
  await transitionCampaign(lead, C, "ready_for_planning");
  for (const [k, role] of [["w1", "writer"], ["w2", "writer"], ["d1", "designer"], ["d2", "designer"], ["rv", "reviewer"], ["pb", "publisher"]] as const) {
    await addCampaignMember(lead, C, { marketingMemberId: team[k], role });
  }
  await completePlanForTest(lead, C);
  const plan = await submitPlan(lead, C);
  if (!plan.ok) throw new Error("stop plan " + code(plan));
  const dec = (a: MkActor, stage: string) => decidePlan(a, C, { planVersionId: plan.planVersionId, stage, decision: "approved" });
  chk("التنفيذيُّ يدخل الوكيلَ مطّلعاً بلا مرحلة", canEnterMarketing(ceo) && ceo.isOverseer && ceo.planStage === null && !ceo.member);
  chk("ويرى الخطةَ المقدَّمة — ولا تنتظر قراره", (await campaignPlan(ceo, C)) !== null && !(await plansAwaiting(ceo)).some((x) => x.id === C));
  chk("ولا يعتمد بأيّ مرحلة — في الخادم، لا بإخفاء الزرّ وحده", code(await dec(ceo, "executive")) === "invalid_input" && code(await dec(ceo, "department")) === "forbidden" && code(await dec(ceo, "operations")) === "forbidden");
  chk("ولا يرى عملَ الفريق ولا صفحاتِ العمل", JSON.stringify(await workCounts(ceo)) === JSON.stringify({ content: 0, design: 0, publishing: 0 }) && (await workQueue(ceo, "content")).total === 0);
  chk("مسؤولُ التشغيل لا يسبق قائدةَ القسم", code(await dec(ops, "operations")) === "invalid_state");
  chk("والكاتبُ لا مرحلةَ له", code(await dec(w1, "department")) === "forbidden");
  chk("قائدةُ القسم تعتمد مرحلتها", (await dec(lead, "department")).ok);
  chk("واعتمادُها وحده لا يبدأ التنفيذ — المرحلتان مطلوبتان", code(await transitionCampaign(lead, C, "in_progress")) === "plan_not_approved");
  chk("ومسؤولُ التشغيل يعتمد الأخيرة", (await dec(ops, "operations")).ok);
  chk("فيبدأ التنفيذ", (await transitionCampaign(lead, C, "in_progress")).ok);
  const approvals = await prisma.marketingPlanDecision.findMany({ where: { planVersionId: plan.planVersionId }, select: { stage: true, deciderRole: true } });
  chk("والقراران محفوظان بصاحبيهما: department (department_admin) و operations (operations_officer) لا غير", approvals.length === 2 && approvals.some((a) => a.stage === "department" && a.deciderRole === "department_admin") && approvals.some((a) => a.stage === "operations" && a.deciderRole === "operations_officer"));

  // ── ٣) صفحةُ المحتوى: من عليه الخطوة، وحالاتُ المنشور
  section("٣) صفحة المحتوى");
  const item = async (a: MkActor, stage: WorkStage, id: string) => (await workQueue(a, stage)).items.find((i) => i.id === id);
  const q0 = await item(w1, "content", P1);
  chk("المنشورُ في «المحتوى» بحملته ورقمه وعنوانه — والخطوةُ على كاتبه", !!q0 && q0.campaignName.includes("حملة الورش") && q0.seq === 1 && q0.title === "منشور 1" && q0.content === "not_started" && q0.design === "waiting_text" && q0.approval === "not_yet" && q0.ownerRole === "writer" && q0.next === "write" && q0.mine, JSON.stringify(q0 && { cn: q0.campaignName, s: q0.seq, t: q0.title, c: q0.content, d: q0.design, a: q0.approval, o: q0.ownerRole, n: q0.next, m: q0.mine }));
  chk("والغريبُ لا يرى شيئاً", (await workQueue(out, "content")).total === 0 && (await workCounts(out)).content === 0);
  chk("ومنشورُ الحملة الأخرى (لم تبدأ) لا يظهر", !(await workQueue(lead, "content")).items.some((i) => i.id === other.deliverableId));
  await saveDraft(w1, P1, "مسودةٌ أولى");
  chk("بعد المسودة: «قيد الكتابة»", (await item(w1, "content", P1))?.content === "writing");
  const cv1 = await submitContent(w1, P1, { body: "ورشةُ الإبداع يوم الخميس — سجّل الآن", requestId: `${MARK}-c1` });
  if (!cv1.ok) throw new Error("stop cv1 " + code(cv1));
  const q1 = await item(w2, "content", P1);
  chk("بعد التقديم: «قيد المراجعة»، والخطوةُ على كاتبٍ آخر لا على صاحب النص", q1?.content === "in_review" && q1.next === "approve_content" && q1.mine && (await item(w1, "content", P1))?.mine === false);
  chk("وصاحبُ النص لا يعتمده", code(await decideContent(w1, P1, { versionId: cv1.versionId, decision: "approved" })) === "separate_approver_required");
  chk("وكاتبٌ آخر يعتمده", (await decideContent(w2, P1, { versionId: cv1.versionId, decision: "approved" })).ok);
  const q2 = await item(d1, "design", P1);
  chk("فينتقل إلى «التصميم»: النصُّ معتمَد والتصميمُ مطلوبٌ من مصمّمه", !(await item(w1, "content", P1)) && q2?.content === "approved" && q2.design === "needed" && q2.next === "add_design" && q2.mine && q2.ownerRole === "designer");

  // ── ٤) رابطُ التصميم: إضافةٌ وتحديثٌ ووصف
  section("٤) رابط التصميم ووصفه");
  chk("الكاتبُ لا يضيف تصميماً", code(await linkDesign(w1, P1, { url: "https://www.canva.com/design/DAF1/view" })) === "forbidden");
  chk("ورابطٌ من غير المصادر المسموحة يُرفض", code(await linkDesign(d1, P1, { url: "https://example.com/design.png" })) === "url_invalid" && code(await linkDesign(d1, P1, { url: "javascript:alert(1)" })) === "url_invalid");
  const l1 = await linkDesign(d1, P1, { url: "https://www.canva.com/design/DAF1/view", description: "خلفيةٌ برتقالية وعنوانٌ كبير", requestId: `${MARK}-dl1` });
  if (!l1.ok) throw new Error("stop l1 " + code(l1));
  const l1again = await linkDesign(d1, P1, { url: "https://www.canva.com/design/DAF1/view", requestId: `${MARK}-dl1` });
  const v1 = await prisma.marketingDesignVersion.findUniqueOrThrow({ where: { id: l1.versionId } });
  chk("المصمّمُ يضيف الرابط بوصفه — نسخةٌ برقمها، بلا ملف، وفحصُها «رابط»", l1.number === 1 && v1.linkUrl === "https://www.canva.com/design/DAF1/view" && v1.fileId === null && v1.description === "خلفيةٌ برتقالية وعنوانٌ كبير" && JSON.stringify(v1.checks).includes("design_link"));
  chk("والطلبُ المكرَّر لا يُنشئ نسخةً ثانية", l1again.ok && l1again.duplicate === true && l1again.versionId === l1.versionId && (await prisma.marketingDesignVersion.count({ where: { deliverableId: P1 } })) === 1);
  chk("والوصفُ صار وصفَ تصميم المنشور", (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P1 } })).designDescription === "خلفيةٌ برتقالية وعنوانٌ كبير");
  chk("والكاتبُ لا يغيّر الوصف، والمصمّمُ يغيّره", code(await setDesignDescription(w1, P1, "x")) === "forbidden" && (await setDesignDescription(d1, P1, "خلفيةٌ بيج وشعارٌ أعلى اليمين")).ok);
  const l2 = await linkDesign(d1, P1, { url: "https://drive.google.com/file/d/abc123/view", changeNote: "نسخةٌ بالألوان الرسمية", submit: true, requestId: `${MARK}-dl2` });
  if (!l2.ok) throw new Error("stop l2 " + code(l2));
  const v2 = await prisma.marketingDesignVersion.findUniqueOrThrow({ where: { id: l2.versionId } });
  const p1d = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P1 } });
  chk("تحديثُ الرابط نسخةٌ ثانية — والأولى باقيةٌ في السجلّ", l2.number === 2 && v2.linkUrl === "https://drive.google.com/file/d/abc123/view" && v2.changeNote === "نسخةٌ بالألوان الرسمية" && (await prisma.marketingDesignVersion.count({ where: { deliverableId: P1 } })) === 2);
  chk("وتحمل الوصفَ الحاليَّ إن لم يُكتب غيرُه، وتُقدَّم للمراجعة", v2.description === "خلفيةٌ بيج وشعارٌ أعلى اليمين" && p1d.status === "design_review" && p1d.currentDesignVersionId === v2.id);
  const q3 = await item(d2, "design", P1);
  chk("وفي «التصميم»: «قيد المراجعة» على مصمّمٍ آخر", q3?.design === "in_review" && q3.next === "approve_design" && q3.mine);
  chk("ومصمّمٌ آخر يعتمده", code(await decideDesign(d1, P1, { designVersionId: v2.id, decision: "approved" })) === "separate_approver_required" && (await decideDesign(d2, P1, { designVersionId: v2.id, decision: "approved" })).ok);
  chk("ثم «أرسل للجودة»", (await item(d1, "design", P1))?.next === "send_quality" && (await sendToQuality(d1, P1)).ok);

  // ── ٥) «الاعتماد والنشر»: الجودة ثم الفحص الأخير ثم النشر الفعلي
  section("٥) الاعتماد ← النشر ← الأرشفة");
  const q4 = await item(rv, "publishing", P1);
  chk("في «الاعتماد والنشر»: فحصُ الجودة على المراجع — ومعه النصُّ ورابطُ التصميم ووصفُه", q4?.approval === "quality" && q4.next === "quality" && q4.mine && q4.text?.includes("ورشةُ الإبداع") === true && q4.designLink === "https://drive.google.com/file/d/abc123/view" && q4.designDescription === "خلفيةٌ بيج وشعارٌ أعلى اليمين");
  chk("وصفحتا المحتوى والتصميم لا تحملان النصَّ ولا الروابط (ما يلزم الصفحةَ وحدها)", (await item(lead, "design", P2)) === undefined || (await item(lead, "design", P2))?.text === undefined);
  const pair = { contentVersionId: p1d.currentContentVersionId!, designVersionId: v2.id };
  chk("المراجعُ يجتاز الجودة", (await recordQuality(rv, P1, { ...pair, items: QUALITY_ITEMS.map((key) => ({ key, passed: true })) })).ok);
  chk("ثم الفحصُ الأخير على الناشر", (await item(pb, "publishing", P1))?.next === "final_check");
  await finalCheckForTest(pb, P1);
  chk("ثم «انشر»", (await item(pb, "publishing", P1))?.next === "publish" && (await item(pb, "publishing", P1))?.approval === "ready");
  chk("غيرُ الناشر لا يسجّل النشر", code(await recordPublication(w1, P1, { url: "https://www.instagram.com/p/wf1/", publishedAt: new Date(), confirmedLive: true })) === "forbidden");
  chk("ولا «منشور» بلا تأكيد رؤيته حيّاً", code(await recordPublication(pb, P1, { url: "https://www.instagram.com/p/wf1/", publishedAt: new Date(), confirmedLive: false })) === "not_verified");
  chk("ولا برابطٍ على منصةٍ أخرى", !(await recordPublication(pb, P1, { url: "https://www.tiktok.com/@x/video/1", publishedAt: new Date(), confirmedLive: true })).ok);
  chk("ولا أرشفةَ قبل النشر الفعلي", (await prisma.marketingPostArchive.count({ where: { deliverableId: P1 } })) === 0);
  const pub1 = await recordPublication(pb, P1, { url: "https://www.instagram.com/p/wf1/", publishedAt: new Date(), confirmedLive: true, requestId: `${MARK}-pub1`, timezone: "Asia/Riyadh" });
  const pub1again = await recordPublication(pb, P1, { url: "https://www.instagram.com/p/wf1/", publishedAt: new Date(), confirmedLive: true, requestId: `${MARK}-pub1`, timezone: "Asia/Riyadh" });
  if (!pub1.ok) throw new Error("stop pub1 " + code(pub1));
  const pa1 = await prisma.marketingPostArchive.findUniqueOrThrow({ where: { deliverableId: P1 } });
  chk("النشرُ المؤكَّد يطلب أرشفةَ المنشور في المعاملة نفسها — طلبٌ واحدٌ ولو تكرّر التسجيل", pub1.postArchiveId === pa1.id && pa1.status === "pending" && pub1again.ok && (await prisma.marketingPostArchive.count({ where: { deliverableId: P1 } })) === 1 && (await prisma.marketingPublication.count({ where: { deliverableId: P1 } })) === 1);
  const q5 = await item(pb, "publishing", P1);
  chk("ويبقى في «الاعتماد والنشر» «قيد الأرشفة» حتى تتحقّق — لا يُعدّ مؤرشفاً قبلها", q5?.approval === "archiving" && q5.ownerRole === "system" && q5.postUrl === "https://www.instagram.com/p/wf1/" && !(await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P1 } })).archivedAt);
  chk("وأرشفةُ الحملة كلِّها تنتظره", (await archiveBlockers(prisma, C, new Date())).includes("post_archive_pending"));

  // ── ٦) تعذّرُ الملف: لا فقد، والحالةُ ظاهرة، والإعادةُ بلا تكرار
  section("٦) تعذّر Google Sheets ← إعادةٌ آمنة بلا تكرار");
  const sheet = new FakeSheet();
  let clock = new Date();
  const deps = () => ({ store: sheet, now: () => clock });
  const later = (min: number) => { clock = new Date(clock.getTime() + min * 60_000); };
  chk("بلا ملفٍّ مهيّأ: يُعاد لاحقاً، ولا يُفقد شيء", (await processPostArchive(pa1.id, { store: null, now: () => clock })) === "retry_scheduled" && (await prisma.marketingPostArchive.findUniqueOrThrow({ where: { id: pa1.id } })).lastError === "store_unavailable");
  later(5);
  sheet.fail = "append";
  chk("انقطاعُ الكتابة: «يُعاد»، والمنشورُ باقٍ في القائمة بسببه", (await processPostArchive(pa1.id, deps())) === "retry_scheduled" && (await item(pb, "publishing", P1))?.approval === "archiving" && (await item(pb, "publishing", P1))?.archiveError === "sheet_timeout" && sheet.rows.length === 0);
  chk("ولا يُعاد قبل موعده", (await processPostArchive(pa1.id, deps())) === "not_claimed");
  const storedRows = JSON.stringify((await prisma.marketingPostArchive.findUniqueOrThrow({ where: { id: pa1.id } })).rows);
  later(30);
  sheet.fail = "partial";
  chk("انقطاعٌ في منتصف الكتابة: نصفُ الصفوف كُتب، ولا خروجَ من القائمة", (await processPostArchive(pa1.id, deps())) === "retry_scheduled" && sheet.rows.length > 0 && !(await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P1 } })).archivedAt);
  const half = sheet.rows.length;
  later(120);
  const okRun = await processPostArchive(pa1.id, deps());
  const pa1done = await prisma.marketingPostArchive.findUniqueOrThrow({ where: { id: pa1.id } });
  const keys = sheet.rows.map((r) => r[COL.key]);
  chk("ثم تنجح: كُتب الناقصُ وحده، وقُرئ وطابق", okRun === "completed" && pa1done.status === "completed" && sheet.rows.length > half && pa1done.verifiedRows === sheet.rows.length && pa1done.expectedRows === sheet.rows.length, `${okRun} ${pa1done.verifiedRows}/${sheet.rows.length}`);
  chk("بلا صفٍّ مكرَّر — والصفوفُ نفسُها في كل محاولة (بُنيت مرّةً وحُفظت)", new Set(keys).size === keys.length && JSON.stringify(pa1done.rows) === storedRows && pa1done.attempts === 4);
  chk("ومعالجتُه ثانيةً لا تكتب شيئاً", (await processPostArchive(pa1.id, deps())) === "not_claimed" && sheet.rows.length === keys.length);
  const postRow = sheet.tab(POSTS_TAB.name).find((r) => r[COL.key] === `${C}:post:${P1}`);
  const at = POSTS_TAB.at;
  chk("صفُّ «الأرشيف — المنشورات» يحمل كلَّ التفاصيل: الحملة، الرقم، النص، رابطُ التصميم ووصفُه، الاعتمادات ومن اعتمد، التواريخ، الرابطُ النهائي",
    !!postRow && postRow[at.campaign].includes("حملة الورش") && postRow[at.seq] === "1" && postRow[at.finalText].includes("ورشةُ الإبداع") && postRow[at.designLink] === "https://drive.google.com/file/d/abc123/view" && postRow[at.designDescription] === "خلفيةٌ بيج وشعارٌ أعلى اليمين" && postRow[at.designVersion] === "2" && postRow[at.contentApproval].startsWith("e2e-wf w2") && postRow[at.designApproval].startsWith("e2e-wf d2") && postRow[at.quality].includes("e2e-wf rv") && postRow[at.finalCheck].startsWith("e2e-wf pb") && postRow[at.publisher] === "e2e-wf pb" && postRow[at.publishedAt].length >= 16 && postRow[at.postUrl] === "https://www.instagram.com/p/wf1/" && postRow[at.timezone] === "Asia/Riyadh" && postRow[at.runId] === pa1.id);
  chk("وكلُّ صفٍّ في تبويبه بمعرّفٍ ثابت — والمعرّفُ الفريد للمنشور يمنع التكرار", sheet.tab(POSTS_TAB.name).length === 1 && sheet.rows.every((r) => r[COL.key].startsWith(`${C}:`) && r[COL.campaignId] === C));

  // ── ٧) يخرج من قوائم العمل، ويُبلَّغ الفريقُ مرّةً واحدة
  section("٧) الخروج من القوائم والإشعار مرّةً واحدة");
  const p1after = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P1 } });
  const inAny = async (a: MkActor, id: string) => (await Promise.all((["content", "design", "publishing"] as const).map((s) => item(a, s, id)))).some(Boolean);
  chk("بعد التحقّق وحده: مؤرشفٌ، وخارجٌ من الصفحات الثلاث لكل أحد", !!p1after.archivedAt && !(await inAny(lead, P1)) && !(await inAny(pb, P1)));
  chk("وبياناتُه باقيةٌ في المنصة (لا حذفَ قبل أرشفة الحملة)، وتظهر في «المنشورات المؤرشفة» بالحملة", (await prisma.marketingDeliverable.count({ where: { id: P1 } })) === 1 && !!(await campaignWorkspace(lead, C))?.campaign.deliverables.find((d) => d.id === P1)?.archivedAt);
  chk("ولا يمنع أرشفةَ الحملة بعدها", !(await archiveBlockers(prisma, C, new Date())).includes("post_archive_pending") || (await prisma.marketingDeliverable.count({ where: { campaignId: C, status: "published", archivedAt: null } })) > 0);
  const nW1 = (await unseenNotices(w1)).filter((n) => n.kind === "post_archived" && n.params.seq === 1);
  chk("كلُّ عضوٍ في الحملة يُبلَّغ: «تم نشر المنشور الأول في الحملة» — بالحملة والعنوان والرابط", nW1.length === 1 && nW1[0].params.campaign?.includes("حملة الورش") === true && nW1[0].params.title === "منشور 1" && nW1[0].params.url === "https://www.instagram.com/p/wf1/" && (await unseenNotices(d2)).some((n) => n.kind === "post_archived"), JSON.stringify(await unseenNotices(w1)));
  chk("ولا يُبلَّغ من ليس في الحملة (التشغيل والتنفيذي والغريب)", (await unseenNotices(ops)).length === 0 && (await unseenNotices(ceo)).length === 0 && (await unseenNotices(out)).length === 0);
  chk("وقراءةُ الإشعارات لا تكتب (عرضُ الصفحة لا يعلّمها)", (await unseenNotices(w1)).length === (await unseenNotices(w1)).length && (await unseenNotices(w1)).some((n) => n.id === nW1[0].id));
  chk("وغيرُ صاحبه لا يعلّمه مقروءاً", (await markNoticesSeen(w2, nW1.map((n) => n.id))) === 0);
  chk("ويظهر مرّةً واحدة: بعد عرضه لا يعود", (await markNoticesSeen(w1, nW1.map((n) => n.id))) === 1 && !(await unseenNotices(w1)).some((n) => n.id === nW1[0].id) && (await markNoticesSeen(w1, nW1.map((n) => n.id))) === 0);
  chk("ونصُّه بالترتيب في العربية والإنجليزية", typeof ar.mk.notices.ordinals?.[0] === "string" && ar.mk.notices.ordinals[0].includes("الأول") && typeof en.mk.notices.ordinals?.[0] === "string" && en.mk.notices.ordinals[0].toLowerCase().includes("first"));

  // ── ٨) فشلٌ نهائيٌّ بعد المحاولات الآلية ← إعادةٌ يدوية بصلاحيتها ← بلا تكرار
  section("٨) فشلٌ نهائي ثم إعادةٌ يدوية");
  // المنشورُ الثاني بالمسار نفسه حتى النشر
  await saveDraft(w1, P2, "نصٌّ ثانٍ");
  const cv2 = await submitContent(w1, P2, { body: "المنشورُ الثاني: آخرُ موعدٍ للتسجيل", requestId: `${MARK}-c2` });
  if (!cv2.ok) throw new Error("stop cv2");
  await decideContent(w2, P2, { versionId: cv2.versionId, decision: "approved" });
  const l3 = await linkDesign(d1, P2, { url: "https://www.canva.com/design/DAF2/view", description: "تصميمُ الموعد", submit: true, requestId: `${MARK}-dl3` });
  if (!l3.ok) throw new Error("stop l3");
  await decideDesign(d2, P2, { designVersionId: l3.versionId, decision: "approved" });
  await sendToQuality(d1, P2);
  const p2d = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P2 } });
  await recordQuality(rv, P2, { contentVersionId: p2d.currentContentVersionId!, designVersionId: l3.versionId, items: QUALITY_ITEMS.map((key) => ({ key, passed: true })) });
  await finalCheckForTest(pb, P2);
  const pub2 = await recordPublication(pb, P2, { url: "https://www.instagram.com/p/wf2/", publishedAt: new Date(), confirmedLive: true, requestId: `${MARK}-pub2` });
  if (!pub2.ok || !pub2.postArchiveId) throw new Error("stop pub2");
  const pa2 = pub2.postArchiveId;
  sheet.fail = "always";
  let last = "";
  for (let i = 0; i < 8; i++) { later(3 * 24 * 60); last = await processPostArchive(pa2, deps()); }
  const pa2failed = await prisma.marketingPostArchive.findUniqueOrThrow({ where: { id: pa2 } });
  const q6 = await item(pb, "publishing", P2);
  chk("بعد ثماني محاولاتٍ آلية: «تعذّرت الأرشفة» بسببها — والمنشورُ باقٍ ظاهرٌ في القائمة", last === "failed" && pa2failed.status === "failed" && pa2failed.lastError === "sheet_permission" && q6?.approval === "archive_failed" && q6.next === "retry_archive" && q6.archiveError === "sheet_permission" && !(await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P2 } })).archivedAt);
  chk("ولا يُعاد آلياً بعدها", (await processDuePostArchives({ campaignId: C }, deps())).length === 0);
  chk("والإعادةُ اليدوية للناشر والمنسّق — والزرُّ لهما وحدهما", code(await retryPostArchive(w1, P2)) === "forbidden" && code(await retryPostArchive(out, P2)) === "not_found" && q6?.mine === true && (await item(w1, "publishing", P2))?.mine === false);
  sheet.fail = null;
  chk("الناشرُ يعيدها", (await retryPostArchive(pb, P2)).ok && (await prisma.marketingPostArchive.findUniqueOrThrow({ where: { id: pa2 } })).status === "pending");
  chk("ولا تُعاد مرّتين معاً", code(await retryPostArchive(pb, P2)) === "invalid_state");
  const due = await processDuePostArchives({ campaignId: C }, deps());
  const keys2 = sheet.rows.map((r) => r[COL.key]);
  chk("فتكتمل في الكنس التالي — بلا تكرارٍ لصفوف المنشور الأول ولا الثاني", JSON.stringify(due) === JSON.stringify(["completed"]) && new Set(keys2).size === keys2.length && sheet.tab(POSTS_TAB.name).length === 2 && !!(await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P2 } })).archivedAt);
  const n2 = (await unseenNotices(w1)).filter((n) => n.kind === "post_archived" && n.params.seq === 2);
  chk("والإشعارُ الثاني: «المنشور الثاني»", n2.length === 1 && ar.mk.notices.ordinals[1].includes("الثاني"));

  // منشورٌ نُشر قبل هذه الآلية بلا طلب أرشفة — يُطلب له في الكنس، مرّةً واحدة (في حملة الفحص وحدها)
  const legacy = await prisma.marketingDeliverable.create({ data: { campaignId: C, title: "منشورٌ قديم", platform: "instagram", formatKey: p2d.formatKey, formatRevision: p2d.formatRevision, width: p2d.width, height: p2d.height, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0, status: "published", seq: 99 } });
  const enq1 = await enqueueMissingPostArchives(20, clock, C);
  const enq2 = await enqueueMissingPostArchives(20, clock, C);
  chk("الكنسُ يطلب أرشفةَ ما نُشر بلا طلب — ولا يكرّره", enq1 === 1 && enq2 === 0 && (await prisma.marketingPostArchive.count({ where: { deliverableId: legacy.id } })) === 1, `${enq1}/${enq2}`);
  const legacyPa = (await prisma.marketingPostArchive.findUniqueOrThrow({ where: { deliverableId: legacy.id } })).id;
  chk("ومنشورٌ «منشور» بلا رابط نشرٍ مسجَّل لا يُؤرشف على أنه منشور — يُقال سببه", (await processPostArchive(legacyPa, deps())) === "failed" && (await prisma.marketingPostArchive.findUniqueOrThrow({ where: { id: legacyPa } })).lastError === "not_published" && !(await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: legacy.id } })).archivedAt);
  await prisma.marketingDeliverable.delete({ where: { id: legacy.id } });

  // ── ٩) مساعدُ القسم: سياقٌ واستمرار ونقل — ولا اعتمادَ ولا نشر
  section("٩) مساعد القسم (Claude) ونقلُ ردّه");
  const scopeW1 = { kind: "assistant" as const, campaignId: C, deliverableId: P3, ownerId: team.w1 };
  chk("كلُّ عضوٍ في الفريق له مساعده — والغريبُ والتنفيذيُّ ومسؤولُ التشغيل لا", (await assistantView(w1, C, P3, cdeps)) !== null && (await assistantView(out, null, null, cdeps)) === null && (await assistantView(ceo, null, null, cdeps)) === null && (await assistantView(ops, null, null, cdeps)) === null);
  const s1 = await sendChatMessage(w1, scopeW1, { body: "اكتب نصّاً لهذا المنشور", requestId: `${MARK}-a1` }, cdeps);
  if (!s1.ok) throw new Error("stop assistant " + code(s1));
  chk("رسالةٌ وردّ", (await processChatReply(s1.replyId, cdeps)) === "done");
  const req1 = seen.at(-1)!;
  chk("بتعليمات المساعد: لا يعتمد ولا ينشر ولا يدّعي تنفيذاً", req1.system === systemPromptFor("assistant") && CHAT_RULES.assistant.mayNot.some((m) => m.includes("اعتماد")) && CHAT_RULES.assistant.mayNot.some((m) => m.includes("ادّعاءُ تنفيذ")));
  chk("وسياقُه الحملةُ والمنشورُ المختاران — بلا بريدٍ ولا أسماءٍ ولا حملةٍ أخرى", req1.context.includes("حملة الورش") && req1.context.includes("منشور 3") && !req1.context.includes("@") && !req1.context.includes("e2e-wf w2") && !req1.context.includes("حملة أخرى"));
  const s2 = await sendChatMessage(w1, scopeW1, { body: "اجعله أقصر", requestId: `${MARK}-a2` }, cdeps);
  if (!s2.ok) throw new Error("stop assistant 2");
  await processChatReply(s2.replyId, cdeps);
  const req2 = seen.at(-1)!;
  chk("والمحادثةُ مستمرّة: الرسالةُ الثانية تحمل الأولى وردَّها", s2.threadId === s1.threadId && req2.history.some((h) => h.role === "user" && h.text.includes("اكتب نصّاً")) && req2.history.some((h) => h.role === "assistant" && h.text.includes("---نص---")));
  chk("ومحادثةُ المساعد لصاحبها وحده", (await chatView(w2, scopeW1, cdeps)) === null && code(await sendChatMessage(w2, scopeW1, { body: "?", requestId: `${MARK}-a3` }, cdeps)) === "not_found");
  const draftBefore = (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P3 } })).contentDraft;
  const versionsBefore = await prisma.marketingContentVersion.count({ where: { deliverableId: P3 } });
  chk("غيرُ صاحب المحادثة لا ينقل ردَّها", code(await transferFromChat(w2, s1.replyId, "draft", P3)) === "not_found");
  chk("ولا يُنقل إلى منشورٍ غيرِ الذي في سياقها", code(await transferFromChat(w1, s1.replyId, "draft", P2)) === "invalid_input");
  chk("والكاتبُ ينقل النصَّ إلى مسودة المحتوى بضغطة — النصُّ المعلَّم وحده", (await transferFromChat(w1, s1.replyId, "draft", P3)).ok && (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P3 } })).contentDraft.includes("نلتقي في ورشة الإبداع — سجّل الآن") && !(await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P3 } })).contentDraft.includes("---"));
  chk("والنقلُ مسودةٌ لا نسخةٌ ولا تقديمٌ ولا اعتماد", draftBefore === "" && (await prisma.marketingContentVersion.count({ where: { deliverableId: P3 } })) === versionsBefore && (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P3 } })).status === "draft" && (await prisma.marketingApproval.count({ where: { deliverableId: P3 } })) === 0);
  await transferFromChat(w1, s2.replyId, "draft", P3);
  chk("ونقلٌ ثانٍ يُضاف تحت فاصل — لا يمحو ما كُتب", (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P3 } })).contentDraft.includes("———"));
  chk("والكاتبُ لا ينقل وصفَ التصميم (ليس مصمّماً)", code(await transferFromChat(w1, s1.replyId, "design", P3)) === "forbidden");
  const sd = await sendChatMessage(d1, { kind: "assistant", campaignId: C, deliverableId: P3, ownerId: team.d1 }, { body: "صِف تصميماً لهذا المنشور", requestId: `${MARK}-a4` }, cdeps);
  if (!sd.ok) throw new Error("stop assistant d1");
  chk("ردٌّ لم يكتمل لا يُنقل", code(await transferFromChat(d1, sd.replyId, "design", P3)) === "invalid_state");
  await processChatReply(sd.replyId, cdeps);
  chk("والمصمّمُ ينقل وصفَ التصميم إلى صفحة التصميم", (await transferFromChat(d1, sd.replyId, "design", P3)).ok && (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P3 } })).designDescription === "خلفيةٌ بيج وشعارٌ أعلى اليمين");
  chk("والنقلُ مسجَّلٌ في السجلّ", (await prisma.marketingEvent.count({ where: { campaignId: C, action: "chat.transferred" } })) === 3);
  const sNo = await sendChatMessage(w1, { kind: "assistant", campaignId: null, ownerId: team.w1 }, { body: "رتّب لي أفكاراً لحملةٍ قادمة", requestId: `${MARK}-a5` }, cdeps);
  if (sNo.ok) await processChatReply(sNo.replyId, cdeps);
  chk("وبلا حملةٍ مختارة: لا سياقَ من أي حملة", sNo.ok && !seen.at(-1)!.context.includes("حملة الورش"));

  // فحصُ Claude الحقيقي (المعاينة وحدها): مسارُه غيرُ موجودٍ في الإنتاج ولا محلياً، والفحصُ نفسُه يجتاز بمزوّدٍ سليم ويُبلغ بالفشل
  const envKeys = ["VERCEL", "VERCEL_ENV"] as const;
  const envBefore = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  process.env.VERCEL = "1"; process.env.VERCEL_ENV = "production";
  const inProd = (await aiSelfTestRoute()).status;
  delete process.env.VERCEL; delete process.env.VERCEL_ENV;
  const inDev = (await aiSelfTestRoute()).status;
  for (const k of envKeys) { if (envBefore[k] === undefined) delete process.env[k]; else process.env[k] = envBefore[k]; }
  chk("ومسارُ فحص Claude الحقيقي غيرُ موجودٍ في الإنتاج ولا محلياً (404)", inProd === 404 && inDev === 404, `${inProd}/${inDev}`);
  let firstText = "";
  const echo: TextProvider = {
    id: "echo", model: "fake", simulated: false, generate: async () => { throw new Error("x"); },
    chat: async (req, signal) => {
      if (req.history.length === 0 && req.message.includes("تجربة مهلة")) await new Promise((r, j) => signal?.addEventListener("abort", () => j(new Error("aborted"))));
      const text = req.history.length ? (firstText.split(/\s+/)[0] ?? "") : (firstText = "نلتقي في الورشة التجريبية — تجربة");
      return { text, model: "fake", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const st = await runAiSelfTest({ env: { ANTHROPIC_API_KEY: " sk-ant-x " }, provider: echo });
  chk("والفحصُ الحقيقيُّ نفسُه: رسالةٌ وردّ، فاستمرارُ السياق، فمهلةٌ تُصنَّف ولا تُعدّ نجاحاً", st.ok && st.steps.map((s) => s.name).join(",") === "message_and_reply,context_kept,timeout_is_classified", JSON.stringify(st.steps.map((s) => [s.name, s.ok])));
  chk("ولا يعيد من المفتاح شيئاً — تشخيصٌ منطقيٌّ وحده", !JSON.stringify(st).includes("sk-ant-x") && st.diagnostics.keyPresent && st.diagnostics.keyHadWhitespace);
  const stNoKey = await runAiSelfTest({ env: {} });
  chk("وبلا مفتاحٍ يقول «لا مفتاح» — لا يدّعي نجاحاً", !stNoKey.ok && stNoKey.reason === "no_key");

  // ── ١٠) الأداء: آلافُ المنشورات المؤرشفة لا تُثقل صفحاتِ العمل
  section("١٠) الأداء مع سجلٍّ كبير");
  const time = async <T,>(fn: () => Promise<T>) => { const t0 = performance.now(); const r = await fn(); return { r, ms: Math.round(performance.now() - t0) }; };
  const before = await time(() => Promise.all([workCounts(w1), workQueue(w1, "publishing"), workQueue(w1, "content")]));
  const HISTORY = 3000;
  const base = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: P1 } });
  const histCampaigns = 30;
  for (let k = 0; k < histCampaigns; k++) {
    const hc = await prisma.marketingCampaign.create({ data: { name: `${MARK} تاريخ ${k}`, status: "in_progress", ownerId: base.writerId ?? team.w1, channels: ["instagram"] } });
    await prisma.marketingCampaignMember.create({ data: { campaignId: hc.id, memberId: team.w1, role: "writer" } });
    const archivedAt = new Date(Date.now() - (k + 1) * 86400_000);
    await prisma.marketingDeliverable.createMany({
      data: Array.from({ length: HISTORY / histCampaigns }, (_, i) => ({
        campaignId: hc.id, title: `منشورٌ مؤرشف ${k}-${i}`, platform: "instagram", formatKey: base.formatKey, formatRevision: base.formatRevision,
        width: base.width, height: base.height, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0, status: "published" as const, seq: i + 1, archivedAt,
      })),
    });
    // ومنشورٌ واحدٌ جارٍ في كل حملةٍ منها
    await prisma.marketingDeliverable.create({ data: { campaignId: hc.id, title: `منشورٌ جارٍ ${k}`, platform: "instagram", formatKey: base.formatKey, formatRevision: base.formatRevision, width: base.width, height: base.height, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0, status: "draft", seq: HISTORY / histCampaigns + 1 } });
  }
  await prisma.$executeRawUnsafe(`ANALYZE "MarketingDeliverable"`);
  const after = await time(() => Promise.all([workCounts(w1), workQueue(w1, "publishing"), workQueue(w1, "content")]));
  const [countsAfter, pubAfter, contentAfter] = after.r;
  chk(`${HISTORY} منشورٍ مؤرشف لا يظهر منها شيءٌ في صفحات العمل`, pubAfter.items.every((i) => !i.title.startsWith("منشورٌ مؤرشف")) && contentAfter.items.every((i) => !i.title.startsWith("منشورٌ مؤرشف")));
  chk("والجاري منها وحده يُعدّ — صفحةٌ من عشرين لا كلُّ السجلّ", countsAfter.content === before.r[0].content + histCampaigns && contentAfter.items.length === WORK_PAGE_SIZE && contentAfter.pages === Math.ceil(contentAfter.total / WORK_PAGE_SIZE), `${countsAfter.content}/${contentAfter.items.length}/${contentAfter.pages}`);
  chk(`وزمنُ الصفحات الثلاث معاً محدود: ${before.ms}ms قبل السجلّ ← ${after.ms}ms بعده (الحدّ ١٥٠٠ms)`, after.ms < 1500);
  const plan2 = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN SELECT count(*) FROM "MarketingDeliverable" WHERE "archivedAt" IS NULL AND "status" IN ('quality_review','ready_to_publish','published')`);
  chk("والعدُّ يستعمل فهرسَ (archivedAt, status) لا مسحَ الجدول كلِّه", plan2.some((p) => /MarketingDeliverable_archivedAt_status_idx/.test(p["QUERY PLAN"])), plan2.map((p) => p["QUERY PLAN"]).join(" | ").slice(0, 160));
  const notices = await time(() => unseenNotices(w1));
  chk("والإشعاراتُ محدودةٌ بخمسة", notices.r.length <= 5);

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.filter((x) => x.startsWith("✓")).length})`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.log(checks.join("\n"));
  console.error(e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
