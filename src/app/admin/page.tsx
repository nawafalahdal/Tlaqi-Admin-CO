import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OPEN_DEPARTMENT_WHERE, DEPARTMENT_TAKE } from "@/lib/committees";
import { sweepOverdueRequests, sweepExpiredCandidateAccounts, QUEUE_TAKE } from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";
import {
  announcementsForSession,
  canPublishAnnouncement,
  announcementPowers,
} from "@/lib/announcements";
import { themeFromColor, SUPER_ADMIN_THEME, BRAND, brandInk } from "@/lib/brand";
import { AppHeader, Card, StatusBadge } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { TicketBoard } from "@/components/TicketBoard";
import { SeatConflicts } from "@/components/SeatConflicts";
import { AlertsPanel } from "@/components/AlertsPanel";
import { alertsForUser, type Alert } from "@/lib/alerts";
import { AnnouncementComposer } from "./hub/AnnouncementComposer";
import { AnnouncementList } from "./hub/AnnouncementList";
import { ticketBoardData } from "@/components/tickets/boardData";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";
import { scheduleDueSweeps } from "@/lib/sweepThrottle";
import { canDecideCandidate } from "@/lib/permissions";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { approvedGoals, canApproveGoal } from "@/lib/goals";
import { periodStartFor, stateLabel } from "@/lib/execution";
import { calendarEntries, KIND_LABEL } from "@/lib/orgCalendar";

export default async function AdminPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (session.user.role === "department_admin" && session.user.departmentSlug) {
    redirect(`/admin/departments/${session.user.departmentSlug}`);
  }
  if (session.user.role === "operations_officer") redirect("/admin/operations");
  if (session.user.role === "member") redirect("/member");

  const isSuperAdmin = session.user.role === "super_admin";

  // الكنسُ مُقنَّنٌ من العَرْض: انظر `@/lib/sweepThrottle` — من يَفوز
  // بالصفّ يَكنس، فلا خمسُ رحلاتٍ ولا بريدٌ في كل فتحةِ صفحة
  scheduleDueSweeps({
    overdue_requests: () => sweepOverdueRequests(),
    ticket_escalation: () => sweepTicketEscalation(),
    candidate_expiry: () => sweepExpiredCandidateAccounts(),
  });

  const now = new Date();
  const [
    departments,
    allLeadershipCandidates,
    memberJoins,
    requests,
    escalatedCount,
    announcements,
    activeMembers,
    proposals,
    goals,
    week,
  ] = await Promise.all([
    prisma.department.findMany({
      where: OPEN_DEPARTMENT_WHERE,
      orderBy: { name: "asc" },
      take: DEPARTMENT_TAKE,
    }),
    // المرشّحون القياديون: يُجلَبون بأقلّ حقلٍ لتصفيتهم بمن يَحسم أمرهم
    prisma.member.findMany({
      where: {
        approvalStatus: "pending_review",
        testStatus: "passed",
        invite: { targetRole: { in: ["department_admin", "operations_officer", "executive"] } },
      },
      select: { departmentId: true, invite: { select: { targetRole: true } } },
      take: QUEUE_TAKE,
    }),
    prisma.member.count({
      where: { approvalStatus: "pending_review", testStatus: "passed", invite: { targetRole: "member" } },
    }),
    prisma.request.findMany({
      where: { status: { not: "done" } },
      include: { targetDepartment: true, linkedMember: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.ticket.count({
      where: {
        status: { in: ["open", "in_progress"] },
        // الفاوندر يرى ما بلغ مرحلته هو؛ التنفيذي يرى ما بلغ مرحلته
        stage: isSuperAdmin ? "founder_escalation" : "ceo_escalation",
      },
    }),
    announcementsForSession(session, 8),
    prisma.member.count({ where: ROSTER_MEMBER_WHERE }),
    canApproveGoal(session.user.role) ? prisma.strategicGoal.count({ where: { status: "proposed" } }) : 0,
    approvedGoals(),
    // قراءةٌ لا إنشاء: العرضُ لا يكتب في القاعدة
    prisma.executionPeriod.findFirst({ where: { weekStart: periodStartFor(now) } }),
  ]);

  // اللوحةُ أعدادٌ وستُّ تذاكر — لا كلُّ المفتوح (سقطت به بثلاثة آلاف)
  const board = await ticketBoardData(session);
  const upcoming = (
    await calendarEntries({ session, from: now, to: new Date(now.getTime() + 45 * 86_400_000) })
  )
    .filter((e) => e.kind !== "ticket" && e.kind !== "task")
    .slice(0, 5);

  const dict = getDictionary(await getLocale());
  const t = dict.hub;
  const ta = dict.admin;
  const to = dict.overview;
  const n = (tpl: string, v: string | number) => tpl.replace("{n}", String(v));
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const canPublish = canPublishAnnouncement(session.user.role);
  // نفس الدالة التي تفرض الصلاحية في الخادم تُغذّي النموذج، فلا يظهر
  // خيارٌ يُرفض عند الإرسال
  const annPowers = announcementPowers(session);
  const deptOptions = departments.map((d) => ({ id: d.id, name: d.name }));

  // كلٌّ يرى ما يَحسمه وحده: المرشّحُ التنفيذيُّ للمؤسس لا للرئيس القائم.
  const leadershipJoins = allLeadershipCandidates.filter((m) =>
    canDecideCandidate(
      { role: session.user.role, departmentId: session.user.departmentId },
      { targetRole: m.invite.targetRole, departmentId: m.departmentId }
    )
  ).length;
  const pendingJoins = leadershipJoins + memberJoins;

  // **«يحتاج قرارك» لوحةٌ واحدة.** كانت النظرة العامة تَعرض الأمر نفسه
  // ثلاث مرات: بطاقةَ عدد، وقائمةً كاملة، ورابطاً في شبكة روابط. فصار
  // كلُّ قرارٍ سطراً واحداً بعدده ووجهته، والقوائم الكاملة في مواضعها.
  const decisions: Alert[] = [
    ...(escalatedCount > 0
      ? [{ id: "escalated", tone: "danger" as const, title: n(to.escalTitle, escalatedCount), body: to.escalBody, href: "/admin/tickets", cta: to.escalCta }]
      : []),
    ...(pendingJoins > 0
      ? [{ id: "joins", tone: "warn" as const, title: n(to.joinsTitle, pendingJoins), body: to.joinsBody, href: "/admin/approvals#joins", cta: to.joinsCta }]
      : []),
    ...(proposals > 0
      ? [{ id: "goal-proposals", tone: "warn" as const, title: n(to.goalsTitle, proposals), body: to.goalsBody, href: "/admin/execution/goals", cta: to.goalsCta }]
      : []),
    ...(requests.length > 0
      ? [{ id: "requests", tone: "info" as const, title: n(to.requestsTitle, requests.length), body: to.requestsBody, href: "#requests", cta: to.requestsCta }]
      : []),
    ...(await alertsForUser(session)),
  ];

  const nextGoal = goals.filter((g) => g.dueDate >= now).sort((a, b) => +a.dueDate - +b.dueDate)[0] ?? null;
  const metrics = [
    { v: board.counts.open, l: to.mOpen, s: board.counts.late > 0 ? n(to.mOpenLate, board.counts.late) : to.mOpenOk, href: "/admin/tickets", hot: board.counts.late > 0 },
    { v: pendingJoins, l: to.mJoins, s: to.mJoinsSub, href: "/admin/approvals#joins" },
    { v: goals.length, l: to.mGoals, s: nextGoal ? to.mGoalsNext.replace("{d}", formatDate(nextGoal.dueDate)) : to.mGoalsNone, href: "/admin/execution" },
    { v: activeMembers, l: to.mMembers, s: n(to.mMembersSub, departments.filter((d) => !d.parentId).length), href: "/admin/people" },
    { v: week ? stateLabel(week.state) : "—", l: to.mWeek, s: week ? formatDate(week.weekStart) : "", href: "/admin/execution" },
  ];

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? ta.founderRole : ta.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title={`${to.greeting}، ${(session.user.name ?? "").trim().split(/\s+/)[0] ?? ""}`}
          description={to.desc}
          actions={
            <Link href="/admin/tickets/new" className="btn-brand ticket-cta__btn">
              ＋ {dict.composer.cta}
            </Link>
          }
        />

        <AlertsPanel alerts={decisions} title={to.decisionTitle} hint={to.decisionHint} grid />

        {/* تعارض المقاعد: للمؤسس وحده، ولا يُرسم إن لم يكن تعارض */}
        {isSuperAdmin && <SeatConflicts canPurge={isSuperAdmin} />}

        {/* خمسةُ أرقام، ولكلٍّ مصدره ووجهته — لا بطاقاتٌ تُكرّر لوحة التذاكر */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((m) => (
            <Link key={m.l} href={m.href} className="block">
              <Card className="h-full p-4 transition-shadow hover:shadow-md">
                <p
                  className="text-2xl font-bold leading-tight"
                  style={{ color: m.hot ? BRAND.mahogany : brandInk(theme) }}
                >
                  {m.v}
                </p>
                <p className="mt-1.5 text-sm font-bold">{m.l}</p>
                {m.s && <p className="text-xs text-black/45">{m.s}</p>}
              </Card>
            </Link>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <TicketBoard data={board} theme={theme} />
          <Card className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-base font-bold sm:text-lg">{to.upcoming}</h2>
              <Link href="/calendar" className="text-xs font-bold" style={{ color: brandInk(theme) }}>
                {to.calendar} ←
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-black/40">{to.upcomingEmpty}</p>
            ) : (
              <ul className="flex flex-col">
                {upcoming.map((e) => (
                  <li key={e.id} className="border-b border-hairline py-3 last:border-0">
                    <Link href={e.href} className="flex gap-3">
                      <span className="w-1 shrink-0 rounded-full" style={{ background: e.colorHex }} />
                      <span className="min-w-0">
                        <span className="block text-xs font-bold" style={{ color: e.colorHex }}>
                          {KIND_LABEL[e.kind]} · {formatDate(e.date)}
                        </span>
                        <span className="block text-sm font-bold">{e.title}</span>
                        {e.detail && <span className="block text-xs text-black/45">{e.detail}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* الإعلانات — موضعُها الواحد، والنشرُ من رأسها */}
        <section id="announcements" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold sm:text-lg">{t.announcementsTitle}</h2>
              <p className="text-xs text-black/40">{t.announcementsHint}</p>
            </div>
            {canPublish && <AnnouncementComposer departments={deptOptions} theme={theme} powers={annPowers} />}
          </div>
          <AnnouncementList
            viewerId={session.user.id}
            viewerIsFounder={isSuperAdmin}
            announcements={announcements.map((a) => ({
              id: a.id,
              title: a.title,
              body: a.body,
              audience: a.audience,
              departmentName: a.department?.name ?? null,
              authorId: a.authorId,
              authorName: a.authorName,
              createdAt: a.createdAt.toISOString(),
              meetingUrl: a.meetingUrl,
              linkUrl: a.linkUrl,
              linkLabel: a.linkLabel,
            }))}
          />
        </section>

        {/* الطلبات بين الأقسام — تُعرض حين يبقى منها ما لم يُنجز */}
        {requests.length > 0 && (
          <section id="requests" className="scroll-mt-24">
            <div className="mb-3">
              <h2 className="text-base font-bold sm:text-lg">{t.requestsTitle}</h2>
              <p className="text-xs text-black/40">{t.requestsHint}</p>
            </div>
            <DataTable
              emptyLabel={ta.requestsEmpty}
              columns={[
                { key: "type", label: ta.colType, primary: true },
                { key: "dept", label: ta.colTargetDept },
                { key: "member", label: ta.colRelatedTo },
                { key: "status", label: ta.colStatus },
                { key: "due", label: ta.colDeadline },
              ]}
              rows={requests.map((r) => ({
                id: r.id,
                cells: {
                  type: dict.requestType[r.type],
                  dept: (
                    <span className="inline-flex items-center gap-1.5 text-black/70">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: r.targetDepartment.colorHex }}
                      />
                      {r.targetDepartment.name}
                    </span>
                  ),
                  member: r.linkedMember?.fullName ?? "—",
                  status: <StatusBadge status={r.status} />,
                  due: r.dueDate ? formatDate(r.dueDate) : "—",
                },
              }))}
            />
          </section>
        )}
      </main>
    </div>
  );
}
