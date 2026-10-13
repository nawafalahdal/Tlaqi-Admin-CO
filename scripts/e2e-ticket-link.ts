import { prisma } from "@/lib/prisma";
import { ticketVisibilityWhere } from "@/lib/tickets";
import type { Session } from "next-auth";

/** يتحقّق من أن باب التذكرة يقود كلَّ دورٍ إلى لوحةٍ تُظهر تذكرته.
 *
 *  يُحاكي قرار المسار نفسه: نفس `ticketVisibilityWhere`، ونفس اختيار
 *  اللوحة بالدور. فلا يُختبَر HTTP بل القاعدة التي يُبنى عليها — وهي
 *  موضع العطب الذي كان. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

function sess(role: string, id: string, departmentId: string | null): Session {
  return {
    user: { id, role, departmentId, name: "اختبار", email: "x@example.test" },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  } as unknown as Session;
}
const boardFor = (role: string) => (role === "member" ? "/member" : "/admin/tickets");

(async () => {
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const member = await prisma.member.findFirstOrThrow({
    where: { departmentId: dept.id, isActive: true },
  });
  const lead = await prisma.user.findFirst({
    where: { role: "department_admin", departmentId: dept.id, isActive: true },
  });

  // تذكرة رفعها عضو ووجّهها لقسمه — هي الحالة التي كان رابطها يكسر
  const t = await prisma.ticket.create({
    data: {
      subject: "اختبار رابط التذكرة",
      description: "تذكرة اختبار",
      memberId: member.id,
      targetDepartmentId: dept.id,
      stage: "department",
      stageDueAt: new Date(Date.now() + 2 * 86400_000),
    },
  });

  // الفاوندر مستثنى من هذه الحلقة عمداً — له تحقّقه الخاص أدناه.
  //
  // فهو **لا يرى** تذكرةً قسميّةً لم تُصعَّد إليه، وهذا قرارُ حوكمةٍ
  // مقصود: «فقط يكون بالترتيب». ولو رآها لرأى كلّ تذكرةٍ في المنصة
  // بصفته لا بدوره فيها — وهو نفس ما مُنِع في توجيه البريد.
  for (const [label, s] of [
    ["العضو صاحب التذكرة", sess("member", member.id, dept.id)],
    ...(lead ? ([["قائد القسم", sess("department_admin", lead.id, dept.id)]] as const) : []),
  ] as [string, Session][]) {
    const visible = await prisma.ticket.findFirst({
      where: { AND: [{ ticketNumber: t.ticketNumber }, ticketVisibilityWhere(s)] },
      select: { id: true },
    });
    const board = boardFor(s.user.role);
    chk(`${label}: التذكرة مرئية له`, Boolean(visible));
    chk(
      `${label}: يُحوَّل إلى لوحةٍ تُظهرها (${board})`,
      Boolean(visible) && (s.user.role === "member" ? board === "/member" : board === "/admin/tickets")
    );
    // العطب القديم: العضو كان يُرسَل إلى /admin/tickets وهي تردّه
    if (s.user.role === "member") {
      const adminAllowed = ["super_admin", "executive", "operations_officer", "department_admin"];
      chk(
        "العضو لم يُعَد إلى /admin/tickets التي تردّه",
        board !== "/admin/tickets" && !adminAllowed.includes("member")
      );
    }
  }

  // حوكمة الفاوندر: لا يراها قبل التصعيد، ويراها بعده
  const fSess = sess("super_admin", founder.id, null);
  const beforeEsc = await prisma.ticket.findFirst({
    where: { AND: [{ ticketNumber: t.ticketNumber }, ticketVisibilityWhere(fSess)] },
    select: { id: true },
  });
  chk("الفاوندر لا يرى تذكرةً قسميّةً لم تُصعَّد إليه — «بالترتيب»", beforeEsc === null);

  await prisma.ticket.update({ where: { id: t.id }, data: { stage: "founder_escalation" } });
  const afterEsc = await prisma.ticket.findFirst({
    where: { AND: [{ ticketNumber: t.ticketNumber }, ticketVisibilityWhere(fSess)] },
    select: { id: true },
  });
  chk("ويراها حين تُصعَّد إليه", Boolean(afterEsc));
  chk("ويُحوَّل إلى /admin/tickets", boardFor("super_admin") === "/admin/tickets");
  await prisma.ticket.update({ where: { id: t.id }, data: { stage: "department" } });

  // وتذكرةٌ رفعها هو يراها دائماً
  const own = await prisma.ticket.create({
    data: {
      subject: "تذكرة رفعها الفاوندر",
      description: "اختبار",
      raisedByUserId: founder.id,
      targetDepartmentId: dept.id,
      stage: "department",
      stageDueAt: new Date(Date.now() + 2 * 86400_000),
    },
  });
  const ownVisible = await prisma.ticket.findFirst({
    where: { AND: [{ ticketNumber: own.ticketNumber }, ticketVisibilityWhere(fSess)] },
    select: { id: true },
  });
  chk("ويرى تذكرةً رفعها بنفسه — الدور يُدخِله لا الصفة", Boolean(ownVisible));
  await prisma.ticket.delete({ where: { id: own.id } });

  // عضو من قسمٍ آخر لا يراها
  const other = await prisma.member.findFirst({
    where: { departmentId: { not: dept.id }, isActive: true, id: { not: member.id } },
  });
  if (other) {
    const visible = await prisma.ticket.findFirst({
      where: {
        AND: [{ ticketNumber: t.ticketNumber }, ticketVisibilityWhere(sess("member", other.id, other.departmentId))],
      },
      select: { id: true },
    });
    chk("عضوٌ من قسمٍ آخر لا يراها", visible === null);
  }

  // رقمٌ لا وجود له
  const none = await prisma.ticket.findFirst({
    where: { AND: [{ ticketNumber: 999999 }, ticketVisibilityWhere(sess("super_admin", founder.id, null))] },
    select: { id: true },
  });
  chk("رقمٌ لا وجود له لا يُفتح", none === null);

  await prisma.ticket.delete({ where: { id: t.id } });

  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
