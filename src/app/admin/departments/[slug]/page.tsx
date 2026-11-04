import { redirect, notFound } from "next/navigation";
import { earnsFinalCertificate, servicePeriod, serviceDays } from "@/lib/certificate";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_EXPIRY_REASON,
  candidateHoursLeft,
  sweepOverdueRequests,
  sweepExpiredCandidateAccounts,
  QUEUE_TAKE,
} from "@/lib/workflow";
import { sweepTicketEscalation, ticketAuthor, ticketTargetLabel, TICKET_INCLUDE, openTicketsWhere, canRespondToTicket } from "@/lib/tickets";
import { TicketCard } from "../../tickets/TicketCard";
import { themeFromColor } from "@/lib/brand";
import { Card } from "@/components/ui";
import { ApprovalQueue } from "../../ApprovalQueue";
import { TicketCta } from "@/components/tickets/TicketCta";
import { ticketBoardData } from "@/components/tickets/boardData";
import { NeedsMeetingRow } from "./NeedsMeetingRow";
import { RequestCard } from "./RequestCard";
import { MemberInviteForm } from "./MemberInviteForm";
import { MemberRoster } from "./MemberRoster";
import { Pager, pageParam } from "@/components/Pager";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { AlertsPanel } from "@/components/AlertsPanel";
import { alertsForUser } from "@/lib/alerts";
import { OffboardingPanel } from "./OffboardingPanel";
import { ObjectivesPanel } from "./ObjectivesPanel";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";
import Link from "next/link";

import { AnnouncementList } from "../../hub/AnnouncementList";
import { AnnouncementComposer } from "../../hub/AnnouncementComposer";
import { WeekPlanPanel } from "@/components/execution/WeekPlanPanel";
import { currentAndNextPeriod, canGovernPeriod, canPlanDepartment, stateLabel } from "@/lib/execution";
import { assessWeekPlan, DEFAULT_CAPACITY_POINTS } from "@/lib/carryover";
import { periodTasks, assignableOwners } from "@/lib/executionViews";
import { approvedGoals } from "@/lib/goals";
import { announcementsForSession, announcementPowers } from "@/lib/announcements";
import { CandidateWindow } from "@/components/CandidateWindow";
import { TicketBoard } from "@/components/TicketBoard";
import { scheduleDueSweeps } from "@/lib/sweepThrottle";
import { WorkspaceOverview } from "@/components/dashboard/WorkspaceOverview";

import { fmt } from "@/i18n/fmt";
import { mayIssueCertificateFor } from "@/lib/recognitionDesk";
/** أعضاءُ القسم في الصفحة الواحدة. كانوا مقصوصين عند ٢٠٠ بلا تنبيه — والعنوانُ يَعدّ المقصوص —
 *  ويُرسمون كلُّهم بطاقاتٍ تفاعلية دفعةً واحدة (٢٫٤ ميغابايت عند ٣٠٠ عضو). */
const ROSTER_PAGE = 40;

export default async function DepartmentBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ rp?: string }>;
}) {
  const locale = await getLocale();
  const L = getDictionary(locale).rDeptPage;
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

  // لجانُه بحالاتها — عدٌّ للبطاقة فقط؛ والإدارةُ كلُّها في صفحة اللجان
  const committeeCounts = await prisma.department.groupBy({
    by: ["committeeStatus"],
    where: { parentId: department.id },
    _count: { _all: true },
  });
  const countOf = (s: string) => committeeCounts.find((g) => g.committeeStatus === s)?._count._all ?? 0;
  // ما ينتظر القائدَ شخصياً — ومركزُ الخطط يُقرأ من لوحته كما من لوحة غيره
  const alerts = isOwnDept ? await alertsForUser(session, await getLocale()) : [];

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
      where: { departmentId: department.id },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        decisionNote: true,
        goal: { select: { title: true } },
        tasks: {
          where: { execState: { notIn: ["cancelled", "superseded"] } },
          select: { execState: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  // نموذجُ المهمّة يَعرض المعتمَدَ وحده — المقترحُ لم يُقرَّ بعد
  const assignableObjectives = deptObjectives
    .filter((o) => o.status === "approved" || o.status === "active" || o.status === "at_risk")
    .map((o) => ({ id: o.id, title: o.title }));
  const [curTasks, nextTasks, curReport, nextReport] = await Promise.all([
    periodTasks(curPeriod.id, department.id),
    periodTasks(nextPeriod.id, department.id),
    curPlan ? assessWeekPlan(curPlan.id) : Promise.resolve(null),
    nextPlan ? assessWeekPlan(nextPlan.id) : Promise.resolve(null),
  ]);
  const canPlanHere = canPlanDepartment(session, department.id);
  const canReviewHere = canGovernPeriod(session.user.role);

  scheduleDueSweeps({
    overdue_requests: () => sweepOverdueRequests(department.id),
    ticket_escalation: () => sweepTicketEscalation(),
    candidate_expiry: () => sweepExpiredCandidateAccounts(),
  });

  const [
    approvalQueue,
    needsMeeting,
    requests,
    roster,
    tickets,
    openInvites,
    announcements,
    exiting,
    board,
  ] = await Promise.all([
    prisma.member.findMany({
      // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
      omit: { avatarData: true },
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
      // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
      omit: { avatarData: true },
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
    prisma.member.count({ where: { ...ROSTER_MEMBER_WHERE, departmentId: department.id } }).then(async (total) => {
      const { page, pages } = pageParam((await searchParams).rp, total, ROSTER_PAGE);
      const rows = await prisma.member.findMany({
        // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
        omit: { avatarData: true },
        where: { ...ROSTER_MEMBER_WHERE, departmentId: department.id },
        // الاسمُ ثم المعرّف: ترتيبٌ ثابت فلا يتكرّر عضوٌ بين صفحتين ولا يسقط
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
        skip: (page - 1) * ROSTER_PAGE,
        take: ROSTER_PAGE,
      });
      return { total, page, pages, rows };
    }),
    // قاعدة الرؤية المشتركة: تشمل ما وُجِّه إلى قائد القسم باسمه وما
    // رفعه هو — وكلاهما كان يسقط من الاستعلام المكتوب هنا بيد
    prisma.ticket.findMany({
      where: openTicketsWhere(session),
      include: TICKET_INCLUDE,
      orderBy: { stageDueAt: "asc" },
      // بطاقاتٌ تفاعلية: خمسون أقربُها موعداً — والسجلُّ الكاملُ في «التذاكر»
      take: 50,
    }),
    prisma.member.findMany({
      // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
      omit: { avatarData: true },
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
      // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
      omit: { avatarData: true },
      where: {
        departmentId: department.id,
        OR: [{ stepDownAt: { not: null } }, { warningsCount: { gte: 3 } }],
      },
      orderBy: [{ offboardingClosedAt: "asc" }, { stepDownAt: "desc" }],
      take: 30,
    }),
    ticketBoardData(session),
  ]);

  const theme = themeFromColor(department.colorHex);

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-6 sm:px-5 sm:py-8">
        {/* رأسُ المساحة لقائد القسم في قسمه — لا لمن يزور القسم من فوق */}
        {isOwnDept && (
          <WorkspaceOverview
            session={session}
            lead={
              <TicketCta
                href="/admin/tickets/new"
                title={t.composer.homeCtaTitle}
                body={t.composer.homeCtaBody}
                cta={t.composer.cta}
              />
            }
          />
        )}
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


        {/* ── خطةُ التنفيذ الأسبوعية: الجاريةُ تُنفَّذ، والقادمةُ تُبنى */}
        <section className="flex flex-col gap-4">
          <Card className="p-4 sm:p-5" id="objectives">
            <ObjectivesPanel
              departmentId={department.id}
              goals={goalList.map((g) => ({ id: g.id, title: g.title }))}
              canPropose={canPlanHere}
              theme={theme}
              objectives={deptObjectives.map((o) => ({
                id: o.id,
                title: o.title,
                status: o.status,
                dueDate: o.dueDate ? formatDate(o.dueDate) : null,
                goalTitle: o.goal?.title ?? null,
                decisionNote: o.decisionNote,
                verified: o.tasks.filter((t) => t.execState === "verified").length,
                total: o.tasks.filter((t) => t.execState !== "waived").length,
              }))}
            />
          </Card>

          <Card className="p-4 sm:p-5">
            <WeekPlanPanel
              title={fmt(L.thisWeekSPlan, stateLabel(curPeriod.state, locale))}
              plan={curPlan}
              periodId={curPeriod.id}
              departmentId={department.id}
              periodState={curPeriod.state}
              tasks={curTasks}
              owners={owners}
              goals={goalList.map((g) => ({ id: g.id, title: g.title }))}
              objectives={assignableObjectives}
              capacity={curPlan?.capacityPoints ?? DEFAULT_CAPACITY_POINTS}
              report={curReport}
              canPlan={canPlanHere}
              canReview={canReviewHere}
              theme={theme}
              readOnlyNote={
                curPeriod.state === "open" || curPeriod.state === "reopened"
                  ? undefined
                  : fmt(L.theWeekIsNothing, stateLabel(curPeriod.state, locale))
              }
            />
          </Card>

          <Card className="p-4 sm:p-5">
            <WeekPlanPanel
              title={fmt(L.nextWeekSPlan, stateLabel(nextPeriod.state, locale))}
              plan={nextPlan}
              periodId={nextPeriod.id}
              departmentId={department.id}
              periodState={nextPeriod.state}
              tasks={nextTasks}
              owners={owners}
              goals={goalList.map((g) => ({ id: g.id, title: g.title }))}
              objectives={assignableObjectives}
              capacity={nextPlan?.capacityPoints ?? DEFAULT_CAPACITY_POINTS}
              report={nextReport}
              canPlan={canPlanHere}
              canReview={canReviewHere}
              theme={theme}
              readOnlyNote={L.beingBuiltNowAnd}
            />
          </Card>
        </section>

        {/* الهيكل واللجان: تُدار من صفحة اللجان — نائبُ القائد ومسؤولياتُ الأعضاء ولجانُ القسم */}
        <section>
          <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0">
              <h2 className="text-sm font-bold">{t.org.board.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-black/55">
                {department.parentId ? t.org.board.committeeDesc : t.org.board.desc}
              </p>
              {!department.parentId && (
                <p className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">{fmt(t.org.board.activeN, countOf("approved"))}</span>
                  {countOf("pending_review") > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{fmt(t.org.board.pendingN, countOf("pending_review"))}</span>
                  )}
                  {countOf("draft") > 0 && (
                    <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-black/70">{fmt(t.org.board.draftN, countOf("draft"))}</span>
                  )}
                </p>
              )}
            </div>
            <Link
              href={department.parentId ? `/committees/${department.id}` : "/committees"}
              className="btn-brand inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold"
            >
              {department.parentId ? t.org.board.openCommittee : t.org.board.open}
            </Link>
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

        <section id="roster" className="scroll-mt-24">
          <h2 className="mb-4 text-lg font-bold">{t.deptBoard.activeMembersTitle} ({roster.total})</h2>
          <MemberRoster
            theme={theme}
            canReset={session.user.role === "super_admin"}
            canIssueCertificates={mayIssueCertificateFor(session.user.role, "member")}
            members={roster.rows.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              jobTitle: m.jobTitle,
              warningsCount: m.warningsCount,
              certificateIssuedAt: m.certificateIssuedAt ? m.certificateIssuedAt.toISOString() : null,
            }))}
          />
          {roster.pages > 1 && (
            <div className="mt-4">
              <Pager page={roster.page} pages={roster.pages} href={(n) => `/admin/departments/${department.slug}?rp=${n}#roster`} labels={t.common} />
            </div>
          )}
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
                  canIssueCertificate={mayIssueCertificateFor(session.user.role, "member")}
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
                    serviceStart: servicePeriod(m).start.toISOString(),
                    earnsCertificate: earnsFinalCertificate(m),
                    serviceDays: serviceDays(m),
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <TicketBoard data={board} theme={theme} />

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
              <h2 className="text-sm font-bold">{fmt(L.reports, department.name)}</h2>
              <p className="text-xs text-black/40">{L.aSummaryOfYour}</p>
            </div>
            <Link
              href="/admin/reports"
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.surface, color: theme.onSurface }}
            >{L.openTheReports}</Link>
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
