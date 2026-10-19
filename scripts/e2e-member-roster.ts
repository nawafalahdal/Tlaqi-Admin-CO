/** «الرئيسُ التنفيذيُّ يظهر عضواً عادياً في قائمة أعضائه» — مُعادٌ ثم مُصلَح.
 *
 *  المرشّح القيادي يُسجَّل صفّاً في `Member` ثم يُعتمَد فيُنشأ له `User`،
 *  ويبقى صفُّه المرشّح `approved` و`isActive`. والقوائم كانت تسأل عن
 *  هذين وحدهما. هذا الفحص يبني الحالة على قاعدةٍ محلية ويُثبت:
 *  أنّ الشرط القديم يُدخل القادة (العطبُ مُعاد)، وأنّ `ROSTER_MEMBER_WHERE`
 *  لا يُدخلهم، وأنّ التقارير والعدّادات تقرأ الشرط الجديد.
 *
 *  تجهيزاتٌ مُعلَّمة تُنشأ وتُحذف — لا يُمسّ صفٌّ قائم.
 */
import { PrismaClient } from "@prisma/client";
import { ROSTER_MEMBER_WHERE, isRosterMember } from "../src/lib/roster";
import { membersReport } from "../src/lib/reports";

const prisma = new PrismaClient();
const log: string[] = [];
const chk = (name: string, ok: boolean, detail = "") =>
  log.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);

const TAG = `roster-e2e-${Date.now()}`;

async function main() {
  const founder = await prisma.user.findFirst({ where: { role: "super_admin" } });
  const dept = await prisma.department.findFirst({ where: { leadershipOnly: false } });
  const track = await prisma.testTrack.findFirst();
  if (!founder || !dept || !track) throw new Error("قاعدةٌ محلية بلا مؤسسٍ أو قسمٍ أو مسار اختبار");

  const mk = async (role: "member" | "executive" | "department_admin", departmentId: string | null) => {
    const email = `${role}.${TAG}@example.test`;
    const invite = await prisma.invite.create({
      data: {
        fullName: `${role} ${TAG}`, email, targetRole: role, departmentId,
        testTrackId: track.id, invitedById: founder.id, status: "used",
      },
    });
    const member = await prisma.member.create({
      data: {
        fullName: `${role} ${TAG}`, email, departmentId, inviteId: invite.id,
        approvalStatus: "approved", testStatus: "passed", isActive: true, decidedAt: new Date(),
      },
    });
    // ما يفعله `approveMember` للمرشّح القيادي: حسابٌ إداريٌّ بالبريد نفسه
    if (role !== "member") {
      await prisma.user.create({
        data: {
          fullName: `${role} ${TAG}`, email, passwordHash: "x", role,
          departmentId: role === "department_admin" ? departmentId : null,
        },
      });
    }
    return member;
  };

  try {
    const ceo = await mk("executive", null);
    const leader = await mk("department_admin", dept.id);
    const plain = await mk("member", dept.id);
    const ids = [ceo.id, leader.id, plain.id];

    // ── العطبُ مُعاد: الشرط القديم ──
    const old = await prisma.member.findMany({
      where: { id: { in: ids }, isActive: true, approvalStatus: "approved" },
      select: { id: true },
    });
    chk("**العطبُ مُعاد: الشرط القديم يَعُدّ الرئيسَ التنفيذيَّ والقائدَ أعضاءً**",
        old.length === 3, `${old.length} من 3`);

    // ── والإصلاح ──
    const now = await prisma.member.findMany({
      where: { id: { in: ids }, ...ROSTER_MEMBER_WHERE },
      select: { id: true },
    });
    chk("**الرئيسُ التنفيذيُّ ليس في قائمة الأعضاء**", !now.some((m) => m.id === ceo.id));
    chk("**ولا القائدُ مرّةً ثانيةً عضواً في قسمه**", !now.some((m) => m.id === leader.id));
    chk("والعضوُ الحقيقيُّ فيها", now.length === 1 && now[0].id === plain.id);

    // الصيغةُ في الذاكرة تُطابق الشرط
    const rows = await prisma.member.findMany({ where: { id: { in: ids } }, include: { invite: true } });
    chk("والتقسيمُ في الذاكرة يُطابق الاستعلام",
        rows.filter(isRosterMember).map((r) => r.id).join() === plain.id);

    // ── تقرير القسم ──
    const report = await membersReport(dept.id);
    chk("تقريرُ القسم لا يَعرض القائدَ عضواً", !report.some((r) => r.memberId === leader.id));
    chk("ويَعرض العضوَ", report.some((r) => r.memberId === plain.id));

    // ── عدّاد القسم ──
    const counted = await prisma.department.findUnique({
      where: { id: dept.id },
      select: { _count: { select: { members: { where: { id: { in: ids }, ...ROSTER_MEMBER_WHERE } } } } },
    });
    chk("وعدّادُ أعضاء القسم لا يَعُدّ قائدَه", counted?._count.members === 1, `${counted?._count.members}`);

    // ── وصفُّ المرشّح لم يُمَسّ: سجلُّ اعتماده باقٍ ──
    const kept = await prisma.member.findUnique({ where: { id: ceo.id } });
    chk("وصفُّ المرشّح باقٍ كما هو — لا تعديلَ على البيانات",
        kept?.approvalStatus === "approved" && kept.isActive === true);
  } finally {
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.member.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.invite.deleteMany({ where: { email: { contains: TAG } } });
  }

  console.log(log.join("\n"));
  const failed = log.filter((l) => l.startsWith("✗")).length;
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  if (failed) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
