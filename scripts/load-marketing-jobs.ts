import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { marketingActor, type MkActor } from "@/lib/marketing/access";
import { addTeamMember } from "@/lib/marketing/team";
import { submitPlan, decidePlan } from "@/lib/marketing/plan";
import { createCampaign, updateBrief, addCampaignMember, transitionCampaign } from "@/lib/marketing/campaigns";
import { createDeliverable } from "@/lib/marketing/deliverables";
import { ProviderError, type TextProvider, type TextResult } from "@/lib/marketing/ai/provider";
import type { AiStatus } from "@/lib/marketing/ai/registry";
import { requestTextSuggestion, processJob, processDue, cancelJob, retryJob, DAILY_QUOTA, type JobDeps } from "@/lib/marketing/ai/jobs";

/** طابورُ التوليد تحت التزامن — على القاعدة المحلية وحدها، بمزوّدٍ مُحقَنٍ لا يتصل بأحد.
 *
 *  ليس اختبارَ حملٍ للإنتاج: قاعدةٌ محليةٌ واحدة، وعمّالٌ داخل عمليةٍ واحدة، ومزوّدٌ
 *  وهميٌّ بتأخيرٍ ثابت. يثبت السلامةَ تحت السباق (لا تكرار، لا ضياع، لا كتابةَ لعاملٍ
 *  فقد حجزه)، لا السعةَ ولا زمنَ الاستجابة في Vercel.
 *
 *  ١) مفتاحُ التكرار: طلباتٌ متزامنةٌ بالمفتاح نفسه ← مهمّةٌ واحدة.
 *  ٢) مهمّةٌ نشطةٌ واحدةٌ لكل مخرج: طلباتٌ متزامنةٌ بمفاتيح مختلفة ← واحدةٌ تُقبل.
 *  ٣) الحصّةُ اليومية تحت السباق لا تُتجاوز.
 *  ٤) الحجز: عمّالٌ متزامنون على المهامّ نفسها ← كلُّ مهمّةٍ تُعالَج مرةً واحدة.
 *  ٥) عمّالُ `processDue` متوازون على طابورٍ كبير ← لا تكرار ولا ضياع.
 *  ٦) حجزٌ انقضى: عاملٌ ثانٍ يستأنف، ونتيجةُ الأول تُرمى.
 *  ٧) إلغاءٌ أثناء التشغيل: الناتجُ يُرمى ولا يُكتب.
 *  ٨) إعادةٌ بتأخيرٍ متزايد ثم نجاح؛ واستنفادُ المحاولات فشلٌ نهائي.
 *  ٩) عاملٌ انقطع في محاولته الأخيرة ← تُختم فاشلة لا معلّقة. */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const MARK = `load-mkj-${Date.now()}`;
const DOMAIN = "@ld.example.test";
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code ?? "?");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asRole = (id: string, role: string, name: string): Session =>
  ({ user: { id, role, name, email: "probe@example.test" }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session);
const actorOf = async (s: Session): Promise<MkActor> => (await marketingActor(s))!;
const LEASE_MS = 90_000;

// مزوّدٌ وهمي: يعدّ الاستدعاءات لكل مهمّة (أي التكلفة)، وسلوكُه قابلٌ للتبديل
let behaviour: (signal?: AbortSignal) => Promise<TextResult> = async () => {
  await sleep(15);
  return { model: "load-model", variants: [{ text: "اقتراح", rationale: "سبب" }] };
};
const callsByDraft = new Map<string, number>();
const fake: TextProvider = {
  id: "load-fake",
  model: "load-model",
  simulated: false,
  generate: (req, signal) => {
    callsByDraft.set(req.deliverable.title, (callsByDraft.get(req.deliverable.title) ?? 0) + 1);
    return behaviour(signal);
  },
};
const READY: AiStatus["text"] = { state: "ready", provider: "load-fake", model: "load-model", simulated: false, reason: null };
const deps: JobDeps = { status: () => READY, providerFor: (id) => (id === "load-fake" ? fake : null), attemptTimeoutMs: 5_000 };
const at = (ms: number): JobDeps => ({ ...deps, now: () => new Date(Date.now() + ms) });

async function cleanup() {
  const cs = await prisma.marketingCampaign.findMany({ where: { name: { startsWith: "load-mkj-" } }, select: { id: true } });
  for (const c of cs) await prisma.marketingCampaign.delete({ where: { id: c.id } });
  await prisma.marketingEvent.deleteMany({ where: { actorName: { startsWith: "load-mkj" } } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  await prisma.marketingGenerationJob.deleteMany({ where: { requestedBy: { userId: { in: users.map((u) => u.id) } } } });
  await prisma.marketingMember.deleteMany({ where: { OR: [{ addedByName: { startsWith: "load-mkj" } }, { userId: { in: users.map((u) => u.id) } }] } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

(async () => {
  await cleanup();
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const tech = await prisma.department.findFirstOrThrow({ where: { slug: "tech" } });
  const opsU = await prisma.user.findFirstOrThrow({ where: { email: "ops@fixture.test" } });
  const ceoU = await prisma.user.findFirstOrThrow({ where: { email: "exec@fixture.test" } });
  const N = (k: string) => `load-mkj ${k}`;
  const mk = (k: string, departmentId: string) =>
    prisma.user.create({ data: { fullName: N(k), email: `${k}${DOMAIN}`, passwordHash: "x", role: "department_admin", departmentId, isActive: true } });
  const leadU = await mk("lead", marketing.id);
  const writersU = await Promise.all([1, 2, 3, 4].map((i) => mk(`w${i}`, tech.id)));
  const lead = await actorOf(asRole(leadU.id, "department_admin", N("lead")));
  const ops = await actorOf(asRole(opsU.id, "operations_officer", N("ops")));
  const ceo = await actorOf(asRole(ceoU.id, "executive", N("ceo")));

  const c = await createCampaign(lead, { name: `${MARK} حملة`, channels: ["instagram"] });
  if (!c.ok) throw new Error("campaign");
  const C = c.campaignId;
  await transitionCampaign(lead, C, "briefing");
  await updateBrief(lead, C, { name: `${MARK} حملة`, objective: "اختبار", audience: "طلاب", keyMessage: "نلتقي", deadline: new Date(Date.now() + 9 * 86400_000), channels: ["instagram"] });
  const COUNT = 40;
  const D: string[] = [];
  for (let i = 0; i < COUNT; i++) {
    const r = await createDeliverable(lead, C, { title: `مخرج ${i}`, platform: "instagram", formatKey: "square" });
    if (!r.ok) throw new Error("deliverable " + code(r));
    D.push(r.deliverableId);
  }
  await transitionCampaign(lead, C, "ready_for_planning");
  const writerIds: string[] = [];
  for (const u of writersU) {
    const t = await addTeamMember(lead, { kind: "user", id: u.id, capabilities: ["writer"] });
    if (!t.ok) throw new Error("team");
    writerIds.push(t.memberId);
    await addCampaignMember(lead, C, { marketingMemberId: t.memberId, role: "writer" });
  }
  const dz = await addTeamMember(lead, { kind: "user", id: (await mk("dz", tech.id)).id, capabilities: ["designer"] });
  if (!dz.ok) throw new Error("designer");
  await addCampaignMember(lead, C, { marketingMemberId: dz.memberId, role: "designer" });
  const p = await submitPlan(lead, C);
  if (!p.ok) throw new Error("plan");
  for (const [a, stage] of [[lead, "department"], [ops, "operations"], [ceo, "executive"]] as const) {
    const r = await decidePlan(a, C, { planVersionId: p.planVersionId, stage, decision: "approved" });
    if (!r.ok) throw new Error("plan " + stage + " " + code(r));
  }
  if (!(await transitionCampaign(lead, C, "in_progress")).ok) throw new Error("in_progress");
  const W = await Promise.all(writersU.map((u, i) => actorOf(asRole(u.id, "department_admin", N(`w${i + 1}`)))));
  const jobsOn = (deliverableId: string) => prisma.marketingGenerationJob.findMany({ where: { deliverableId } });

  // ── ١) مفتاحُ التكرار تحت السباق
  const same = await Promise.all(Array.from({ length: 20 }, (_, i) => requestTextSuggestion(W[i % 4], D[0], { requestId: `${MARK}-same` }, deps)));
  const ids = new Set(same.flatMap((r) => (r.ok ? [r.jobId] : [])));
  chk("٢٠ طلباً متزامناً بالمفتاح نفسه ← مهمّةٌ واحدة يعيدها الجميع", same.every((r) => r.ok) && ids.size === 1 && (await jobsOn(D[0])).length === 1, [...new Set(same.map(code))].join(","));

  // ── ٢) مهمّةٌ نشطةٌ واحدةٌ لكل مخرج — بمفاتيح مختلفة
  const diff = await Promise.all(Array.from({ length: 12 }, (_, i) => requestTextSuggestion(W[i % 4], D[1], { requestId: `${MARK}-d${i}` }, deps)));
  const accepted = diff.filter((r) => r.ok).length;
  const refused = diff.filter((r) => code(r) === "job_active").length;
  const active1 = (await jobsOn(D[1])).filter((j) => j.status === "queued" || j.status === "running").length;
  chk("١٢ طلباً متزامناً بمفاتيح مختلفة على مخرجٍ واحد ← واحدٌ يُقبل والباقي «نشطة»", accepted === 1 && refused === 11 && active1 === 1, `accepted=${accepted} active=${active1}`);

  // ── ٣) الحصّة تحت السباق: كاتبٌ استهلك (الحدّ − ١) ثم أرسل ٦ طلباتٍ متزامنة على مخارج مختلفة
  const w4 = writerIds[3];
  await prisma.marketingGenerationJob.deleteMany({ where: { requestedById: w4 } });
  await prisma.marketingGenerationJob.createMany({
    data: Array.from({ length: DAILY_QUOTA - 1 }, (_, i) => ({
      deliverableId: D[39], kind: "text" as const, provider: "load-fake", model: "load-model", input: {}, idempotencyKey: `${MARK}-q${i}`,
      requestedById: w4, status: "succeeded" as const, finishedAt: new Date(),
    })),
  });
  const q = await Promise.all([30, 31, 32, 33, 34, 35].map((i) => requestTextSuggestion(W[3], D[i], { requestId: `${MARK}-qq${i}` }, deps)));
  const used = await prisma.marketingGenerationJob.count({ where: { requestedById: w4, createdAt: { gte: new Date(Date.now() - 86400_000) } } });
  chk("الحصّةُ اليومية لا تُتجاوز بطلباتٍ متزامنة", q.filter((r) => r.ok).length === 1 && q.filter((r) => code(r) === "job_quota").length === 5 && used === DAILY_QUOTA, `ok=${q.filter((r) => r.ok).length} used=${used}/${DAILY_QUOTA} codes=${q.map(code).join(",")}`);
  await prisma.marketingGenerationJob.deleteMany({ where: { requestedById: w4 } });

  // ── ٤) خمسةُ عمّالٍ على كل مهمّة من ٢٠ — مرةً واحدة لكلٍّ منها
  await prisma.marketingGenerationJob.deleteMany({ where: { deliverableId: { in: D } } });
  callsByDraft.clear();
  const batch: string[] = [];
  for (let i = 2; i < 22; i++) {
    const r = await requestTextSuggestion(W[i % 4], D[i], { requestId: `${MARK}-c${i}` }, deps);
    if (!r.ok) throw new Error("req " + code(r));
    batch.push(r.jobId);
  }
  const t0 = Date.now();
  const outs = await Promise.all(batch.flatMap((id) => Array.from({ length: 5 }, () => processJob(id, deps))));
  const ms4 = Date.now() - t0;
  const rows4 = await prisma.marketingGenerationJob.findMany({ where: { id: { in: batch } } });
  const calls4 = [...callsByDraft.values()];
  chk("١٠٠ محاولةِ حجزٍ متزامنة على ٢٠ مهمّة ← ٢٠ نجاحاً و٨٠ «لم تُحجز»", outs.filter((o) => o === "succeeded").length === 20 && outs.filter((o) => o === "not_claimed").length === 80, `${ms4}ms`);
  chk("وكلُّ مهمّةٍ استدعت المزوّدَ مرةً واحدة (لا تكلفةَ مكرّرة)", calls4.length === 20 && calls4.every((n) => n === 1));
  chk("وكلُّها ناجحةٌ بمحاولةٍ واحدة", rows4.every((j) => j.status === "succeeded" && j.attempts === 1 && j.leaseUntil === null));
  const ev4 = await prisma.marketingEvent.count({ where: { campaignId: C, action: "job.succeeded" } });
  chk("وحدثُ نجاحٍ واحدٌ لكل مهمّة في السجلّ", ev4 === 20, `events=${ev4}`);

  // ── ٥) أربعةُ عمّالِ `processDue` متوازين على ٤٠ مهمّة
  await prisma.marketingGenerationJob.deleteMany({ where: { deliverableId: { in: D } } });
  await prisma.marketingEvent.deleteMany({ where: { campaignId: C, action: "job.succeeded" } });
  callsByDraft.clear();
  const queued: string[] = [];
  for (let i = 0; i < COUNT; i++) {
    const r = await requestTextSuggestion(W[i % 4], D[i], { requestId: `${MARK}-p${i}` }, deps);
    if (r.ok) queued.push(r.jobId);
  }
  const t5 = Date.now();
  const worker = async () => {
    const mine: string[] = [];
    for (let round = 0; round < 30; round++) {
      const o = await processDue({ limit: 10 }, deps);
      mine.push(...o);
      if (o.length === 0) break;
    }
    return mine;
  };
  const all5 = (await Promise.all([worker(), worker(), worker(), worker()])).flat();
  const ms5 = Date.now() - t5;
  const rows5 = await prisma.marketingGenerationJob.findMany({ where: { id: { in: queued } } });
  const calls5 = [...callsByDraft.values()];
  chk("٤ عمّالٍ متوازين على ٤٠ مهمّة: كلُّها ناجحة", queued.length === COUNT && rows5.every((j) => j.status === "succeeded"), `${ms5}ms · ${(COUNT / (ms5 / 1000)).toFixed(1)} مهمّة/ث محلياً`);
  chk("ولا مهمّةَ استُدعي لها المزوّدُ مرتين ولا ضاعت مهمّة", calls5.length === COUNT && calls5.every((n) => n === 1) && all5.filter((o) => o === "succeeded").length === COUNT);

  // ── ٦) حجزٌ انقضى: الأول بطيء، والثاني يستأنف بعد المهلة، ونتيجةُ الأول تُرمى
  await prisma.marketingGenerationJob.deleteMany({ where: { deliverableId: { in: D } } });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let n6 = 0;
  behaviour = async () => {
    n6++;
    if (n6 === 1) await gate; // العاملُ الأول يعلق
    return { model: "load-model", variants: [{ text: n6 === 1 ? "ناتجُ العامل الأول" : "ناتجُ العامل الثاني", rationale: "—" }] };
  };
  const j6 = await requestTextSuggestion(W[0], D[5], { requestId: `${MARK}-lease` }, deps);
  if (!j6.ok) throw new Error("j6");
  const first = processJob(j6.jobId, deps);
  await sleep(100);
  const second = await processJob(j6.jobId, at(LEASE_MS + 1_000));
  release();
  const firstOut = await first;
  const r6 = await prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id: j6.jobId } });
  const text6 = (r6.result as { variants?: { text: string }[] } | null)?.variants?.[0]?.text;
  chk("حجزٌ منقضٍ يستأنفه عاملٌ ثانٍ (المحاولة ٢)", second === "succeeded" && r6.attempts === 2);
  chk("ونتيجةُ العامل الذي فقد حجزه تُرمى ولا تكتب فوق الأحدث", firstOut === "discarded" && text6 === "ناتجُ العامل الثاني");

  // ── ٧) إلغاءٌ أثناء التشغيل
  let release7!: () => void;
  const gate7 = new Promise<void>((r) => (release7 = r));
  behaviour = async () => {
    await gate7;
    return { model: "load-model", variants: [{ text: "متأخّر", rationale: "—" }] };
  };
  const j7 = await requestTextSuggestion(W[1], D[6], { requestId: `${MARK}-cancel` }, deps);
  if (!j7.ok) throw new Error("j7");
  const run7 = processJob(j7.jobId, deps);
  await sleep(100);
  const cancel = await cancelJob(W[1], j7.jobId);
  release7();
  const out7 = await run7;
  const r7 = await prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id: j7.jobId } });
  chk("إلغاءٌ أثناء التشغيل: الناتجُ يُرمى والمهمّة «ملغاة» بلا نتيجة", cancel.ok && out7 === "discarded" && r7.status === "cancelled" && r7.result === null);

  // ── ٨) إعادةٌ بتأخيرٍ متزايد ثم نجاح؛ واستنفاد
  let n8 = 0;
  behaviour = async () => {
    n8++;
    if (n8 <= 2) throw new ProviderError("rate_limited", "429");
    return { model: "load-model", variants: [{ text: "بعد الإعادة", rationale: "—" }] };
  };
  const j8 = await requestTextSuggestion(W[2], D[7], { requestId: `${MARK}-retry` }, deps);
  if (!j8.ok) throw new Error("j8");
  const o1 = await processJob(j8.jobId, deps);
  const a1 = await prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id: j8.jobId } });
  const early = await processJob(j8.jobId, deps); // قبل موعد الإعادة: لا يُحجز
  const o2 = await processJob(j8.jobId, at(60_000));
  const a2 = await prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id: j8.jobId } });
  const o3 = await processJob(j8.jobId, at(10 * 60_000));
  const a3 = await prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id: j8.jobId } });
  const gap1 = a1.nextAttemptAt!.getTime() - Date.now();
  const gap2 = a2.nextAttemptAt!.getTime() - (Date.now() + 60_000);
  chk("٤٢٩ مرتين ثم نجاح: إعادتان بتأخيرٍ متزايد ثم «نجح» بالمحاولة الثالثة", o1 === "retry_scheduled" && early === "not_claimed" && o2 === "retry_scheduled" && o3 === "succeeded" && a3.attempts === 3 && n8 === 3, `gap1≈${Math.round(gap1 / 1000)}s gap2≈${Math.round(gap2 / 1000)}s`);
  chk("والتأخيرُ يتضاعف (٢٠ث ثم ٤٠ث ±٢٠٪)", gap1 > 14_000 && gap1 < 26_000 && gap2 > 30_000 && gap2 < 50_000);
  behaviour = async () => {
    throw new ProviderError("unavailable", "503");
  };
  const j8b = await requestTextSuggestion(W[2], D[8], { requestId: `${MARK}-exhaust` }, deps);
  if (!j8b.ok) throw new Error("j8b");
  const seq = [await processJob(j8b.jobId, deps), await processJob(j8b.jobId, at(60_000)), await processJob(j8b.jobId, at(10 * 60_000)), await processJob(j8b.jobId, at(30 * 60_000))];
  const r8b = await prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id: j8b.jobId } });
  chk("عطلٌ دائم: ثلاثُ محاولاتٍ ثم «فشل» نهائي ولا رابعة", seq.join(",") === "retry_scheduled,retry_scheduled,failed,not_claimed" && r8b.status === "failed" && r8b.attempts === 3 && r8b.error === "unavailable", seq.join(","));

  // ── ٨ب) إعادةُ مهمّةٍ فاشلة وطلبٌ جديدٌ متزامنان على المخرج نفسه ← نشطةٌ واحدة
  const raceR = await Promise.all([
    retryJob(W[2], j8b.jobId, deps),
    ...[0, 1, 2].map((i) => requestTextSuggestion(W[i], D[8], { requestId: `${MARK}-rr${i}` }, deps)),
  ]);
  const active8 = await prisma.marketingGenerationJob.count({ where: { deliverableId: D[8], status: { in: ["queued", "running"] } } });
  chk("إعادةٌ وطلباتٌ جديدةٌ متزامنة على مخرجٍ واحد ← مهمّةٌ نشطةٌ واحدة", active8 === 1 && raceR.filter((r) => r.ok).length === 1, raceR.map(code).join(","));

  // ── ٩) عاملٌ انقطع في محاولته الأخيرة (لا يعود أبداً)
  const j9 = await requestTextSuggestion(W[3], D[9], { requestId: `${MARK}-crash` }, deps);
  if (!j9.ok) throw new Error("j9");
  await prisma.marketingGenerationJob.update({ where: { id: j9.jobId }, data: { status: "running", attempts: 3, leaseUntil: new Date(Date.now() - 1_000) } });
  const o9 = await processJob(j9.jobId, deps);
  const r9 = await prisma.marketingGenerationJob.findUniqueOrThrow({ where: { id: j9.jobId } });
  chk("مهمّةٌ معلّقةٌ استنفدت محاولاتها تُختم «فاشلة — مهلة» لا تبقى «جارية»", o9 === "not_claimed" && r9.status === "failed" && r9.error === "timeout");

  await cleanup();
  const left = (await prisma.marketingCampaign.count({ where: { name: { startsWith: "load-mkj-" } } })) + (await prisma.user.count({ where: { email: { endsWith: DOMAIN } } }));
  chk("لا بقايا بعد الفحص", left === 0);
  console.log(checks.join("\n"));
  const failed = checks.filter((x) => x.startsWith("✗")).length;
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
