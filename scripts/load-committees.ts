import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { orgActor } from "@/lib/org/actor";
import { listCommittees, committeeDetail, departmentOverview, committeesReport, myCommittees } from "@/lib/org/queries";
import { committeeAlerts } from "@/lib/org/alerts";
import { calendarEntries } from "@/lib/orgCalendar";

/** **أداءُ اللجان على حجمٍ كبير — قاعدةٌ محلية، بياناتٌ مصطنعةٌ موسومة تُمحى في آخره.**
 *
 *  قسمٌ بـ٣٠٠ عضو و٢٠٠ لجنة (١٢ عضواً لكلٍّ) و٦٠٠٠ مهمّة و١٢٠٠ اجتماع، ثم تُقاس
 *  القراءاتُ التي تُبنى منها الصفحات: القائمةُ وتصفيتُها وبحثُها، وتفاصيلُ لجنةٍ ثقيلة،
 *  ونظرةُ القسم، وتقريرُ الإدارة، والتنبيهات، والتقويم، و«لجاني».
 *
 *  الحدُّ لكل قراءة ٨٠٠ ملّي ثانية على القاعدة المحلية — قياسٌ لا وعد: الإنتاجُ
 *  (Neon) أبعدُ شبكةً، ويُقاس هناك بعد النشر. */

const log: string[] = [];
const chk = (name: string, pass: boolean, extra = "") => log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
const STAMP = Date.now();
const TAG = `ld-${STAMP}`;
const DOMAIN = `@${TAG}.example.test`;
const LIMIT_MS = 800;

async function timed<T>(name: string, fn: () => Promise<T>, runs = 3): Promise<T> {
  let best = Infinity;
  let out!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = await fn();
    best = Math.min(best, performance.now() - t0);
  }
  chk(`${name} < ${LIMIT_MS}ms`, best < LIMIT_MS, `${best.toFixed(0)}ms (أفضل ${runs})`);
  return out;
}

async function purge() {
  const depts = await prisma.department.findMany({ where: { slug: { startsWith: "ld-" } }, select: { id: true } });
  const ids = depts.map((d) => d.id);
  const cids = (await prisma.department.findMany({ where: { parentId: { in: ids } }, select: { id: true } })).map((c) => c.id);
  await prisma.committeeAttendance.deleteMany({ where: { meeting: { committeeId: { in: cids } } } });
  await prisma.committeeTask.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.committeeMeeting.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: cids } } });
  await prisma.department.deleteMany({ where: { id: { in: cids } } });
  await prisma.member.deleteMany({ where: { email: { contains: "@ld-" } } });
  await prisma.invite.deleteMany({ where: { email: { contains: "@ld-" } } });
  await prisma.user.deleteMany({ where: { email: { contains: "@ld-" } } });
  await prisma.department.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await purge();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive", isActive: true } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const dept = await prisma.department.create({ data: { name: `قسم الحجم ${STAMP}`, slug: TAG, colorHex: "#C34900" } });
  const leader = await prisma.user.create({ data: { fullName: `قائد ${STAMP}`, email: `lead${DOMAIN}`, passwordHash: "x", role: "department_admin", departmentId: dept.id } });

  const t0 = performance.now();
  const N_MEMBERS = 300;
  await prisma.invite.createMany({
    data: Array.from({ length: N_MEMBERS }, (_, i) => ({ id: `${TAG}-i${i}`, fullName: `ع${i}`, email: `m${i}${DOMAIN}`, targetRole: "member" as const, departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" as const })),
  });
  await prisma.member.createMany({
    data: Array.from({ length: N_MEMBERS }, (_, i) => ({ id: `${TAG}-m${i}`, fullName: `عضو ${i}`, email: `m${i}${DOMAIN}`, departmentId: dept.id, inviteId: `${TAG}-i${i}`, passwordHash: "x", approvalStatus: "approved" as const, isActive: true })),
  });
  const N_COMMITTEES = 200;
  const statuses = ["approved", "approved", "approved", "suspended", "completed", "closed", "archived", "draft", "pending_review"] as const;
  await prisma.department.createMany({
    data: Array.from({ length: N_COMMITTEES }, (_, i) => ({
      id: `${TAG}-c${i}`, name: `لجنة ${i} ${STAMP}`, slug: `${TAG}-c${i}`, colorHex: "#C34900", parentId: dept.id,
      committeeStatus: statuses[i % statuses.length], committeeKind: i % 3 ? ("permanent" as const) : ("temporary" as const),
      purpose: "غرض", leadMemberId: `${TAG}-m${i % N_MEMBERS}`, startDate: new Date("2026-01-01"), statusChangedAt: new Date(Date.now() - i * 60_000),
    })),
  });
  const memberships = [];
  for (let c = 0; c < N_COMMITTEES; c++) for (let k = 0; k < 12; k++) memberships.push({ committeeId: `${TAG}-c${c}`, memberId: `${TAG}-m${(c + k * 17) % N_MEMBERS}`, addedByName: "حمل" });
  await prisma.committeeMembership.createMany({ data: memberships, skipDuplicates: true });
  const tasks = [];
  const now = Date.now();
  for (let i = 0; i < 6000; i++) {
    const c = i % N_COMMITTEES;
    tasks.push({
      committeeId: `${TAG}-c${c}`, title: `مهمّة ${i}`, assigneeMemberId: `${TAG}-m${(c + (i % 12) * 17) % N_MEMBERS}`,
      dueAt: new Date(now + ((i % 60) - 30) * 86_400_000), status: (["todo", "in_progress", "done", "cancelled"] as const)[i % 4],
      priority: (["low", "normal", "high", "urgent"] as const)[i % 4], createdByName: "حمل",
    });
  }
  await prisma.committeeTask.createMany({ data: tasks });
  const meetings = [];
  for (let i = 0; i < 1200; i++) {
    meetings.push({
      committeeId: `${TAG}-c${i % N_COMMITTEES}`, title: `اجتماع ${i}`, startsAt: new Date(now + ((i % 40) - 20) * 86_400_000),
      status: (["scheduled", "held", "cancelled"] as const)[i % 3], location: "القاعة", createdByName: "حمل",
    });
  }
  await prisma.committeeMeeting.createMany({ data: meetings });
  log.push(`· البذر: ${N_MEMBERS} عضو، ${N_COMMITTEES} لجنة، ${memberships.length} عضوية، ${tasks.length} مهمّة، ${meetings.length} اجتماع — ${((performance.now() - t0) / 1000).toFixed(1)}ث`);

  const sess = (role: string, id: string, departmentId: string | null) => ({ user: { id, role, departmentId, name: "حمل" } }) as unknown as Session;
  const LA = (await orgActor(sess("department_admin", leader.id, dept.id)))!;
  const EX = (await orgActor(sess("executive", exec.id, null)))!;
  const M = (await orgActor(sess("member", `${TAG}-m5`, dept.id)))!;

  const list = await timed("قائمةُ اللجان (القائد، الصفحة الأولى)", () => listCommittees(LA, { page: 1 }));
  chk("القائمةُ مقسّمةٌ إلى صفحات", !!list && list.rows.length === 20 && list.total === N_COMMITTEES, `${list?.rows.length}/${list?.total}`);
  await timed("القائمةُ بتصفية الحالة", () => listCommittees(LA, { status: "approved", page: 2 }));
  await timed("القائمةُ ببحثٍ بالاسم", () => listCommittees(LA, { q: "لجنة 1", page: 1 }));
  await timed("القائمةُ للإدارة العليا (كل الأقسام)", () => listCommittees(EX, { page: 3 }));
  const ml = await timed("القائمةُ لعضو (لجانه وحدها)", () => listCommittees(M, { page: 1 }));
  chk("والعضوُ يرى لجانه وحدها", !!ml && ml.total < N_COMMITTEES, String(ml?.total));
  await timed("تفاصيلُ لجنةٍ بعشرات المهامّ والاجتماعات", () => committeeDetail(LA, `${TAG}-c0`));
  await timed("نظرةُ القسم", () => departmentOverview(LA, dept.id));
  await timed("تقريرُ اللجان للإدارة", () => committeesReport());
  await timed("تنبيهاتُ قائد القسم", () => committeeAlerts(LA));
  await timed("تنبيهاتُ العضو", () => committeeAlerts(M));
  await timed("«لجاني» للعضو", () => myCommittees(`${TAG}-m5`));
  const from = new Date(now - 31 * 86_400_000);
  const to = new Date(now + 31 * 86_400_000);
  await timed("التقويمُ الموحَّد لقائد القسم (شهران)", () => calendarEntries({ session: sess("department_admin", leader.id, dept.id), from, to }));
  await timed("التقويمُ الموحَّد للعضو (شهران)", () => calendarEntries({ session: sess("member", `${TAG}-m5`, dept.id), from, to }));

  await purge();
  chk("التنظيف: لا أثرَ للبيانات المصطنعة", (await prisma.department.count({ where: { slug: { startsWith: "ld-" } } })) === 0 && (await prisma.member.count({ where: { email: { contains: "@ld-" } } })) === 0);
  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await purge().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
