import { prisma } from "@/lib/prisma";
import { TICKET_INCLUDE, openTicketsWhere, type FullTicket } from "@/lib/tickets";

type Viewer = { user: { id: string; role: string; departmentId?: string | null } };

/** ما تعرضه لوحةُ التذاكر — أعدادٌ وستُّ تذاكر، لا القائمةُ كلّها.
 *
 *  كانت اللوحةُ تقرأ **كلَّ** التذاكر المفتوحة لتعدّها وتعرض ستّاً منها.
 *  فبمئاتٍ يكبر الردّ، وبآلافٍ سقطت لوحةُ المؤسس (قِيس على ثلاثة آلاف
 *  تذكرة). فصارت الأعدادُ عدّاً في القاعدة، والمعروضُ ستٌّ بترتيب الأولوية
 *  نفسه: المتأخّرةُ أولاً، ثم التي لم تُلمَس، ثم قيد العمل. وكلُّها
 *  متوازية — رحلةٌ واحدة إلى القاعدة لا سبع. */
export const BOARD_TOP = 6;

export async function ticketBoardData(viewer: Viewer): Promise<{
  counts: { late: number; untouched: number; working: number; mine: number; open: number };
  top: FullTicket[];
}> {
  const now = new Date();
  const base = openTicketsWhere(viewer);
  const lateW = { AND: [base, { stageDueAt: { lt: now } }] };
  const untouchedW = { AND: [base, { status: "open" as const }, { stageDueAt: { gte: now } }] };
  const workingW = { AND: [base, { status: "in_progress" as const }, { stageDueAt: { gte: now } }] };
  const mineW = {
    AND: [base, { OR: [{ targetUserId: viewer.user.id }, { raisedByUserId: viewer.user.id }] }],
  };
  const pick = (where: object) =>
    prisma.ticket.findMany({ where, include: TICKET_INCLUDE, orderBy: { stageDueAt: "asc" }, take: BOARD_TOP });

  const [late, untouched, working, mine, open, topLate, topUntouched, topWorking] = await Promise.all([
    prisma.ticket.count({ where: lateW }),
    prisma.ticket.count({ where: untouchedW }),
    prisma.ticket.count({ where: workingW }),
    prisma.ticket.count({ where: mineW }),
    prisma.ticket.count({ where: base }),
    pick(lateW),
    pick(untouchedW),
    pick(workingW),
  ]);

  return {
    counts: { late, untouched, working, mine, open },
    top: [...topLate, ...topUntouched, ...topWorking].slice(0, BOARD_TOP),
  };
}
