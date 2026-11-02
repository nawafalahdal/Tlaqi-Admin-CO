import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";

type Db = Prisma.TransactionClient | typeof prisma;

/** ما ينقص لجنةً لتُعتمد — **ولا تُعتمد لجنةٌ ناقصة** (ملاحظةُ المؤسس الخامسة).
 *
 *  المكتملةُ: غرضٌ مكتوب، ونوع، وقائدٌ نشطٌ من أعضاء قسمها، وعضوٌ آخر نشطٌ على الأقل،
 *  وتاريخُ نهايةٍ إن كانت مؤقّتة. ويُقرأ كلُّ ذلك من القاعدة لحظةَ القرار، لا من النموذج.
 *  والقائمةُ الفارغة تعني «مكتملة». */
export type CommitteeGap = "purpose" | "kind" | "lead" | "members" | "endDate";

export async function committeeGaps(db: Db, committeeId: string): Promise<CommitteeGap[] | null> {
  const c = await db.department.findUnique({
    where: { id: committeeId },
    select: {
      parentId: true,
      purpose: true,
      committeeKind: true,
      endDate: true,
      leadMemberId: true,
      committeeMemberships: { where: { active: true }, select: { memberId: true } },
    },
  });
  if (!c?.parentId) return null;
  const gaps: CommitteeGap[] = [];
  if (!c.purpose?.trim()) gaps.push("purpose");
  if (!c.committeeKind) gaps.push("kind");
  if (c.committeeKind === "temporary" && !c.endDate) gaps.push("endDate");
  const lead = c.leadMemberId
    ? await db.member.findFirst({
        where: { id: c.leadMemberId, ...ROSTER_MEMBER_WHERE, terminatedAt: null, departmentId: c.parentId },
        select: { id: true },
      })
    : null;
  if (!lead || !c.committeeMemberships.some((m) => m.memberId === lead.id)) gaps.push("lead");
  const others = c.committeeMemberships.filter((m) => m.memberId !== c.leadMemberId).map((m) => m.memberId);
  const activeOthers = others.length
    ? await db.member.count({ where: { id: { in: others }, ...ROSTER_MEMBER_WHERE, terminatedAt: null } })
    : 0;
  if (activeOthers === 0) gaps.push("members");
  return gaps;
}

export const GAP_LABELS: Record<CommitteeGap, string> = {
  purpose: "الغرض",
  kind: "نوع اللجنة",
  lead: "قائدٌ نشطٌ من أعضاء القسم",
  members: "عضوٌ نشطٌ آخر غير القائد",
  endDate: "تاريخُ النهاية للجنة المؤقّتة",
};
