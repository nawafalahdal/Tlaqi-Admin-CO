import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

/** **ترحيلُ أعضاء اللجان القديمة — يُشغَّل نصُّ الترحيل نفسُه على بياناتٍ بشكل النظام الأول.**
 *
 *  في النظام الأول كان عضوُ اللجنة «قسمُه» اللجنة (`Member.departmentId = committeeId`).
 *  والترحيلُ يكتب له عضويةً في الجدول الجديد ولا يمسّ قسمَه. وهذا الفحص يُثبت:
 *  - يُنشئ العضويةَ للعضو المعتمد النشط وحده (لا المرشّح ولا المعطَّل ولا سجلَّ ترشّح قائد)،
 *  - ولا يغيّر قسمَ أحد،
 *  - ويُشغَّل مرّتين بلا تكرار (`ON CONFLICT DO NOTHING`).
 *
 *  النصُّ يُقرأ من ملفّ الترحيل حرفاً بحرف — لا نسخةٌ منه قد تختلف عنه. */

const log: string[] = [];
const chk = (name: string, pass: boolean, extra = "") => log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
const STAMP = Date.now();
const DOMAIN = `@bf-${STAMP}.example.test`;

/** يمحو ما أنشأه هذا الفحص في أيّ تشغيلٍ سابق — بوسمه وحده (`bf-`)، فلا يبقى أثرٌ ولو انقطع */
async function purge() {
  const depts = await prisma.department.findMany({ where: { slug: { startsWith: "bf-" } }, select: { id: true } });
  const ids = depts.map((d) => d.id);
  await prisma.committeeMembership.deleteMany({ where: { committeeId: { in: ids } } });
  await prisma.member.deleteMany({ where: { email: { contains: "@bf-" } } });
  await prisma.invite.deleteMany({ where: { email: { contains: "@bf-" } } });
  await prisma.department.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
  await prisma.department.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await purge();
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261102120000_org_committees/migration.sql"), "utf8");
  const start = sql.indexOf('INSERT INTO "CommitteeMembership"');
  const backfill = start >= 0 ? sql.slice(start, sql.indexOf(";", start) + 1) : "";
  chk("نصُّ الترحيل موجودٌ في ملفّ الترحيل", backfill.includes("ON CONFLICT") && backfill.includes('"targetRole" = \'member\''));
  if (!backfill) return done();

  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const parent = await prisma.department.create({ data: { name: `قسم ترحيل ${STAMP}`, slug: `bf-${STAMP}`, colorHex: "#C34900" } });
  const legacy = await prisma.department.create({
    data: { name: `لجنة قديمة ${STAMP}`, slug: `bf-c-${STAMP}`, colorHex: "#C34900", parentId: parent.id, committeeStatus: "approved", decidedAt: new Date("2026-06-01") },
  });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member" } });
  const mk = async (tag: string, o: { role?: "member" | "department_admin"; approved?: boolean; active?: boolean; deptId?: string }) => {
    const email = `${tag}${DOMAIN}`;
    const invite = await prisma.invite.create({
      data: { fullName: tag, email, targetRole: o.role ?? "member", departmentId: o.deptId ?? legacy.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    return prisma.member.create({
      data: {
        fullName: `${tag} ${STAMP}`, email, departmentId: o.deptId ?? legacy.id, inviteId: invite.id, passwordHash: "x",
        approvalStatus: o.approved === false ? "pending_review" : "approved", isActive: o.active ?? true,
      },
    });
  };
  const ok1 = await mk("ok1", {});
  const ok2 = await mk("ok2", {});
  const pending = await mk("pending", { approved: false });
  const inactive = await mk("inactive", { active: false });
  const leaderRecord = await mk("leader", { role: "department_admin" });
  const parentMember = await mk("parentm", { deptId: parent.id });

  const count = () => prisma.committeeMembership.count({ where: { committeeId: legacy.id } });
  // الترحيلُ قد مرّ على القاعدة قبل الفحص — والصفوفُ الجديدةُ هنا لم تكن موجودةً حينها
  chk("قبل التشغيل: لا عضوياتٍ للجنة الجديدة", (await count()) === 0);
  await prisma.$executeRawUnsafe(backfill);
  const rows = await prisma.committeeMembership.findMany({ where: { committeeId: legacy.id }, select: { memberId: true, active: true, addedByName: true, addedAt: true } });
  const ids = new Set(rows.map((r) => r.memberId));
  chk("عضويةٌ للعضوين المعتمدَين النشطين", ids.has(ok1.id) && ids.has(ok2.id), String(rows.length));
  chk("ولا للمرشّح غير المعتمد", !ids.has(pending.id));
  chk("ولا للمعطَّل", !ids.has(inactive.id));
  chk("ولا لسجلّ ترشّح قائد", !ids.has(leaderRecord.id));
  chk("ولا لعضو القسم الأب (ليس عضواً في اللجنة)", !ids.has(parentMember.id));
  chk("نشطةً، منسوبةً للترحيل، بتاريخ اعتماد اللجنة", rows.every((r) => r.active && r.addedByName === "ترحيل نظام اللجان" && r.addedAt.toISOString().startsWith("2026-06-01")));
  chk("ولا يتغيّر قسمُ أحد", (await prisma.member.findUniqueOrThrow({ where: { id: ok1.id } })).departmentId === legacy.id);
  await prisma.$executeRawUnsafe(backfill);
  chk("وتشغيلُه ثانيةً لا يكرّر شيئاً", (await count()) === rows.length, String(await count()));

  // ── تنظيف
  await purge();
  return done();

  async function done() {
    console.log(log.join("\n"));
    const failed = log.some((l) => l.startsWith("✗"));
    console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  }
})().catch(async (e) => {
  console.error(e);
  await purge().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
