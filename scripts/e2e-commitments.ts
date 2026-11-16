/** **إضافةُ الالتزام في كل الأقسام، بلا تكرارٍ عند الإعادة** (البند ٤):
 *  - كلُّ قسمٍ أصيل (ومنه الإدارةُ العليا) يضيف التزاماً في خطة أسبوعه — بقائده إن وُجد، وإلا بالمؤسس.
 *  - إعادةُ الطلب نفسه (المفتاحُ نفسه) تعيد الالتزامَ نفسه، وطلبان متزامنان لا يُنشئان اثنين.
 *  - وحارسُ النقل (`guardAction`) يعيد فشلَ النقل خطأً في مكانه، ويمرّر التوجيهَ كما هو.
 *  تشغيل: DATABASE_URL=… npx tsx --tsconfig tsconfig.json scripts/e2e-commitments.ts */
import type { Session } from "next-auth";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}
const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const DAY = 86_400_000;

(async () => {
  try {
    const { ensurePeriod, periodStartFor } = await import("@/lib/execution");
    const { ensureWeekPlan } = await import("@/lib/carryover");
    const { createTask } = await import("@/lib/tasks");
    const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", isActive: true } });
    const sessOf = (u: { id: string; role: string; fullName: string; departmentId: string | null }) =>
      ({ user: { id: u.id, role: u.role, name: u.fullName, departmentId: u.departmentId } }) as unknown as Session;
    // أسبوعٌ بعيدٌ لا يسكنه أحد — كما في `e2e-execution`
    const period = await ensurePeriod(periodStartFor(new Date(Date.now() + 260 * DAY)));
    const due = new Date(period.weekEnd.getTime() - DAY);

    // الإدارةُ العليا قسمٌ كغيره في خطط الأسبوع (يضيفها قائدُها عبر «التنفيذ») — تُنشأ إن غابت عن القاعدة المحلية
    if (!(await prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null } }))) {
      const { createDepartment } = await import("@/lib/departments");
      await createDepartment({ name: "الإدارة العليا", colorHex: "#341D2B", createdByName: "فحص", leadershipOnly: true });
    }
    const departments = await prisma.department.findMany({
      where: { parentId: null, committeeStatus: null },
      select: { id: true, name: true, leadershipOnly: true },
      orderBy: { createdAt: "asc" },
    });
    chk(`أقسامُ القاعدة: ${departments.length}`, departments.length > 0);
    for (const d of departments) {
      const plan = await ensureWeekPlan(period.id, d.id);
      const lead = await prisma.user.findFirst({ where: { role: "department_admin", departmentId: d.id, isActive: true } });
      const actor = lead ?? founder;
      const member = await prisma.member.findFirst({ where: { departmentId: d.id, isActive: true, approvalStatus: "approved", terminatedAt: null } });
      const owner = member ? { ownerMemberId: member.id } : { ownerUserId: actor.id };
      const key = randomUUID();
      const input = {
        planId: plan.id, title: `التزام ${d.name}`, acceptanceCriteria: "معيار إنجاز واضح", dueAt: due,
        ...owner, clientRequestId: key, session: sessOf(actor),
      };
      const first = await createTask(input);
      chk(`«${d.name}»${d.leadershipOnly ? " (الإدارة العليا)" : ""}: يُضاف الالتزام${lead ? " بقائده" : " بالمؤسس"}`, first.ok, first.ok ? "" : first.reason);
      const again = await createTask(input);
      chk(`«${d.name}»: **إعادةُ الطلب نفسه تعيد الالتزامَ نفسه**`, again.ok && first.ok && again.id === first.id, JSON.stringify(again));
      chk(`«${d.name}»: ولا يتكرّر صفُّه`, (await prisma.planTask.count({ where: { clientRequestId: key } })) === 1);
    }

    // طلبان متزامنان بالمفتاح نفسه
    const d0 = departments[0];
    const plan0 = await ensureWeekPlan(period.id, d0.id);
    const k2 = randomUUID();
    const base = { planId: plan0.id, title: "متزامن", acceptanceCriteria: "معيار", dueAt: due, ownerUserId: founder.id, clientRequestId: k2, session: sessOf(founder) };
    const [a, b] = await Promise.all([createTask(base), createTask(base)]);
    chk("**طلبان متزامنان بالمفتاح نفسه: التزامٌ واحد**", a.ok && b.ok && a.id === b.id && (await prisma.planTask.count({ where: { clientRequestId: k2 } })) === 1, JSON.stringify([a, b]));
    // المفتاحُ في خطةٍ أخرى لا يكشف التزامَ غيرها
    if (departments[1]) {
      const plan1 = await ensureWeekPlan(period.id, departments[1].id);
      const cross = await createTask({ ...base, planId: plan1.id });
      chk("ومفتاحٌ من خطةٍ أخرى لا يعيد التزامَها ولا يُنشئ", !cross.ok && (await prisma.planTask.count({ where: { clientRequestId: k2 } })) === 1, JSON.stringify(cross));
    }
    // بلا مفتاح (نموذجٌ قديم مفتوح): يعمل كما كان
    const noKey = await createTask({ ...base, clientRequestId: null, title: "بلا مفتاح" });
    chk("وبلا مفتاح يعمل كما كان", noKey.ok);
    const badKey = await createTask({ ...base, clientRequestId: "x'; drop", title: "مفتاحٌ غير صالح" });
    chk("ومفتاحٌ بشكلٍ غير صالح يُتجاهل ولا يُخزَّن", badKey.ok && (await prisma.planTask.findUniqueOrThrow({ where: { id: (badKey as { id: string }).id } })).clientRequestId === null);

    // ═══ حارسُ النقل ═══
    const { guardAction } = await import("@/lib/actionGuard");
    const { UnrecognizedActionError } = await import("next/dist/client/components/unrecognized-action-error");
    const { getRedirectError } = await import("next/dist/client/components/redirect");
    // بشكل إجراءات `useActionState`: (الحالة السابقة، النموذج)
    const stale = guardAction(async (...args: [{ error: string | null; success: boolean }, FormData]) => {
      throw new UnrecognizedActionError(`Server Action "abc" was not found on the server (${args.length}).`);
    });
    const r1 = (await stale({ error: null, success: false }, new FormData())) as { error: string; success: boolean; transportFailure?: string };
    chk("**إجراءٌ من نسخةٍ سابقة: خطأٌ في مكانه لا صفحةُ خطأ**", !r1.success && r1.transportFailure === "stale" && r1.error.includes("لم يُحفظ شيء"), JSON.stringify(r1));
    const net = guardAction(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r2 = (await net()) as unknown as { error: string; transportFailure?: string };
    chk("وانقطاعُ الشبكة: يُقال إنه قد لا يكون وصل", r2.transportFailure === "network" && r2.error.includes("تحقّق"), JSON.stringify(r2));
    const srv = guardAction(async () => {
      throw Object.assign(new Error("boom"), { digest: "123456" });
    });
    const r3 = (await srv()) as unknown as { error: string; transportFailure?: string };
    chk("وما رماه الخادم يُقال بمعرّفه", r3.transportFailure === "server" && r3.error.includes("123456"));
    const redirecting = guardAction(async () => {
      throw getRedirectError("/member", "push" as never);
    });
    let rethrown = false;
    try {
      await redirecting();
    } catch {
      rethrown = true;
    }
    chk("**والتوجيهُ يمرّ كما هو** (ليس فشلاً)", rethrown);
    const fine = guardAction(async (x: number) => ({ error: null, value: x * 2 }));
    chk("والنجاحُ يعود كما هو", (await fine(21)).value === 42);
  } catch (e) {
    chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
  } finally {
    for (const c of checks) console.log(c);
    const failedN = checks.filter((c) => c.startsWith("✗")).length;
    console.log(`\n${checks.length - failedN}/${checks.length}`);
    await prisma.$disconnect();
    process.exit(failedN ? 1 : 0);
  }
})();
