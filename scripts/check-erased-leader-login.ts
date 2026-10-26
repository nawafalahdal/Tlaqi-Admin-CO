import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/credentials";
import { issueLoginCode } from "@/lib/loginCodes";

/** دخولُ من حُذف حسابه الإداري وبقي سجلُّ ترشّحه — عبر الخادم المحلي، بطلب الدخول الحقيقي.
 *
 *  أسوأ الحالات عمداً: سجلُّ قائدٍ معتمَد بكلمة مرورٍ معروفة (من قبل أن تُفرَّغ عند
 *  الترقية) ورمزِ بريدٍ صحيح — ومع ذلك لا يُفتح له. والضابطُ: مرشّحٌ قياديٌّ لم يُعتمد
 *  بعد يدخل بالطريق نفسه (ليختبر) — فالرفضُ للسجلّ القيادي لا لعطبٍ في الفحص.
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
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

async function cleanup() {
  for (const email of [ORPHAN, CANDIDATE]) {
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
  const record = async (email: string, approvalStatus: "approved" | "pending_review") => {
    const invite = await prisma.invite.create({
      data: { fullName: "فحص دخول", email, targetRole: "department_admin", departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
    });
    return prisma.member.create({
      data: { fullName: "فحص دخول", email, inviteId: invite.id, departmentId: dept.id, approvalStatus, isActive: true, passwordHash, ...(approvalStatus === "approved" ? { decidedAt: new Date() } : {}) },
    });
  };
  await record(ORPHAN, "approved");
  await record(CANDIDATE, "pending_review");

  const control = await signIn(CANDIDATE);
  chk("الضابط: مرشّحٌ قياديٌّ لم يُعتمد يدخل بكلمته ورمز البريد", control === CANDIDATE, String(control));
  const orphan = await signIn(ORPHAN);
  chk("**وسجلُّ قائدٍ حُذف حسابُه لا يُدخل — ولو بكلمة مرورٍ صحيحة ورمزٍ صحيح**", orphan === null, String(orphan));

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
