import { prisma } from "@/lib/prisma";
import { OPEN_DEPARTMENT_WHERE, DEPARTMENT_TAKE } from "@/lib/committees";
import { isLeadership } from "@/lib/announcements";
import { TICKET_TARGET_USER_SELECT, TICKET_TARGET_MEMBER_SELECT, TICKET_TARGET_TAKE } from "@/lib/tickets";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { themeFromColor } from "@/lib/brand";
import type { TicketTarget } from "./TicketComposer";

/** وجهاتُ التذكرة — تُحسب على الخادم لدور صاحبها، **بالقواعد نفسها التي
 *  كانت في صفحاتها**: هنا جُمعت ولم تُغيَّر.
 *
 *  ملفٌّ خادميٌّ يُستورد في الصفحات وحدها (يقرأ القاعدة). */

type Groups = { departments: string; leadership: string; members: string };

/** للإداري: الأقسام (والاستثنائيُّ للإدارة العليا وحدها)، والحساباتُ
 *  الإدارية سواه، والأعضاءُ المعتمدون */
export async function adminTicketTargets(
  viewer: { id: string; role: string },
  G: Groups,
  roleLabel: (role: string) => string
): Promise<TicketTarget[]> {
  const [departments, people, members] = await Promise.all([
    prisma.department.findMany({
      where: OPEN_DEPARTMENT_WHERE,
      orderBy: { name: "asc" },
      take: DEPARTMENT_TAKE,
    }),
    // لا يُوجَّه أحدٌ تذكرةً لنفسه
    prisma.user.findMany({
      where: { isActive: true, id: { not: viewer.id } },
      select: TICKET_TARGET_USER_SELECT,
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
      take: TICKET_TARGET_TAKE,
    }),
    prisma.member.findMany({
      where: ROSTER_MEMBER_WHERE,
      select: TICKET_TARGET_MEMBER_SELECT,
      orderBy: { fullName: "asc" },
      take: TICKET_TARGET_TAKE,
    }),
  ]);

  return [
    ...departments
      .filter((d) => !d.leadershipOnly || isLeadership(viewer.role))
      .map((d) => ({ value: `dept:${d.id}`, label: d.name, group: G.departments, color: d.colorHex, colorInk: themeFromColor(d.colorHex).text })),
    ...people.map((u) => ({ value: `user:${u.id}`, label: u.fullName, sub: roleLabel(u.role), group: G.leadership })),
    ...members.map((m) => ({
      value: `member:${m.id}`,
      label: m.fullName,
      sub: m.department?.name,
      group: G.members,
    })),
  ];
}

/** للعضو: الأقسام، وزملاءُ قسمه (طرفُ مسار العمل اليومي)، والحساباتُ
 *  الإدارية — كما كانت في بوابته */
export async function memberTicketTargets(
  member: { id: string; departmentId: string | null },
  G: Groups,
  roleLabel: (role: string) => string
): Promise<TicketTarget[]> {
  const [departments, colleagues, leadership] = await Promise.all([
    prisma.department.findMany({
      where: OPEN_DEPARTMENT_WHERE,
      orderBy: { name: "asc" },
      take: DEPARTMENT_TAKE,
    }),
    prisma.member.findMany({
      where: { ...ROSTER_MEMBER_WHERE, departmentId: member.departmentId, id: { not: member.id } },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
      take: TICKET_TARGET_TAKE,
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: TICKET_TARGET_USER_SELECT,
      orderBy: { fullName: "asc" },
      take: TICKET_TARGET_TAKE,
    }),
  ]);

  return [
    ...departments.map((d) => ({ value: `dept:${d.id}`, label: d.name, group: G.departments, color: d.colorHex, colorInk: themeFromColor(d.colorHex).text })),
    ...colleagues.map((m) => ({ value: `member:${m.id}`, label: m.fullName, group: G.members })),
    ...leadership.map((u) => ({ value: `user:${u.id}`, label: u.fullName, sub: roleLabel(u.role), group: G.leadership })),
  ];
}
