import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";
import { currentAndNextPeriod } from "@/lib/execution";
import { ensureWeekPlan } from "@/lib/carryover";

/** قياسُ صفحات المنصة العامة (غير التسويق) — بحجمٍ معلومٍ وجلسةٍ حقيقية، لا تخميناً.
 *
 *  `seed <أعضاء>` قسمٌ تجريبيٌّ بقائده، وأعضاءٌ معتمدون بالعدد، وثلاثةُ أضعافهم تذاكر، وأربعةُ أضعافهم
 *    مهامّ في أسبوع التنفيذ الحالي — وكلُّها بوسم `@perf-org.test` / `perf-org`.
 *  `http` يدخل رئيساً تنفيذياً وقائدَ القسم دخولاً حقيقياً (كلمة مرور ثم رمز بريد) ويقيس كلَّ صفحة:
 *    تسخينان ثم ١٥ طلباً — الوسيط وp95 وحجم الصفحة. (CHECK_BASE_URL أو localhost:3000 — يُفضَّل `next start`.)
 *  `teardown` يحذف ما أنشأه وحده.
 *
 *    npx tsx --env-file=<ملف بيئةٍ محلية> scripts/perf-platform.ts seed 300 | http | teardown */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const DOMAIN = "@perf-org.test";
const SLUG = "perf-org-dept";
const PASS = "PerfOrg#2026aa";
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

async function teardown() {
  const dept = await prisma.department.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  if (dept) {
    await prisma.planTask.deleteMany({ where: { departmentId: dept.id } });
    await prisma.weekPlan.deleteMany({ where: { departmentId: dept.id } });
    await prisma.ticket.deleteMany({ where: { targetDepartmentId: dept.id } });
  }
  await prisma.ticket.deleteMany({ where: { raisedByUserId: { in: userIds } } });
  const ms = await prisma.member.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true, inviteId: true } });
  await prisma.member.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
  await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (dept) await prisma.testTrack.deleteMany({ where: { departmentId: dept.id } });
  if (dept) await prisma.department.delete({ where: { id: dept.id } });
  await prisma.loginCode.deleteMany({ where: { email: { endsWith: DOMAIN } } }).catch(() => {});
}

async function seed(n: number) {
  await teardown();
  const pw = await hashPassword(PASS);
  const dept = await prisma.department.create({ data: { name: "perf-org قسم القياس", slug: SLUG, colorHex: "#67C090" } });
  const track = await prisma.testTrack.create({ data: { scope: "department_member", departmentId: dept.id } });
  const ceo = await prisma.user.create({ data: { fullName: "perf-org تنفيذي", email: `ceo${DOMAIN}`, passwordHash: pw, role: "executive", isActive: true } });
  const lead = await prisma.user.create({ data: { fullName: "perf-org قائد", email: `lead${DOMAIN}`, passwordHash: pw, role: "department_admin", departmentId: dept.id, isActive: true } });

  const invites = await prisma.invite.createManyAndReturn({
    data: Array.from({ length: n }, (_, i) => ({ fullName: `perf-org عضو ${i}`, email: `m${i}${DOMAIN}`, targetRole: "member" as const, departmentId: dept.id, testTrackId: track.id, invitedById: lead.id, status: "used" as const })),
    select: { id: true, email: true, fullName: true },
  });
  const members = await prisma.member.createManyAndReturn({
    data: invites.map((iv) => ({ fullName: iv.fullName, email: iv.email, inviteId: iv.id, departmentId: dept.id, approvalStatus: "approved" as const, testStatus: "passed" as const, isActive: true, decidedAt: new Date() })),
    select: { id: true },
  });

  const now = Date.now();
  await prisma.ticket.createMany({
    data: Array.from({ length: n * 3 }, (_, i) => ({
      subject: `perf-org تذكرة ${i}`,
      description: "قياس",
      raisedByUserId: lead.id,
      targetDepartmentId: dept.id,
      stage: "department" as const,
      status: i % 5 === 0 ? ("resolved" as const) : ("open" as const),
      stageDueAt: new Date(now + ((i % 7) - 3) * 86400_000),
      firstDueAt: new Date(now + 2 * 86400_000),
    })),
  });

  const { current } = await currentAndNextPeriod();
  const plan = await ensureWeekPlan(current.id, dept.id);
  await prisma.planTask.createMany({
    data: Array.from({ length: n * 4 }, (_, i) => ({
      title: `perf-org مهمة ${i}`,
      acceptanceCriteria: "معيار",
      originalDueAt: new Date(now + 3 * 86400_000),
      dueAt: new Date(now + 3 * 86400_000),
      createdByName: "perf-org",
      departmentId: dept.id,
      periodId: current.id,
      planId: plan.id,
      ownerMemberId: members[i % members.length].id,
    })),
  });
  console.log(JSON.stringify({ members: members.length, tickets: n * 3, tasks: n * 4, ceo: ceo.id.slice(0, 6), lead: lead.id.slice(0, 6) }));
}

async function signIn(email: string): Promise<string> {
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
  const code = await issueLoginCode(email);
  keep(await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: PASS, loginCode: String(code), callbackUrl: "/" }),
  }));
  return cookie();
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function measure(label: string, cookie: string, paths: string[]) {
  for (const p of paths) {
    const times: number[] = [];
    let bytes = 0;
    let status = 0;
    for (let i = 0; i < 17; i++) {
      const t0 = performance.now();
      const r = await fetch(`${BASE}${p}`, { redirect: "manual", headers: { cookie } });
      const body = await r.arrayBuffer();
      const ms = performance.now() - t0;
      status = r.status;
      bytes = body.byteLength;
      if (i >= 2) times.push(ms); // تسخينان
    }
    console.log(`${label.padEnd(5)} ${p.padEnd(34)} ${String(status).padEnd(4)} median ${pct(times, 50).toFixed(0).padStart(5)}ms  p95 ${pct(times, 95).toFixed(0).padStart(5)}ms  ${(bytes / 1024).toFixed(0).padStart(5)}KB`);
  }
}

async function http() {
  const ceo = await signIn(`ceo${DOMAIN}`);
  const lead = await signIn(`lead${DOMAIN}`);
  await measure("CEO", ceo, ["/admin", "/admin/people", "/admin/tickets", "/admin/approvals", "/admin/execution", "/admin/execution/goals", "/admin/departments", "/admin/reports", "/structure", "/notifications", "/calendar", "/plans", "/marketing", "/marketing/campaigns"]);
  await measure("LEAD", lead, ["/admin", `/admin/departments/${SLUG}`, "/admin/execution", "/admin/tickets", "/structure"]);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "seed") await seed(Number(arg ?? 300));
  else if (cmd === "http") await http();
  else if (cmd === "teardown") await teardown();
  else console.error("seed <n> | http | teardown");
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
