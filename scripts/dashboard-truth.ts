/** ما يجب أن تقوله لمحةُ الأقسام — من القاعدة مباشرةً، لمقارنته بالمرسوم. */
import { PrismaClient } from "@prisma/client";
import { OPEN_DEPARTMENT_WHERE } from "../src/lib/committees";
import { ROSTER_MEMBER_WHERE } from "../src/lib/roster";
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.department.findMany({
    where: { ...OPEN_DEPARTMENT_WHERE, parentId: null },
    select: { name: true, _count: { select: { members: { where: ROSTER_MEMBER_WHERE } } } },
  });
  console.log(JSON.stringify(Object.fromEntries(rows.map((r) => [r.name, r._count.members]))));
  await prisma.$disconnect();
})();
