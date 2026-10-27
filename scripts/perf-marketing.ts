/** قياسُ أداء وكيل التسويق — على قاعدةٍ محلية وحدها، ببياناتٍ اصطناعية بحجمٍ معلوم.
 *
 *  `seed <حملات>` يُنشئ قائداً وفريقاً وحملاتٍ بمخرجاتها ونسخها ومهامّها وتعليقاتها
 *  وسجلّها (بريد `@perf.test`). `measure` يقيس خدماتِ الصفحات الأساسية بالترتيب
 *  نفسه في كل مرة (تسخينٌ ثم ٧ تكرارات: الوسيط وأكبر قيمة، وحجمُ الناتج بالبايت).
 *  `http` يقيس الصفحاتِ نفسها عبر الخادم المحلي بجلسةٍ حقيقية (CHECK_BASE_URL أو :3000).
 *  `teardown` يحذف ما أنشأه.
 *
 *    npx tsx --env-file=<ملف بيئةٍ محلية> scripts/perf-marketing.ts seed 120
 *    npx tsx --env-file=<ملف بيئةٍ محلية> scripts/perf-marketing.ts measure */
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { marketingActor } from "@/lib/marketing/access";
import { listCampaigns, campaignWorkspace } from "@/lib/marketing/campaigns";
import { campaignPlan } from "@/lib/marketing/plan";
import { campaignTasks, campaignComments } from "@/lib/marketing/tasks";
import { actionItems, marketingOverview, campaignEvents } from "@/lib/marketing/inbox";
import { deliverableWorkspace } from "@/lib/marketing/deliverables";
import { campaignCalendar } from "@/lib/marketing/schedule";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";

const DOMAIN = "@perf.test";
const MARK = "perf-mk";
const PASSWORD = "Perf#2026aa";

function assertLocal() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("perf-marketing: قاعدةٌ محلية فقط");
}

async function teardown() {
  const lead = await prisma.user.findUnique({ where: { email: `lead${DOMAIN}` }, select: { id: true } });
  const members = await prisma.marketingMember.findMany({ where: { addedByName: MARK }, select: { id: true } });
  const ids = members.map((m) => m.id);
  const campaigns = await prisma.marketingCampaign.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
  for (const c of campaigns) {
    await prisma.marketingCampaign.update({ where: { id: c.id }, data: { currentPlanVersionId: null } });
    await prisma.marketingCampaign.delete({ where: { id: c.id } });
  }
  await prisma.marketingEvent.deleteMany({ where: { actorName: MARK } });
  await prisma.marketingMember.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  if (lead) console.log("teardown ok");
}

async function seed(n: number) {
  await teardown();
  const marketing = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const lead = await prisma.user.create({
    data: { fullName: "قائد الأداء", email: `lead${DOMAIN}`, passwordHash: await hashPassword(PASSWORD), role: "department_admin", departmentId: marketing.id, isActive: true, mustChangePassword: false, profileCompletedAt: new Date(), passwordChangedAt: new Date() },
  });
  const mkMember = (userId: string, caps: ("coordinator" | "writer" | "designer" | "reviewer" | "publisher")[]) =>
    prisma.marketingMember.create({ data: { userId, capabilities: caps, addedByName: MARK, nameSnapshot: MARK } });
  const leadM = await mkMember(lead.id, []);
  const team = [] as { id: string }[];
  for (const [i, caps] of ([["writer"], ["writer"], ["designer"], ["designer"], ["reviewer"], ["publisher"]] as const).entries()) {
    const u = await prisma.user.create({
      data: { fullName: `عضو أداء ${i}`, email: `t${i}${DOMAIN}`, passwordHash: "x", role: "department_admin", isActive: true, mustChangePassword: false },
    });
    team.push(await mkMember(u.id, [...caps]));
  }
  const format = await prisma.marketingFormat.findFirstOrThrow({ where: { key: "portrait" } });
  const statuses = ["idea", "briefing", "ready_for_planning", "in_progress", "published", "archived"] as const;
  for (let c = 0; c < n; c++) {
    const camp = await prisma.marketingCampaign.create({
      data: {
        name: `حملة أداء ${c}`, objective: "هدف", audience: "جمهور", keyMessage: "رسالة", channels: ["instagram", "x"],
        deadline: new Date(Date.now() + (c % 60) * 86400_000), status: statuses[c % statuses.length], ownerId: leadM.id,
        members: { create: [{ memberId: leadM.id, role: "coordinator" }, { memberId: team[0].id, role: "writer" }, { memberId: team[2].id, role: "designer" }, { memberId: team[4].id, role: "reviewer" }, { memberId: team[5].id, role: "publisher" }] },
      },
      select: { id: true },
    });
    for (let d = 0; d < 6; d++) {
      const del = await prisma.marketingDeliverable.create({
        data: {
          campaignId: camp.id, title: `مخرج ${d}`, platform: "instagram", formatKey: format.key, formatRevision: format.revision,
          width: format.width, height: format.height, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0,
          status: (["draft", "content_review", "content_approved", "design_review", "quality_review", "published"] as const)[d],
          contentDraft: "نصٌّ تجريبيٌّ ".repeat(40),
        },
        select: { id: true },
      });
      for (let v = 1; v <= 2; v++) {
        await prisma.marketingContentVersion.create({ data: { deliverableId: del.id, number: v, body: "نسخة ".repeat(80), authorId: team[0].id } });
      }
      await prisma.marketingTask.createMany({
        data: (["content", "design", "quality", "publishing"] as const).map((kind, k) => ({
          campaignId: camp.id, deliverableId: del.id, kind, title: `${kind} ${d}`, assigneeId: team[k % team.length].id, createdById: leadM.id,
          dueAt: new Date(Date.now() + (k + d) * 86400_000),
        })),
      });
      await prisma.marketingComment.createMany({ data: [0, 1, 2].map((k) => ({ campaignId: camp.id, deliverableId: del.id, body: `تعليق ${k}`, authorId: team[k].id })) });
      await prisma.marketingEvent.createMany({
        data: Array.from({ length: 5 }, (_, k) => ({ campaignId: camp.id, deliverableId: del.id, action: "deliverable.updated", actorKind: "user", actorId: lead.id, actorName: MARK, details: { k } })),
      });
    }
    await prisma.marketingEvent.createMany({
      data: Array.from({ length: 10 }, (_, k) => ({ campaignId: camp.id, action: "campaign.updated", actorKind: "user", actorId: lead.id, actorName: MARK, details: { k } })),
    });
  }
  const counts = await Promise.all([
    prisma.marketingCampaign.count(), prisma.marketingDeliverable.count(), prisma.marketingTask.count(),
    prisma.marketingContentVersion.count(), prisma.marketingComment.count(), prisma.marketingEvent.count(),
  ]);
  console.log(JSON.stringify({ campaigns: counts[0], deliverables: counts[1], tasks: counts[2], contentVersions: counts[3], comments: counts[4], events: counts[5] }));
}

async function time<T>(label: string, run: () => Promise<T>, reps = 7) {
  await run(); // تسخين
  const ms: number[] = [];
  let bytes = 0;
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    const out = await run();
    ms.push(performance.now() - t);
    bytes = Buffer.byteLength(JSON.stringify(out ?? null));
  }
  ms.sort((a, b) => a - b);
  return { label, medianMs: +ms[Math.floor(ms.length / 2)].toFixed(1), maxMs: +ms[ms.length - 1].toFixed(1), bytes };
}

async function measure() {
  const lead = await prisma.user.findUniqueOrThrow({ where: { email: `lead${DOMAIN}` } });
  const session = { user: { id: lead.id, role: "department_admin", name: lead.fullName }, expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session;
  const actor = (await marketingActor(session))!;
  const camp = await prisma.marketingCampaign.findFirstOrThrow({ where: { status: "in_progress", owner: { addedByName: MARK } }, select: { id: true } });
  const del = await prisma.marketingDeliverable.findFirstOrThrow({ where: { campaignId: camp.id }, select: { id: true } });
  const rows = [
    await time("listCampaigns(active)", () => listCampaigns(actor, { status: "active" })),
    await time("listCampaigns(all)", () => listCampaigns(actor, {})),
    await time("campaignWorkspace", () => campaignWorkspace(actor, camp.id)),
    await time("campaignPlan", () => campaignPlan(actor, camp.id)),
    await time("campaignTasks", () => campaignTasks(actor, camp.id)),
    // بعد التصفّح بصفحات: ما ترسمه الصفحةُ فعلاً
    await time("listCampaigns(active, page 1/24)", () => listCampaigns(actor, { status: "active" }, { page: 1, size: 24 })),
    await time("campaignTasks(page 1/50)", () => campaignTasks(actor, camp.id, { page: 1, size: 50 })),
    await time("campaignCalendar", () => campaignCalendar(actor, camp.id)),
    await time("campaignComments", () => campaignComments(actor, camp.id)),
    await time("campaignEvents", () => campaignEvents(camp.id, 150)),
    await time("deliverableWorkspace", () => deliverableWorkspace(actor, del.id)),
    await time("actionItems", () => actionItems(actor)),
    await time("marketingOverview", () => marketingOverview(actor)),
  ];
  console.log(JSON.stringify(rows));
}

/** الصفحاتُ عبر الخادم: دخولٌ حقيقي (كلمة المرور ثم رمز البريد)، ثم زمنُ الاستجابة الكامل */
async function http() {
  const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
  const email = `lead${DOMAIN}`;
  const jar = new Map<string, string>();
  const keep = (r: Response) => {
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const loginCode = String(await issueLoginCode(email));
  keep(await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, loginCode, callbackUrl: "/" }),
  }));
  const camp = await prisma.marketingCampaign.findFirstOrThrow({ where: { status: "in_progress", owner: { addedByName: MARK } }, select: { id: true } });
  const del = await prisma.marketingDeliverable.findFirstOrThrow({ where: { campaignId: camp.id }, select: { id: true } });
  const pages = {
    dashboard: "/marketing",
    campaigns: "/marketing/campaigns",
    campaign: `/marketing/campaigns/${camp.id}`,
    campaignTasks: `/marketing/campaigns/${camp.id}?tab=tasks`,
    campaignCalendar: `/marketing/campaigns/${camp.id}?tab=calendar`,
    deliverable: `/marketing/campaigns/${camp.id}/deliverables/${del.id}`,
  };
  const rows = [];
  for (const [label, path] of Object.entries(pages)) {
    rows.push(await time(label, async () => {
      const r = await fetch(`${BASE}${path}`, { headers: { cookie: cookie() }, redirect: "manual" });
      const body = await r.text();
      if (r.status !== 200) throw new Error(`${path} → ${r.status}`);
      return body;
    }));
  }
  console.log(JSON.stringify(rows));
}

(async () => {
  assertLocal();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "seed") await seed(Number(arg) || 120);
  else if (cmd === "measure") await measure();
  else if (cmd === "http") await http();
  else if (cmd === "teardown") await teardown();
  else throw new Error("usage: seed <n> | measure | http | teardown");
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
