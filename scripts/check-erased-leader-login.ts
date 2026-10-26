import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";

/** الدخولُ بعد الحذف — عبر الخادم المحلي، بطلب الدخول الحقيقي (كلمة المرور ثم رمز البريد).
 *
 *  ١) بقيةُ حذفٍ سابق (سجلُّ ترشّح قائدٍ حُذف حسابُه، كلمتُه فُرِّغت عند إنشاء الحساب)
 *     لا يُفتح لها — ولو برمزِ بريدٍ صحيح.
 *  ٢) **ومن لم يُحذف لا يُمَسّ:** عضوٌ أُعيدت دعوتُه واعتُمد يدخل، وقائدٌ تعثّر اعتمادُه
 *     فبقيت كلمتُه يدخل كما كان قبل هذا الإصلاح، والمرشّحُ يدخل ليختبر.
 *
 *    (الخادم يعمل على CHECK_BASE_URL أو localhost:3000)
 *    npx tsx --env-file=.env scripts/check-erased-leader-login.ts */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const PASS = "Erased#2026aa";
const ORPHAN = "erased-lead@example.test";
const CANDIDATE = "pending-lead@example.test";
const HALF = "half-approved-lead@example.test";
const REINVITED = "reinvited-member@example.test";
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

async function cleanup() {
  for (const email of [ORPHAN, CANDIDATE, HALF, REINVITED]) {
    const m = await prisma.member.findUnique({ where: { email } });
    if (m) {
      await prisma.member.delete({ where: { id: m.id } });
      await prisma.invite.deleteMany({ where: { id: m.inviteId } });
    }
    await prisma.invite.deleteMany({ where: { email } });
    await prisma.loginCode.deleteMany({ where: { email } }).catch(() => {});
  }
}

/** دخولٌ حقيقي: رمزُ CSRF، ثم بيانات الاعتماد مع رمز البريد، ثم الجلسة */
async function signIn(email: string): Promise<string | null> {
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
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: PASS, loginCode: String(code), callbackUrl: "/" }),
  });
  keep(res);
  const session = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookie() } });
  const body = (await session.json()) as { user?: { email?: string } } | null;
  return body?.user?.email ?? null;
}

(async () => {
  await cleanup();
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
  const dept = await prisma.department.findFirstOrThrow({ where: { slug: "marketing", parentId: null } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { departmentId: { not: null } } });
  const passwordHash = await hashPassword(PASS);
  const record = async (email: string, targetRole: "member" | "department_admin", approvalStatus: "approved" | "pending_review", hash: string | null) => {
    const invite = await prisma.invite.create({
      data: { fullName: "فحص دخول", email, targetRole, departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    return prisma.member.create({
      data: { fullName: "فحص دخول", email, inviteId: invite.id, departmentId: dept.id, approvalStatus, isActive: true, passwordHash: hash, ...(approvalStatus === "approved" ? { decidedAt: new Date() } : {}) },
    });
  };
  await record(ORPHAN, "department_admin", "approved", null);
  await record(HALF, "department_admin", "approved", passwordHash);
  await record(REINVITED, "member", "approved", passwordHash);
  await record(CANDIDATE, "department_admin", "pending_review", passwordHash);

  chk("**بقيةُ حذفٍ سابق لا تُدخل — ولو برمز بريدٍ صحيح**", (await signIn(ORPHAN)) === null);
  const back = await signIn(REINVITED);
  chk("**وعضوٌ أُعيدت دعوتُه واعتُمد يدخل**", back === REINVITED, String(back));
  const half = await signIn(HALF);
  chk("وقائدٌ تعثّر اعتمادُه (لم يُحذف) يدخل كما كان", half === HALF, String(half));
  const control = await signIn(CANDIDATE);
  chk("والمرشّحُ القياديُّ يدخل ليختبر", control === CANDIDATE, String(control));

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
