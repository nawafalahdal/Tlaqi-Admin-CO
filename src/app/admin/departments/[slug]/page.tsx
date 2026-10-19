import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_EXPIRY_REASON,
  candidateHoursLeft,
  sweepOverdueRequests,
  sweepExpiredCandidateAccounts,
  QUEUE_TAKE,
} from "@/lib/workflow";
import { sweepTicketEscalation, ticketAuthor, ticketTargetLabel, TICKET_INCLUDE, openTicketsWhere, canRespondToTicket, TICKET_LIST_TAKE } from "@/lib/tickets";
import { TicketCard } from "../../tickets/TicketCard";
import { themeFromColor } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { ApprovalQueue } from "../../ApprovalQueue";
import { NeedsMeetingRow } from "./NeedsMeetingRow";
import { RequestCard } from "./RequestCard";
import { MemberInviteForm } from "./MemberInviteForm";
import { MemberRoster } from "./MemberRoster";
import { CommitteesPanel } from "./CommitteesPanel";
import { AlertsPanel } from "@/components/AlertsPanel";
import { PlansLink } from "@/components/PlansLink";
import { planCounts } from "@/lib/plans";
import { alertsForUser } from "@/lib/alerts";
import { OffboardingPanel } from "./OffboardingPanel";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";
import Link from "next/link";

import { AnnouncementList } from "../../hub/AnnouncementList";
import { AnnouncementComposer } from "../../hub/AnnouncementComposer";
import { committeesOf } from "@/lib/committees";
import { WeekPlanPanel } from "@/components/execution/WeekPlanPanel";
import { currentAndNextPeriod, canGovernPeriod, canPlanDepartment, stateLabel } from "@/lib/execution";
import { assessWeekPlan, DEFAULT_CAPACITY_POINTS } from "@/lib/carryover";
import { periodTasks, assignableOwners } from "@/lib/executionViews";
import { approvedGoals } from "@/lib/goals";
import { announcementsForSession, announcementPowers } from "@/lib/announcements";
import { CandidateWindow } from "@/components/CandidateWindow";
import { TicketBoard } from "@/components/TicketBoard";
import { runDueSweeps } from "@/lib/sweepThrottle";
import { WorkspaceOverview } from "@/components/dashboard/WorkspaceOverview";

function isCertificateEligible(decidedAt: Date | null) {
  if (!decidedAt) return false;
  return Date.now() - decidedAt.getTime() >= 90 * 24 * 60 * 60 * 1000;
}

export default async function DepartmentBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session) redirect("/login");
  const t = getDictionary(await getLocale());

  const COLUMNS: { status: "new" | "in_progress" | "done" | "overdue"; label: string }[] = [
    { status: "new", label: t.deptBoard.columnNew },
    { status: "in_progress", label: t.deptBoard.columnInProgress },
    { status: "overdue", label: t.deptBoard.columnOverdue },
    { status: "done", label: t.deptBoard.columnDone },
  ];

  // لوحة القسم لقائده وحده.
  //
  // المؤسس والتنفيذي يملكان الهيكل: إنشاء القسم ولونه ودعوة قائده،
  // وتصلهما تذاكره إن تأخّرت. أما عمله اليومي وبيانات أعضائه وبنك
  // أسئلته فملك قائده — والاطّلاع عليه بلا سبب رقابةٌ لا تُحاسِب أحداً
  // وتُفرغ ملكية القائد من معناها.
  const isSuperAdmin = session.user.role === "super_admin";
  const isExecutive = session.user.role === "executive";
  const isOwnDept = session.user.role === "department_admin" && session.user.departmentSlug === slug;
  if (!isOwnDept) redirect(isSuperAdmin || isExecutive ? "/admin/departments" : "/admin");

  const department = await prisma.department.findUnique({ where: { slug } });
  if (!department) notFound();

  // لجانُه بكل حالاتها: قائدُ القسم يرى المقترحةَ والمردودةَ أيضاً —
  // هو من اقترحها، فحجبُها عنه يُخفي عليه مصير طلبه
  const committees = await committeesOf(department.id);
  // ما ينتظر القائدَ شخصياً — ومركزُ الخطط يُقرأ من لوحته كما من لوحة غيره
  const alerts = isOwnDept ? await alertsForUser(session) : [];

  // ── خطةُ التنفيذ الأسبوعية لهذا القسم: الجارية والقادمة
  const { current: curPeriod, next: nextPeriod } = await currentAndNextPeriod();
  const [curPlan, nextPlan, owners, goalList, deptObjectives] = await Promise.all([
    prisma.weekPlan.findUnique({
      where: { periodId_departmentId: { periodId: curPeriod.id, departmentId: department.id } },
      select: { id: true, state: true, decisionNote: true, capacityPoints: true },
    }),
    prisma.weekPlan.findUnique({
      where: { periodId_departmentId: { periodId: nextPeriod.id, departmentId: department.id } },
      select: { id: true, state: true, decisionNote: true, capacityPoints: true },
    }),
    assignableOwners(department.id),
    approvedGoals(),
    prisma.departmentObjective.findMany({
      where: { departmentId: department.id, status: { in: ["approved", "active"] } },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const [curTasks, nextTasks, curReport, nextReport] = await Promise.all([
    periodTasks(curPeriod.id, department.id),
    periodTasks(nextPeriod.id, department.id),
    curPlan ? assessWeekPlan(curPlan.id) : Promise.resolve(null),
    nextPlan ? assessWeekPlan(nextPlan.id) : Promise.resolve(null),
  ]);
  const canPlanHere = canPlanDepartment(session, department.id);
  const canReviewHere = canGovernPeriod(session.user.role);
  const plans = await planCounts();

  await runDueSweeps({
    overdue_requests: () => sweepOverdueRequests(department.id),
    ticket_escalation: () => sweepTicketEscalation(),
    candidate_expiry: () => sweepExpiredCandidateAccounts(),
  });

  const [
    approvalQueue,
    needsMeeting,
    requests,
    activeMembers,
    tickets,
    openInvites,
    announcements,
    exiting,
  ] = await Promise.all([
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: "pending_review",
        testStatus: "passed",
        invite: { targetRole: "member" },
      },
      include: { department: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: "pending_review",
        testStatus: "failed",
        invite: { targetRole: "member" },
      },
      orderBy: { createdAt: "asc" },
      take: QUEUE_TAKE,
    }),
    prisma.request.findMany({
      where: { targetDepartmentId: department.id },
      include: { linkedMember: true },
      orderBy: { createdAt: "desc" },
      take: QUEUE_TAKE,
    }),
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: "approved",
        isActive: true,
        invite: { targetRole: "member" },
      },
      orderBy: { fullName: "asc" },
      take: QUEUE_TAKE,
    }),
    // قاعدة الرؤية المشتركة: تشمل ما وُجِّه إلى قائد القسم باسمه وما
    // رفعه هو — وكلاهما كان يسقط من الاستعلام المكتوب هنا بيد
    prisma.ticket.findMany({
      where: openTicketsWhere(session),
      include: TICKET_INCLUDE,
      orderBy: { stageDueAt: "asc" },
      take: TICKET_LIST_TAKE,
    }),
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: { not: "approved" },
        testStatus: "not_started",
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
      take: QUEUE_TAKE,
    }),
    announcementsForSession(session, 6),
    // من بدأ خروجه ولم يكتمل ختامه — ويبقى معروضاً بعد الإغلاق مرةً
    // أخيرة ليُرى أن التجربة أُنهيت كما ينبغي لا أنها انقطعت
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        OR: [{ stepDownAt: { not: null } }, { warningsCount: { gte: 3 } }],
      },
      orderBy: [{ offboardingClosedAt: "asc" }, { stepDownAt: "desc" }],
      take: 30,
    }),
  ]);

  const theme = themeFromColor(department.colorHex);

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName={`${t.deptBoard.adminRolePrefix} ${department.name}`} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-6 sm:px-5 sm:py-8">
        {/* رأسُ المساحة لقائد القسم في قسمه — لا لمن يزور القسم من فوق */}
        {isOwnDept && <WorkspaceOverview session={session} />}
        <AlertsPanel alerts={alerts} />
        <section id="announcements" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold sm:text-lg">{t.hub.announcementsTitle}</h2>
            {/* القسم يخاطب أهله بنفسه: «تفاعلوا مع هذا المنشور»، «اختبار
                المنصة اليوم». إمرارُ ذلك بالقيادة يُبطئه بلا فائدة
                ويُشغلها بما ليس لها. */}
            <AnnouncementComposer
              departments={[{ id: department.id, name: department.name }]}
              theme={theme}
              powers={announcementPowers(session)}
            />
          </div>
          <AnnouncementList
            viewerId={session.user.id}
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
        <section>
          <h1 className="mb-1 text-xl font-bold">{t.deptBoard.inviteTitle}</h1>
          <p className="mb-4 text-sm text-black/50">{t.deptBoard.inviteSubtitle}</p>
          {isOwnDept ? (
            <Card className="p-6">
              <MemberInviteForm departmentId={department.id} theme={theme} />
            </Card>
          ) : (
            <Card className="p-6 text-sm text-black/50">
              {t.deptBoard.viewOnlyPrefix} {department.name} {t.deptBoard.viewOnlySuffix}
            </Card>
          )}
        </section>

        <section>
          <PlansLink theme={theme} docCount={plans.total} freshCount={plans.fresh} />
        </section>

        {/* ── خطةُ التنفيذ الأسبوعية: الجاريةُ تُنفَّذ، والقادمةُ تُبنى */}
        <section className="flex flex-col gap-4">
          <Card className="p-4 sm:p-5">
            <WeekPlanPanel
              title={`خطةُ الأسبوع الجاري — ${stateLabel(curPeriod.state)}`}
              plan={curPlan}
              periodId={curPeriod.id}
              departmentId={department.id}
              periodState={curPeriod.state}
              tasks={curTasks}
              owners={owners}
              goals={goalList.map((g) => ({ id: g.id, title: g.title }))}
              objectives={deptObjectives}
              capacity={curPlan?.capacityPoints ?? DEFAULT_CAPACITY_POINTS}
              report={curReport}
              canPlan={canPlanHere}
              canReview={canReviewHere}
              theme={theme}
              readOnlyNote={
                curPeriod.state === "open" || curPeriod.state === "reopened"
                  ? undefined
                  : `الأسبوعُ «${stateLabel(curPeriod.state)}» — ولا يُكتَب فيه تنفيذٌ قبل فتحه بإذن الإدارة.`
              }
            />
          </Card>

          <Card className="p-4 sm:p-5">
            <WeekPlanPanel
              title={`خطةُ الأسبوع القادم — ${stateLabel(nextPeriod.state)}`}
              plan={nextPlan}
              periodId={nextPeriod.id}
              departmentId={department.id}
              periodState={nextPeriod.state}
              tasks={nextTasks}
              owners={owners}
              goals={goalList.map((g) => ({ id: g.id, title: g.title }))}
              objectives={deptObjectives}
              capacity={nextPlan?.capacityPoints ?? DEFAULT_CAPACITY_POINTS}
              report={nextReport}
              canPlan={canPlanHere}
              canReview={canReviewHere}
              theme={theme}
              readOnlyNote="تُبنى الآن وتُرفَع للاعتماد — ولا يُكتَب فيها تنفيذٌ حتى تُفتَح بإذن الإدارة بعد مراجعة السبت."
            />
          </Card>
        </section>

        {/* اللجان: قسمٌ داخل القسم — يقترحه قائده ويعتمده التنفيذي */}
        <section>
          <Card className="p-5 sm:p-6">
            <CommitteesPanel
              parentId={department.id}
              parentName={department.name}
              parentColorHex={department.colorHex}
              canPropose={isOwnDept}
              theme={theme}
              committees={committees.map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                colorHex: c.colorHex,
                leadTitle: c.leadTitle,
                committeeStatus: c.committeeStatus,
                requestedByName: c.requestedByName,
                decidedByName: c.decidedByName,
                decisionNote: c.decisionNote,
                lead: c.admins[0] ?? null,
                memberCount: c._count.members,
                subCommitteeCount: c._count.committees,
              }))}
            />
          </Card>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-bold">
            {t.deptBoard.openInvitesTitle} ({openInvites.length})
          </h2>
          <p className="mb-2 text-sm text-black/50">{t.deptBoard.openInvitesHint}</p>
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {t.candidateWindow.governanceNote}
          </p>
          {openInvites.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">
              {t.deptBoard.openInvitesEmpty}
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {openInvites.map((inv) => (
                <Card
                  key={inv.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold">{inv.fullName}</p>
                    <p className="break-all text-xs text-black/50" dir="ltr">
                      {inv.email}
                    </p>
                    <p className="text-xs text-black/40">
                      {t.deptBoard.issuedOn} {formatDate(inv.createdAt)}
                    </p>
                  </div>
                  <CandidateWindow
                    firstLoginAt={inv.firstLoginAt?.toISOString() ?? null}
                    hoursLeft={
                      inv.credentialsIssuedAt ? candidateHoursLeft(inv.credentialsIssuedAt) : null
                    }
                    lapsed={!inv.isActive && inv.exitReason === CANDIDATE_EXPIRY_REASON}
                    notApplicable={!inv.credentialsIssuedAt}
                  />
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">{t.deptBoard.finalApprovalTitle}</h2>
          <ApprovalQueue
            themeColorHex={department.colorHex}
            emptyMessage={t.deptBoard.finalApprovalEmpty}
            members={approvalQueue.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              testScore: m.testScore,
              departmentName: department.name,
              departmentColor: department.colorHex,
            }))}
          />
        </section>

        {needsMeeting.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-bold">{t.deptBoard.needsMeetingTitle}</h2>
            <div className="flex flex-col gap-3">
              {needsMeeting.map((m) => (
                <NeedsMeetingRow
                  key={m.id}
                  member={{ id: m.id, fullName: m.fullName, email: m.email, testScore: m.testScore }}
                  theme={theme}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-lg font-bold">{t.deptBoard.activeMembersTitle} ({activeMembers.length})</h2>
          <MemberRoster
            theme={theme}
            canReset={session.user.role === "super_admin"}
            members={activeMembers.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              jobTitle: m.jobTitle,
              warningsCount: m.warningsCount,
              certificateIssuedAt: m.certificateIssuedAt ? m.certificateIssuedAt.toISOString() : null,
              certificateEligible: isCertificateEligible(m.decidedAt),
            }))}
          />
        </section>

        {/* الخروج قسمٌ قائم بذاته: من بدأ خروجه لا يختفي من اللوحة حتى
            يكتمل ختامه — شهادةً ووداعاً ورسالةَ شكر */}
        <section>
          <h2 className="mb-1 text-base font-bold sm:text-lg">{t.offboarding.sectionTitle}</h2>
          <p className="mb-3 text-sm text-black/50">{t.offboarding.sectionHint}</p>
          {exiting.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{t.offboarding.empty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {exiting.map((m) => (
                <OffboardingPanel
                  key={m.id}
                  theme={theme}
                  member={{
                    id: m.id,
                    fullName: m.fullName,
                    email: m.email,
                    warningsCount: m.warningsCount,
                    stepDownAt: m.stepDownAt ? formatDate(m.stepDownAt) : null,
                    stepDownByName: m.stepDownByName,
                    endDate: m.endDate ? formatDate(m.endDate) : null,
                    certificateAt: m.certificateIssuedAt ? formatDate(m.certificateIssuedAt) : null,
                    farewellAt: m.farewellDesignAt ? formatDate(m.farewellDesignAt) : null,
                    closedAt: m.offboardingClosedAt ? formatDate(m.offboardingClosedAt) : null,
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <TicketBoard tickets={tickets} theme={theme} viewerId={session.user.id} />

        <section>
          <h2 className="mb-4 text-lg font-bold">{t.deptBoard.ticketsTitle} ({tickets.length})</h2>
          <p className="mb-4 -mt-3 text-xs text-black/40">{t.deptBoard.ticketsHint}</p>
          {tickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{t.deptBoard.ticketsEmpty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {tickets.map((tk) => (
                <TicketCard
                  key={tk.id}
                  theme={theme}
                  ticket={{
                    id: tk.id,
                    ticketNumber: tk.ticketNumber,
                    subject: tk.subject,
                    description: tk.description,
                    status: tk.status,
                    stage: tk.stage,
                    stageDueAt: tk.stageDueAt.toISOString(),
                    resolutionNote: tk.resolutionNote,
                    linkUrl: tk.linkUrl,
                    memberName: ticketAuthor(tk).name,
                    targetDepartmentName: ticketTargetLabel(tk),
                  }}
                  // الحارس نفسه الذي يفرضه الخادم يُغذّي الواجهة: لا
                  // يُعرض زرُّ ردٍّ يُرفَض عند الضغط
                  readOnly={!canRespondToTicket(tk, session)}
                  mine={tk.raisedByUserId === session.user.id}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">{t.deptBoard.requestsTitle}</h2>
          <div className="grid gap-4 md:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = requests.filter((r) => r.status === col.status);
              return (
                <div key={col.status} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-sm font-bold text-black/60">{col.label}</h3>
                    <span className="text-xs text-black/30">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {items.length === 0 && (
                      <Card className="p-4 text-center text-xs text-black/30">{t.deptBoard.requestsColumnEmpty}</Card>
                    )}
                    {items.map((r) => (
                      <RequestCard
                        key={r.id}
                        theme={theme}
                        request={{
                          id: r.id,
                          type: r.type,
                          status: r.status,
                          note: r.note,
                          dueDate: r.dueDate ? r.dueDate.toISOString() : null,
                          linkedMemberName: r.linkedMember?.fullName ?? null,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* تقارير قسمه — أعضاؤه هو، ولا يُقرأ منها قسمٌ آخر */}
        <section>
          <Card className="p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">تقارير {department.name}</h2>
              <p className="text-xs text-black/40">
                ملخّص أعضائك، والتذاكر التي أُغلقت في موعدها
              </p>
            </div>
            <Link
              href="/admin/reports"
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.surface, color: theme.onSurface }}
            >
              افتح التقارير
            </Link>
          </Card>
        </section>

        <section>
          <Card className="p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">{t.deptBoard.testTitlePrefix} {department.name}</h2>
              <p className="text-xs text-black/40">{t.deptBoard.testHint}</p>
            </div>
            <Link
              href={`/admin/departments/${slug}/test`}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.surface, color: theme.onSurface }}
            >
              {t.admin.editQuestions}
            </Link>
          </Card>
        </section>
      </main>
    </div>
  );
}
