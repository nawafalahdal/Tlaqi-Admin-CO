import { prisma } from "@/lib/prisma";
import { stepDownMember, markCertificateShared, markFarewellDesigned, closeOffboarding } from "@/lib/offboarding";
import { earnsFinalCertificate, serviceDays, MIN_SERVICE_DAYS_FOR_CERTIFICATE } from "@/lib/certificate";

/** حوكمة الأسبوعين — من يخرج خلال أول أسبوعين لا تُصدَر له شهادة شكر وخبرة.
 *
 *  على عضوَين يُنشآن ويُحذفان في القاعدة المحلية وحدها: أحدهما خرج بعد
 *  أسبوع، والآخر بعد شهر. والحدُّ نفسُه يُفحَص على طرفيه (١٣ و١٤ يوماً). */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const MARK = `e2e-ee-${Date.now()}`;
const EMAILS = [`short-${MARK}@example.test`, `long-${MARK}@example.test`];
const DAY = 86_400_000;

async function cleanup() {
  await prisma.member.deleteMany({ where: { email: { in: EMAILS } } });
  await prisma.invite.deleteMany({ where: { email: { in: EMAILS } } });
}

async function makeMember(email: string, joinedDaysAgo: number) {
  const dept = await prisma.department.findFirstOrThrow({ where: { parentId: null, leadershipOnly: false } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member", departmentId: dept.id } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const joined = new Date(Date.now() - joinedDaysAgo * DAY);
  const invite = await prisma.invite.create({
    data: { fullName: "فحص خروج", email, targetRole: "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  return prisma.member.create({
    data: {
      fullName: "فحص خروج", email, departmentId: dept.id, inviteId: invite.id, passwordHash: "x",
      approvalStatus: "approved", testStatus: "passed", isActive: true,
      joinDate: joined, decidedAt: joined, jobTitle: "حساب فحص",
    },
  });
}

(async () => {
  await cleanup();

  // ١ — الحدُّ على طرفيه
  const base = { orgJoinDate: null, decidedAt: null, stepDownAt: null, terminatedAt: null };
  const start = new Date("2026-10-01T00:00:00Z");
  chk(`الحدّ ${MIN_SERVICE_DAYS_FOR_CERTIFICATE} يوماً`, MIN_SERVICE_DAYS_FOR_CERTIFICATE === 14);
  chk("١٣ يوماً: لا شهادة", !earnsFinalCertificate({ ...base, joinDate: start, endDate: new Date(start.getTime() + 13 * DAY) }));
  chk("١٤ يوماً: شهادة", earnsFinalCertificate({ ...base, joinDate: start, endDate: new Date(start.getTime() + 14 * DAY) }));
  chk("والانضمامُ التنظيميُّ يُقدَّم على تاريخ الحساب", earnsFinalCertificate({
    ...base, orgJoinDate: new Date(start.getTime() - 60 * DAY), joinDate: start, endDate: new Date(start.getTime() + 3 * DAY),
  }));

  // ٢ — خرج بعد أسبوع: لا شهادة، ويُختم بالوداع وحده
  const short = await makeMember(EMAILS[0], 5);
  const sd = await stepDownMember({ memberId: short.id, byName: "فحص", reason: "اختبار الحوكمة", endDate: new Date(Date.now() + 2 * DAY) });
  chk("تُنفَّذ تنحيته", sd.ok);
  const afterSd = await prisma.member.findUniqueOrThrow({ where: { id: short.id } });
  chk("مسيرته ٧ أيام", serviceDays(afterSd) === 7, String(serviceDays(afterSd)));
  const cert = await markCertificateShared(short.id, "فحص");
  chk("ولا تُصدَر له شهادة", !cert.ok && /أول أسبوعين/.test((cert as { reason: string }).reason),
      cert.ok ? "صدرت!" : (cert as { reason: string }).reason);
  chk("ولا يُختَم إصدارُها", (await prisma.member.findUniqueOrThrow({ where: { id: short.id } })).certificateIssuedAt === null);
  await markFarewellDesigned(short.id, "فحص");
  const closed = await closeOffboarding(short.id, "فحص");
  chk("ويُختَم خروجُه بالوداع ورسالة الشكر دون انتظار شهادة", closed.ok, closed.ok ? "" : (closed as { reason: string }).reason);

  // ٣ — خرج بعد شهر: الشهادةُ شرطُ الختام كما كانت
  const long = await makeMember(EMAILS[1], 30);
  await stepDownMember({ memberId: long.id, byName: "فحص", reason: "اختبار الحوكمة", endDate: new Date() });
  await markFarewellDesigned(long.id, "فحص");
  const early = await closeOffboarding(long.id, "فحص");
  chk("من أتمّ أسبوعين لا يُختَم بلا شهادة", !early.ok && /شهادته/.test((early as { reason: string }).reason));
  await markCertificateShared(long.id, "فحص"); // البريدُ معطّلٌ محلياً، والإصدارُ يُختَم
  const issued = (await prisma.member.findUniqueOrThrow({ where: { id: long.id } })).certificateIssuedAt;
  chk("وتُصدَر له الشهادة", issued !== null);
  const closedLong = await closeOffboarding(long.id, "فحص");
  chk("ثم يُختَم", closedLong.ok, closedLong.ok ? "" : (closedLong as { reason: string }).reason);

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
