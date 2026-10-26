import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { marketingActor, type MkActor } from "@/lib/marketing/access";
import { addTeamMember, setCapabilities } from "@/lib/marketing/team";
import { submitPlan, decidePlan } from "@/lib/marketing/plan";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign } from "@/lib/marketing/campaigns";
import { createDeliverable, setDeliverableBlocked } from "@/lib/marketing/deliverables";
import { saveDraft } from "@/lib/marketing/content";
import { ProviderError, type TextProvider, type TextResult } from "@/lib/marketing/ai/provider";
import { aiStatus, type AiStatus } from "@/lib/marketing/ai/registry";
import { simulatedProvider, SIMULATED_MARK } from "@/lib/marketing/ai/simulated";
import {
  requestTextSuggestion, processJob, processDue, cancelJob, retryJob, adoptSuggestion, deliverableJobs, DAILY_QUOTA, type JobDeps,
} from "@/lib/marketing/ai/jobs";

/** طابورُ التوليد — على القاعدة المحلية وحدها، بمزوّدٍ مُحقَنٍ لا يتصل بأحد.
 *
 *  البوّابة (غيرُ مهيّأ، وغيرُ الكاتب)، وتكرارُ الطلب، والحجزُ المتزامن، والإعادةُ
 *  بتأخيرٍ بلا تكرار، والفشلُ النهائيّ، والمهلةُ التي لا تصير نجاحاً، والحجزُ
 *  المنقضي، والإلغاء، وسحبُ الصلاحية في الطريق، والتبنّي الذي لا يُنشئ نسخة —
 *  وأن الفشلَ لا يمسّ المسودة أبداً. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const MARK = `e2e-mkj-${Date.now()}`;
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code ?? "?");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);
const actorOf = async (s: Session): Promise<MkActor> => (await marketingActor(s))!;

// مزوّدٌ مُحقَن: سلوكُه دالّةٌ في رقم الاستدعاء — ويعدّ الاستدعاءات (أي التكلفة)
type Behaviour = (call: number, signal?: AbortSignal) => Promise<TextResult>;
let behaviour: Behaviour = async () => ({ model: "fake-model", variants: [{ text: "اقتراح", rationale: "سبب" }] });
let calls = 0;
const fakeProvider: TextProvider = { id: "test-fake", model: "fake-model", simulated: false, generate: (_req, signal) => behaviour(++calls, signal) };
const READY: AiStatus["text"] = { state: "ready", provider: "test-fake", model: "fake-model", simulated: false, reason: null };
const deps: JobDeps = { status: () => READY, providerFor: (id) => (id === "test-fake" ? fakeProvider : null) };
const reply = (text: string, n = 2): TextResult => ({ model: "fake-model", variants: Array.from({ length: n }, (_, i) => ({ text: `${text} ${i + 1}`, rationale: "سبب" })) });
const later = (ms: number): JobDeps => ({ ...deps, now: () => new Date(Date.now() + ms) });

async function cleanup() {
  const campaigns = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: "e2e-mkj-" } }, select: { id: true } });
  for (const c of campaigns) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingEvent.deleteMany({ where: { actorName: { startsWith: "e2e-mkj" } } });
  await prisma.marketingMember.deleteMany({ where: { addedByName: { startsWith: "e2e-mkj" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@mkj.example.test" } } });
}

(async () => {
  await cleanup();
  const founderU = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const execU = await prisma.user.findFirstOrThrow({ where: { email: "exec@fixture.test" } });
  const opsU = await prisma.user.findFirstOrThrow({ where: { email: "ops@fixture.test" } });
  const leadU = await prisma.user.findFirstOrThrow({ where: { email: "lead@fixture.test" } });
  const outsiderU = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: "department_admin", email: { not: "lead@fixture.test" }, department: { slug: { not: "marketing" } } },
  });
  for (const p of [execU.id, opsU.id, leadU.id, outsiderU.id]) {
    if (await prisma.marketingMember.count({ where: { userId: p } })) throw new Error("حسابُ فحصٍ له عضويةٌ تسويقية سابقة — احذفها قبل الفحص");
  }
  const N = (who: string) => `e2e-mkj ${who}`;
  void founderU;
  // الفريقُ يبنيه قائدُ التسويق (قائدُ قسم التسويق — حسابٌ مؤقّت)، لا المؤسس
  const marketingDept = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const mkLeadU = await prisma.user.create({
    data: { fullName: "e2e-mkj قائد التسويق", email: "mklead@mkj.example.test", passwordHash: "x", role: "department_admin", departmentId: marketingDept.id, isActive: true },
  });
  const mkLead = await actorOf(asRole(mkLeadU.id, "department_admin", N("mklead")));
  const addExec = await addTeamMember(mkLead, { kind: "user", id: execU.id, capabilities: ["coordinator"] });
  const exec = await actorOf(asRole(execU.id, "executive", N("exec")));
  const addOps = await addTeamMember(mkLead, { kind: "user", id: opsU.id, capabilities: ["writer"] });
  const addLead = await addTeamMember(mkLead, { kind: "user", id: leadU.id, capabilities: ["designer"] });
  if (!addExec.ok || !addOps.ok || !addLead.ok) throw new Error("fixture: team");
  const S_ops = asRole(opsU.id, "operations_officer", N("ops"));
  const ops = await actorOf(S_ops);
  const ops0 = ops;
  const lead = await actorOf(asRole(leadU.id, "department_admin", N("lead")));
  const outsider = await actorOf(asRole(outsiderU.id, "department_admin", N("outsider")));

  const c = await createCampaign(exec, { name: `${MARK} حملة`, channels: ["instagram"] });
  if (!c.ok) throw new Error("fixture: campaign");
  const A = c.campaignId;
  await transitionCampaign(exec, A, "briefing");
  await updateBrief(exec, A, { name: `${MARK} حملة`, objective: "تعريفٌ بالمنصة", audience: "طلاب الجامعات", keyMessage: "نلتقي ونفكّر ونصنع", deadline: new Date(Date.now() + 14 * 86400_000), channels: ["instagram"] });
  const del = await createDeliverable(exec, A, { title: "ستوري الإطلاق", platform: "instagram", formatKey: "story" });
  if (!del.ok) throw new Error("fixture: deliverable");
  const D = del.deliverableId;
  await transitionCampaign(exec, A, "ready_for_planning");
  await addCampaignMember(exec, A, { marketingMemberId: addOps.memberId, role: "writer" });
  await addCampaignMember(exec, A, { marketingMemberId: addLead.memberId, role: "designer" });
  // التنفيذُ بعد اعتماد الخطة بمراحلها الثلاث، كلٌّ بيد صاحبه
  const plan = await submitPlan(exec, A);
  if (!plan.ok) throw new Error("fixture: plan " + code(plan));
  for (const [a, stage] of [[mkLead, "department"], [ops0, "operations"], [exec, "executive"]] as const) {
    const r = await decidePlan(a, A, { planVersionId: plan.planVersionId, stage, decision: "approved" });
    if (!r.ok) throw new Error(`fixture: plan ${stage} ${code(r)}`);
  }
  const go = await transitionCampaign(exec, A, "in_progress");
  if (!go.ok) throw new Error("fixture: in_progress " + code(go));
  await saveDraft(ops, D, "مسودة الكاتب");
  const draftOf = async () => (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D }, select: { contentDraft: true } })).contentDraft;
  const jobOf = (id: string) => prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id } });
  const versions = () => prisma.marketingContentVersion.count({ where: { deliverableId: D } });
  let k = 0;
  const key = () => `${MARK}-${++k}`;

  // ── ١) البوّابة
  chk("بلا إعداد: «غيرُ مهيّأ» — ولا مهمّةَ تُحفظ", code(await requestTextSuggestion(ops, D, { requestId: key() })) === "integration_not_configured" && (await prisma.marketingGenerationJob.count({ where: { deliverableId: D } })) === 0);
  chk("وحالةُ الإعداد المحليّ الفعلية «غيرُ مهيّأ»", aiStatus().text.state !== "ready");
  chk("المصمّمُ لا يطلب نصاً", code(await requestTextSuggestion(lead, D, { requestId: key() }, deps)) === "forbidden");
  chk("ومن خارج الحملة لا يراها", code(await requestTextSuggestion(outsider, D, { requestId: key() }, deps)) === "not_found");
  chk("ولا طلبَ بلا مفتاح تكرار", code(await requestTextSuggestion(ops, D, {}, deps)) === "invalid_input");

  // ── ٢) الطلبُ وتكرارُه
  calls = 0;
  const k1 = key();
  const r1 = await requestTextSuggestion(ops, D, { requestId: k1, instructions: "أقصر", variants: 9, locale: "ar" }, deps);
  const r1b = await requestTextSuggestion(ops, D, { requestId: k1 }, deps);
  chk("الطلبُ يُحفظ «في الانتظار»", r1.ok && (await jobOf(r1.ok ? r1.jobId : "")).status === "queued");
  chk("والطلبُ نفسُه مرةً ثانية لا يُنشئ مهمّةً ثانية", r1.ok && r1b.ok && r1b.jobId === r1.jobId && !!r1b.duplicate && (await prisma.marketingGenerationJob.count({ where: { deliverableId: D } })) === 1);
  if (!r1.ok) throw new Error("stop");
  const J1 = await jobOf(r1.jobId);
  const in1 = J1.input as { draft: string; variants: number; brief: { keyMessage: string } };
  chk("ومدخلاتُه محفوظةٌ لحظةَ الطلب — والعددُ محدود", in1.draft === "مسودة الكاتب" && in1.variants === 3 && in1.brief.keyMessage === "نلتقي ونفكّر ونصنع");
  chk("ومهمّةٌ نشطةٌ واحدةٌ لكل مخرج", code(await requestTextSuggestion(ops, D, { requestId: key() }, deps)) === "job_active");
  chk("ولم يُستدعَ المزوّد بعد", calls === 0);

  // ── ٣) الحجزُ المتزامن: عاملان، استدعاءٌ واحد
  behaviour = async (n) => {
    await sleep(150);
    return reply(`اقتراح-${n}`);
  };
  const [o1, o2] = await Promise.all([processJob(r1.jobId, deps), processJob(r1.jobId, deps)]);
  const after1 = await jobOf(r1.jobId);
  chk("عاملان معاً: واحدٌ يعالج والآخر لا يحجز", [o1, o2].sort().join(",") === "not_claimed,succeeded", `${o1},${o2}`);
  chk("والمزوّدُ استُدعي مرةً واحدة", calls === 1);
  chk("والناتجُ محفوظ", after1.status === "succeeded" && (after1.result as { variants: unknown[] }).variants.length === 2 && after1.attempts === 1);
  chk("والمسودةُ لم تُمسّ ولا نسخةَ أُنشئت", (await draftOf()) === "مسودة الكاتب" && (await versions()) === 0);
  chk("ومعالجةُ المنتهية لا تستدعي المزوّد", (await processJob(r1.jobId, deps)) === "not_claimed" && calls === 1);

  // ── ٤) التبنّي: في المسودة وحدها
  chk("المصمّمُ لا يتبنّى", code(await adoptSuggestion(lead, r1.jobId, { variant: 0 })) === "forbidden");
  chk("ونسخةٌ غيرُ موجودة تُرفض", code(await adoptSuggestion(ops, r1.jobId, { variant: 7 })) === "invalid_input");
  const statusBefore = (await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } })).status;
  chk("الكاتبُ يتبنّى نسخة", (await adoptSuggestion(ops, r1.jobId, { variant: 1 })).ok);
  const dAfter = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: D } });
  chk("فتصير مسودته — بلا نسخةٍ ولا اعتمادٍ ولا تغييرِ حالة", dAfter.contentDraft === "اقتراح-1 2" && (await versions()) === 0 && dAfter.status === statusBefore && (await prisma.marketingApproval.count({ where: { deliverableId: D } })) === 0);
  chk("والتبنّي مختوم", !!(await jobOf(r1.jobId)).adoptedAt);

  // ── ٥) مسودةٌ تغيّرت بعد الطلب لا تُستبدل إلا بتأكيد
  const r2 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r2.ok) throw new Error("stop r2 " + code(r2));
  await saveDraft(ops, D, "عدّلتُ بعد الطلب");
  behaviour = async () => reply("ثانٍ");
  await processJob(r2.jobId, deps);
  chk("مسودةٌ تغيّرت: لا تُستبدل بصمت", code(await adoptSuggestion(ops, r2.jobId, { variant: 0 })) === "draft_changed" && (await draftOf()) === "عدّلتُ بعد الطلب");
  chk("وبالتأكيد تُستبدل", (await adoptSuggestion(ops, r2.jobId, { variant: 0, replaceEdited: true })).ok && (await draftOf()) === "ثانٍ 1");

  // ── ٦) فشلٌ مؤقت: إعادةٌ بتأخير، بلا تكرار
  await saveDraft(ops, D, "مسودة ثابتة");
  calls = 0;
  behaviour = async (n) => {
    if (n === 1) throw new ProviderError("rate_limited", "429");
    return reply("بعد الإعادة");
  };
  const r3 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r3.ok) throw new Error("stop r3");
  chk("٤٢٩: تُجدول إعادة", (await processJob(r3.jobId, deps)) === "retry_scheduled");
  const j3 = await jobOf(r3.jobId);
  chk("في الانتظار بموعدٍ لاحقٍ وسببٍ مسمّى", j3.status === "queued" && j3.error === "rate_limited" && j3.attempts === 1 && !!j3.nextAttemptAt && j3.nextAttemptAt > new Date());
  chk("ولا تُعالَج قبل موعدها", (await processJob(r3.jobId, deps)) === "not_claimed" && calls === 1);
  chk("وتُعالَج بعده", (await processJob(r3.jobId, later(15 * 60_000))) === "succeeded" && calls === 2);
  const j3b = await jobOf(r3.jobId);
  chk("ناتجٌ واحدٌ بمحاولتين — والمسودةُ لم تُمسّ", j3b.attempts === 2 && j3b.status === "succeeded" && (await draftOf()) === "مسودة ثابتة");

  // ── ٧) فشلٌ نهائيّ: لا إعادة
  calls = 0;
  behaviour = async () => {
    throw new ProviderError("refused", "policy");
  };
  const r4 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r4.ok) throw new Error("stop r4");
  chk("الرفضُ يُنهي المهمّة فاشلةً من أول مرة", (await processJob(r4.jobId, deps)) === "failed" && (await jobOf(r4.jobId)).error === "refused" && calls === 1);
  chk("ولا تُعاد يدوياً", code(await retryJob(ops, r4.jobId, deps)) === "job_not_retryable");
  chk("والمسودةُ كما هي", (await draftOf()) === "مسودة ثابتة");

  // ── ٨) استنفادُ المحاولات ثم إعادةٌ يدوية
  calls = 0;
  behaviour = async () => {
    throw new ProviderError("unavailable", "500");
  };
  const r5 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r5.ok) throw new Error("stop r5");
  const outs: string[] = [];
  for (let i = 0; i < 4; i++) outs.push(await processJob(r5.jobId, later((i + 1) * 15 * 60_000)));
  chk("٥٠٠ متكرّر: إعادتان ثم فشل — ثلاثُ محاولاتٍ لا أكثر", outs.join(",") === "retry_scheduled,retry_scheduled,failed,not_claimed" && calls === 3, outs.join(","));
  chk("وغيرُ الكاتب لا يعيدها", code(await retryJob(lead, r5.jobId, deps)) === "forbidden");
  behaviour = async () => reply("بعد الإعادة اليدوية");
  chk("والكاتبُ يعيدها محاولةً واحدةً إضافية", (await retryJob(ops, r5.jobId, deps)).ok && (await jobOf(r5.jobId)).maxAttempts === 4);
  chk("فتنجح", (await processJob(r5.jobId, deps)) === "succeeded" && calls === 4);
  chk("والمنتهيةُ لا تُعاد", code(await retryJob(ops, r5.jobId, deps)) === "invalid_state");

  // ── ٩) المهلة لا تصير نجاحاً
  calls = 0;
  let lateResolved = false;
  behaviour = async () => {
    await sleep(400); // يتجاهل الإلغاء عمداً
    lateResolved = true;
    return reply("متأخّر");
  };
  const r6 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r6.ok) throw new Error("stop r6");
  const o6 = await processJob(r6.jobId, { ...deps, attemptTimeoutMs: 100 });
  await sleep(500);
  const j6 = await jobOf(r6.jobId);
  chk("انقضاءُ المهلة: إعادةٌ مجدولة لا نجاح", o6 === "retry_scheduled" && j6.status === "queued" && j6.error === "timeout" && j6.result === null);
  chk("والناتجُ المتأخّر لا يُكتب", lateResolved && (await jobOf(r6.jobId)).result === null);
  await cancelJob(ops, r6.jobId);

  // ── ١٠) حجزٌ منقضٍ: عاملٌ آخر يستأنف، ونتيجةُ الأول تُرمى
  calls = 0;
  behaviour = async (n) => {
    if (n === 1) await sleep(400);
    return reply(`عامل-${n}`);
  };
  const r7 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r7.ok) throw new Error("stop r7");
  const slow = processJob(r7.jobId, deps);
  await sleep(100);
  // العاملُ الأول «انقطع»: حجزُه انقضى
  await prisma.marketingGenerationJob.update({ where: { id: r7.jobId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
  const fast = await processJob(r7.jobId, deps);
  const slowOut = await slow;
  const j7 = await jobOf(r7.jobId);
  chk("الثاني يستأنف بعد انقضاء الحجز", fast === "succeeded" && j7.attempts === 2);
  chk("ونتيجةُ الأول المتأخّرة تُرمى", slowOut === "discarded" && (j7.result as { variants: { text: string }[] }).variants[0].text === "عامل-2 1");

  // ── ١١) الإلغاء: قبل البدء وفي أثنائه
  calls = 0;
  const r8 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r8.ok) throw new Error("stop r8");
  chk("غيرُ الكاتب لا يلغي", code(await cancelJob(lead, r8.jobId)) === "forbidden");
  chk("الإلغاءُ قبل البدء: لا استدعاء", (await cancelJob(ops, r8.jobId)).ok && (await processJob(r8.jobId, deps)) === "not_claimed" && calls === 0);
  behaviour = async () => {
    await sleep(300);
    return reply("بعد الإلغاء");
  };
  const r9 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r9.ok) throw new Error("stop r9");
  const running = processJob(r9.jobId, deps);
  await sleep(80);
  const cancelled = await cancelJob(ops, r9.jobId);
  const o9 = await running;
  const j9 = await jobOf(r9.jobId);
  chk("الإلغاءُ في أثنائه: الناتجُ يُرمى", cancelled.ok && o9 === "discarded" && j9.status === "cancelled" && j9.result === null);

  // ── ١٢) ما يتغيّر في الطريق يوقف التكلفة
  calls = 0;
  behaviour = async () => reply("لا يُفترض");
  const r10 = await requestTextSuggestion(ops, D, { requestId: key() }, deps);
  if (!r10.ok) throw new Error("stop r10");
  await setCapabilities(mkLead, addOps.memberId, ["coordinator"]);
  const o10 = await processJob(r10.jobId, deps);
  chk("سحبُ الكتابة من الطالب: تُلغى بلا استدعاء", o10 === "cancelled" && (await jobOf(r10.jobId)).error === "requester_revoked" && calls === 0);
  await setCapabilities(mkLead, addOps.memberId, ["writer"]);
  const opsAgain = await actorOf(S_ops);
  const r11 = await requestTextSuggestion(opsAgain, D, { requestId: key() }, deps);
  if (!r11.ok) throw new Error("stop r11 " + code(r11));
  await setDeliverableBlocked(exec, D, true, "مانعٌ للفحص");
  chk("مخرجٌ أُوقف: تُلغى بلا استدعاء", (await processJob(r11.jobId, deps)) === "cancelled" && (await jobOf(r11.jobId)).error === "deliverable_closed" && calls === 0);
  chk("ولا طلبَ على مخرجٍ موقوف", code(await requestTextSuggestion(opsAgain, D, { requestId: key() }, deps)) === "invalid_state");
  await setDeliverableBlocked(exec, D, false);

  // ── ١٣) مزوّدٌ زال بين الطلب والمعالجة
  const r12 = await requestTextSuggestion(opsAgain, D, { requestId: key() }, deps);
  if (!r12.ok) throw new Error("stop r12");
  chk("مزوّدٌ لم يعد مهيّأً: تفشل «غيرَ مهيّأ» بلا استدعاء", (await processJob(r12.jobId, { ...deps, providerFor: () => null })) === "failed" && (await jobOf(r12.jobId)).error === "not_configured");

  // ── ١٤) المحاكاةُ معلَّمة
  const simEnv = { NODE_ENV: "development", MARKETING_AI_PROVIDER: "simulated" };
  const simDeps: JobDeps = { status: () => aiStatus(simEnv).text, providerFor: (id) => (id === "simulated" ? simulatedProvider() : null) };
  const r13 = await requestTextSuggestion(opsAgain, D, { requestId: key() }, simDeps);
  if (!r13.ok) throw new Error("stop r13 " + code(r13));
  await processJob(r13.jobId, simDeps);
  const j13 = await jobOf(r13.jobId);
  const res13 = j13.result as { simulated: boolean; variants: { text: string }[] };
  chk("ناتجُ المحاكاة معلَّمٌ في المهمّة وفي كل نسخة", j13.provider === "simulated" && res13.simulated && res13.variants.every((v) => v.text.startsWith(SIMULATED_MARK)));

  // ── ١٥) القائمة والمتابعة والحصّة
  const list = await deliverableJobs(opsAgain, D);
  chk("الكاتبُ يرى مهامّه ويطلب", !!list && list.canRequest && list.jobs.length === 10);
  const listLead = await deliverableJobs(lead, D);
  chk("والمصمّمُ يرى ولا يطلب", !!listLead && !listLead.canRequest);
  chk("ومن خارج الحملة لا يرى", (await deliverableJobs(outsider, D)) === null);
  behaviour = async () => reply("متابعة");
  const r14 = await requestTextSuggestion(opsAgain, D, { requestId: key() }, deps);
  if (!r14.ok) throw new Error("stop r14");
  const due = await processDue({ deliverableId: D }, deps);
  chk("المتابعةُ تعالج ما حان لهذا المخرج", due.join(",") === "succeeded" && (await jobOf(r14.jobId)).status === "succeeded");
  const used = await prisma.marketingGenerationJob.count({ where: { requestedById: addOps.memberId } });
  await prisma.marketingGenerationJob.createMany({
    data: Array.from({ length: DAILY_QUOTA - used }, (_, i) => ({
      deliverableId: D, kind: "text" as const, provider: "test-fake", status: "succeeded" as const, input: {}, idempotencyKey: `${MARK}-q${i}`, requestedById: addOps.memberId,
    })),
  });
  chk(`الحصّةُ اليومية (${DAILY_QUOTA}) تُوقف الطلب`, code(await requestTextSuggestion(opsAgain, D, { requestId: key() }, deps)) === "job_quota");

  // ── ١٦) السجلّ
  const events = await prisma.marketingEvent.findMany({ where: { campaignId: A, action: { startsWith: "job." } }, select: { action: true, actorKind: true } });
  const acts = new Set(events.map((e) => e.action));
  chk("كلُّ مرحلةٍ في السجلّ", ["job.queued", "job.succeeded", "job.failed", "job.cancelled", "job.retried", "job.adopted"].every((a) => acts.has(a)), [...acts].join(","));
  chk("ونتائجُ الخلفية باسم النظام لا باسم أحد", events.filter((e) => e.action === "job.succeeded").every((e) => e.actorKind === "system"));

  await cleanup();
  const left =
    (await prisma.marketingCampaign.count({ where: { name: { startsWith: "e2e-mkj-" } } })) +
    (await prisma.marketingMember.count({ where: { addedByName: { startsWith: "e2e-mkj" } } })) +
    (await prisma.marketingGenerationJob.count({ where: { idempotencyKey: { startsWith: MARK } } }));
  chk("لا بقايا بعد الفحص", left === 0);

  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  console.log(checks.join("\n"));
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
