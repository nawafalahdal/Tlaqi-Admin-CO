import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Alert } from "@/lib/alerts";
import { getDictionary, type Locale } from "@/i18n";
import { fmt } from "@/i18n/fmt";
import type { OrgActor } from "./actor";

/** تنبيهاتُ الهيكل واللجان في الصفحة الرئيسية — ما ينتظر صاحبَها هو.
 *
 *  - **قائدُ القسم (ونائبُه المفوَّض بإدارة اللجان):** اقتراحاتُ العضوية،
 *    والتقاريرُ غير المراجَعة، واللجانُ العاملة بلا قائد.
 *  - **المؤسس والرئيس التنفيذي:** اللجانُ العاملة بلا قائد وحدها — هما مسارُ
 *    التسليم حين يخلو المقعد، لا مراجعو كلِّ اقتراحٍ في كل قسم.
 *  - **قائدُ اللجنة:** المتأخّرُ من مهامّ لجنته.
 *  - **العضو:** مهامُّه المتأخّرة والمفتوحة، واجتماعاتُ لجانه في اليومين القادمين.
 *
 *  عدٌّ لا جلب: كلُّ تنبيهٍ استعلامُ `count` واحد. */
export async function committeeAlerts(a: OrgActor | null, locale: Locale = "ar"): Promise<Alert[]> {
  if (!a?.role) return [];
  const L = getDictionary(locale).org.alerts;
  const now = new Date();
  const out: Alert[] = [];
  const managed = [a.leadsDepartmentId, a.deputy?.permissions.includes("committees_manage") ? a.deputy.departmentId : null].filter(
    (x): x is string => !!x
  );
  const leaderless = (where: Prisma.DepartmentWhereInput): Prisma.DepartmentWhereInput => ({
    ...where,
    committeeStatus: { in: ["approved", "suspended"] },
    OR: [{ leadMemberId: null }, { leadMember: { OR: [{ isActive: false }, { terminatedAt: { not: null } }] } }],
    admins: { none: { isActive: true, role: "department_admin" } },
  });

  const [proposals, reports, noLead, leadOverdue, myOverdue, myOpen, soon] = await Promise.all([
    managed.length ? prisma.committeeProposal.count({ where: { status: "pending", committee: { parentId: { in: managed } } } }) : 0,
    managed.length ? prisma.committeeReport.count({ where: { reviewedAt: null, committee: { parentId: { in: managed } } } }) : 0,
    // department-scope: all — المعلّقةُ تُحسب أيضاً: لا تُعاد للعمل بلا قائد
    a.isTop || managed.length
      ? prisma.department.count({ where: leaderless(a.isTop ? { parentId: { not: null } } : { parentId: { in: managed } }) })
      : 0,
    a.kind === "member"
      ? prisma.committeeTask.count({
          where: { committee: { leadMemberId: a.id, committeeStatus: "approved" }, status: { in: ["todo", "in_progress"] }, dueAt: { lt: now } },
        })
      : 0,
    a.kind === "member"
      ? prisma.committeeTask.count({
          where: { assigneeMemberId: a.id, committee: { committeeStatus: "approved" }, status: { in: ["todo", "in_progress"] }, dueAt: { lt: now } },
        })
      : 0,
    a.kind === "member"
      ? prisma.committeeTask.count({
          where: { assigneeMemberId: a.id, committee: { committeeStatus: "approved" }, status: { in: ["todo", "in_progress"] } },
        })
      : 0,
    a.kind === "member"
      ? prisma.committeeMeeting.count({
          where: {
            status: "scheduled",
            startsAt: { gte: now, lte: new Date(now.getTime() + 2 * 86_400_000) },
            committee: { committeeStatus: "approved", committeeMemberships: { some: { memberId: a.id, active: true } } },
          },
        })
      : 0,
  ]);

  if (noLead > 0) {
    out.push({ id: "committee-leaderless", tone: "danger", title: fmt(L.leaderless, noLead), body: L.leaderlessBody, href: "/committees?status=approved", cta: L.open });
  }
  if (proposals > 0) {
    out.push({ id: "committee-proposals", tone: "warn", title: fmt(L.proposals, proposals), body: L.proposalsBody, href: "/committees", cta: L.open });
  }
  if (reports > 0) {
    out.push({ id: "committee-reports", tone: "info", title: fmt(L.reports, reports), body: L.reportsBody, href: "/committees", cta: L.open });
  }
  if (leadOverdue > 0) {
    out.push({ id: "committee-lead-overdue", tone: "warn", title: fmt(L.leadOverdue, leadOverdue), body: L.leadOverdueBody, href: "/committees", cta: L.open });
  }
  if (myOverdue > 0) {
    out.push({ id: "committee-my-overdue", tone: "danger", title: fmt(L.myOverdue, myOverdue), body: L.myOverdueBody, href: "/member#committees", cta: L.open });
  } else if (myOpen > 0) {
    out.push({ id: "committee-my-open", tone: "info", title: fmt(L.myOpen, myOpen), body: L.myOpenBody, href: "/member#committees", cta: L.open });
  }
  if (soon > 0) {
    out.push({ id: "committee-meetings-soon", tone: "info", title: fmt(L.meetingsSoon, soon), body: L.meetingsSoonBody, href: "/calendar", cta: L.open });
  }
  return out;
}
