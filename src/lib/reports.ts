import { prisma } from "@/lib/prisma";
import { accountRoleLabel } from "@/lib/testTracks";

/** التقارير — ملخّصٌ يبقى بعد أن تُؤرشَف التذاكر.
 *
 *  **ولماذا عدّادٌ لا استعلامٌ على التذاكر؟** المغلقةُ تُحال إلى الإكسل
 *  كلَّ سبت لتبقى المنصة خفيفة. فلو حُسب التقرير من صفوفها لصار تقرير
 *  أسبوعٍ واحد ثم يُفرَّغ، ولو أُبقيت الصفوف من أجله لعاد الحمل الذي
 *  أُريد تخفيفه. فالنتيجة تُعَدّ لحظةَ الإغلاق في صفٍّ واحد لكل نطاق،
 *  ويبقى العدّاد وإن زالت التذاكر.
 *
 *  **ومن يرى ماذا:** التنفيذي يرى ملخّص القادة (قسماً قسماً)، وقائدُ
 *  القسم يرى أعضاءه هو — لا أعضاء غيره. والمؤسس يرى الكلّ. والحرس في
 *  الاستعلام نفسه: لا تُجلَب صفوفُ قسمٍ آخر ثم تُخفى.
 */

export type TallyRow = { onTime: number; late: number; withdrawn: number };

const ZERO: TallyRow = { onTime: 0, late: 0, withdrawn: 0 };

/** نسبةُ الالتزام — وتُعاد `null` حين لا شيء يُقاس بعد.
 *
 *  وصفرٌ من صفر ليس صفراً بالمئة: «٠٪» تُقرأ تقصيراً، و«لا تذاكر بعد»
 *  تُقرأ حقيقةً. */
export function onTimeRate(t: TallyRow): number | null {
  const judged = t.onTime + t.late;
  return judged === 0 ? null : Math.round((t.onTime / judged) * 100);
}

async function talliesFor(scopes: string[]): Promise<Map<string, TallyRow>> {
  if (scopes.length === 0) return new Map();
  const rows = await prisma.ticketTally.findMany({
    where: { scope: { in: scopes } },
    select: { scope: true, onTime: true, late: true, withdrawn: true },
  });
  return new Map(rows.map((r) => [r.scope, { onTime: r.onTime, late: r.late, withdrawn: r.withdrawn }]));
}

export type DepartmentReport = {
  departmentId: string;
  departmentName: string;
  colorHex: string;
  leadName: string | null;
  leadRole: string | null;
  membersCount: number;
  openTickets: number;
  tally: TallyRow;
  onTimeRate: number | null;
};

/** ملخّص القادة — للتنفيذي والمؤسس: قسمٌ قسماً */
export async function departmentsReport(): Promise<DepartmentReport[]> {
  const departments = await prisma.department.findMany({
    orderBy: [{ leadershipOnly: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      colorHex: true,
      admins: {
        where: { isActive: true, role: "department_admin" },
        select: { fullName: true, role: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      _count: {
        select: { members: { where: { isActive: true, approvalStatus: "approved" } } },
      },
    },
  });

  const tallies = await talliesFor(departments.map((d) => `dept:${d.id}`));

  // المفتوحةُ تُعَدّ من الصفوف: هي قليلةٌ بطبعها ولم تُؤرشَف بعد
  const open = await prisma.ticket.groupBy({
    by: ["targetDepartmentId"],
    where: { status: { not: "resolved" }, targetDepartmentId: { not: null } },
    _count: { _all: true },
  });
  const openByDept = new Map(
    open.map((o) => [o.targetDepartmentId as string, o._count._all])
  );

  return departments.map((d) => {
    const tally = tallies.get(`dept:${d.id}`) ?? ZERO;
    return {
      departmentId: d.id,
      departmentName: d.name,
      colorHex: d.colorHex,
      leadName: d.admins[0]?.fullName ?? null,
      leadRole: d.admins[0] ? accountRoleLabel(d.admins[0].role) : null,
      membersCount: d._count.members,
      openTickets: openByDept.get(d.id) ?? 0,
      tally,
      onTimeRate: onTimeRate(tally),
    };
  });
}

export type MemberReport = {
  memberId: string;
  fullName: string;
  jobTitle: string | null;
  warningsCount: number;
  openTickets: number;
  raisedTotal: number;
  joinedAt: Date;
};

/** ملخّص الأعضاء — لقائد القسم عن أعضائه هو.
 *
 *  والمقياس هنا غيرُ مقياس القادة: العضو يرفع التذاكر ولا يُغلقها
 *  غالباً، فقياسُه بالالتزام بالإغلاق ظلم. فيُقاس بما يخصّه: كم رفع،
 *  وكم مفتوحٌ عليه الآن، وتنبيهاته.
 */
export async function membersReport(departmentId: string): Promise<MemberReport[]> {
  const members = await prisma.member.findMany({
    where: { departmentId, isActive: true, approvalStatus: "approved" },
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      warningsCount: true,
      createdAt: true,
      decidedAt: true,
      _count: { select: { tickets: true } },
    },
    orderBy: { fullName: "asc" },
  });

  const openCounts = await prisma.ticket.groupBy({
    by: ["memberId"],
    where: {
      memberId: { in: members.map((m) => m.id) },
      status: { not: "resolved" },
    },
    _count: { _all: true },
  });
  const openByMember = new Map(openCounts.map((o) => [o.memberId as string, o._count._all]));

  return members.map((m) => ({
    memberId: m.id,
    fullName: m.fullName,
    jobTitle: m.jobTitle,
    warningsCount: m.warningsCount,
    openTickets: openByMember.get(m.id) ?? 0,
    raisedTotal: m._count.tickets,
    joinedAt: m.decidedAt ?? m.createdAt,
  }));
}

/** التذاكر التي أُغلقت في موعدها — ما زال معروضاً منها.
 *
 *  وما أُرشف منها معدودٌ في العدّاد ومحفوظٌ في الإكسل: الشاشة تُظهر
 *  الأسبوع الجاري، والرقمُ يُظهر التاريخ كلَّه. وقولُ ذلك صريحاً خيرٌ من
 *  قائمةٍ تبدو ناقصةً بلا تفسير.
 */
export async function closedOnTimeTickets(limit = 50) {
  const rows = await prisma.ticket.findMany({
    where: { status: "resolved", withdrawnAt: null },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      resolvedAt: true,
      firstDueAt: true,
      stage: true,
      targetDepartment: { select: { name: true, colorHex: true } },
      resolvedByUser: { select: { fullName: true } },
    },
    orderBy: { resolvedAt: "desc" },
    take: limit,
  });

  return rows
    .map((t) => ({
      ...t,
      onTime: t.firstDueAt && t.resolvedAt ? t.resolvedAt <= t.firstDueAt : null,
    }))
    .filter((t) => t.onTime === true);
}
