/** حساباتُ أدوارٍ للفحص البصري — على القاعدة المحلية وحدها.
 *
 *  `setup` يُنشئ تنفيذياً ومسؤولَ تشغيل وقائدَ قسمٍ وعضواً معتمَداً، كلُّهم
 *  ببريد `@fixture.test` وكلمة مرورٍ معروفة وسرّ TOTP يُمرَّر. `code <email>`
 *  يُصدر رمز دخولٍ للعضو (يُبطل ما أُرسل بالبريد). `teardown` يحذفهم.
 *
 *  يرفض العمل على غير قاعدةٍ محلية — لا تُنشأ حساباتُ فحصٍ في الإنتاج. */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/credentials";
import { issueLoginCode } from "../src/lib/loginCodes";

const prisma = new PrismaClient();
const DOMAIN = "@fixture.test";
export const FIXTURE_PASSWORD = "Fixture#2026aa";

function assertLocal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error("fixtures-roles: يعمل على قاعدةٍ محلية فقط");
  }
}

async function setup(totpSecret: string) {
  await teardown();
  const passwordHash = await hashPassword(FIXTURE_PASSWORD);
  const dept = await prisma.department.findFirstOrThrow({ where: { slug: "tech" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { scope: "department_member", departmentId: dept.id } });

  const admin = (role: "executive" | "operations_officer" | "department_admin", key: string) =>
    prisma.user.create({
      data: {
        fullName: `فحص ${key}`, email: `${key}${DOMAIN}`, passwordHash, role,
        departmentId: role === "department_admin" ? dept.id : null,
        totpEnabled: true, totpSecret, profileCompletedAt: new Date(),
        passwordChangedAt: new Date(), jobTitle: "حساب فحص",
      },
    });
  await admin("executive", "exec");
  await admin("operations_officer", "ops");
  await admin("department_admin", "lead");

  const email = `member${DOMAIN}`;
  const invite = await prisma.invite.create({
    data: { fullName: "فحص عضو", email, targetRole: "member", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  await prisma.member.create({
    data: {
      fullName: "فحص عضو", email, departmentId: dept.id, inviteId: invite.id, passwordHash,
      approvalStatus: "approved", testStatus: "passed", isActive: true, decidedAt: new Date(),
      profileCompletedAt: new Date(), firstLoginAt: new Date(), jobTitle: "حساب فحص",
    },
  });
  console.log("ok");
}

async function teardown() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.leaderSignature.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => console.error(String(e).split("\n")[0]));
  const members = await prisma.member.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  await prisma.member.deleteMany({ where: { id: { in: members.map((m) => m.id) } } }).catch((e) => console.error(String(e).split("\n")[0]));
  await prisma.invite.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.loginCode.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

async function main() {
  assertLocal();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "setup") await setup(arg);
  else if (cmd === "teardown") { await teardown(); console.log("ok"); }
  else if (cmd === "code") console.log(await issueLoginCode(arg));
  else throw new Error("usage: setup <totpSecret> | teardown | code <email>");
}

main().finally(() => prisma.$disconnect());
