import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_EXPIRY_REASON,
  candidateHoursLeft,
  sweepOverdueRequests,
  sweepExpiredCandidateAccounts,
} from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";
import { TicketCard } from "../../tickets/TicketCard";
import { themeFromColor } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { ApprovalQueue } from "../../ApprovalQueue";
import { NeedsMeetingRow } from "./NeedsMeetingRow";
import { RequestCard } from "./RequestCard";
import { MemberInviteForm } from "./MemberInviteForm";
import { MemberRoster } from "./MemberRoster";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";
import Link from "next/link";
import { announcementsForSession } from "@/lib/announcements";
import { AnnouncementList } from "../../hub/AnnouncementList";
import { CandidateWindow } from "@/components/CandidateWindow";

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

  const isSuperAdmin = session.user.role === "super_admin";
  const isExecutive = session.user.role === "executive";
  const isOwnDept = session.user.role === "department_admin" && session.user.departmentSlug === slug;
  if (!isSuperAdmin && !isExecutive && !isOwnDept) redirect("/admin");

  const department = await prisma.department.findUnique({ where: { slug } });
  if (!department) notFound();

  await sweepOverdueRequests(department.id);
  await sweepTicketEscalation();
  await sweepExpiredCandidateAccounts();

  const [approvalQueue, needsMeeting, requests, activeMembers, tickets, openInvites, announcements] = await Promise.all([
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
    }),
    prisma.request.findMany({
      where: { targetDepartmentId: department.id },
      include: { linkedMember: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: "approved",
        isActive: true,
        invite: { targetRole: "member" },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.ticket.findMany({
      where: {
        status: { in: ["open", "in_progress"] },
        OR: [
          { targetDepartmentId: department.id },
          { stage: "lead_escalation", member: { departmentId: department.id } },
        ],
      },
      include: { member: true, targetDepartment: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: { not: "approved" },
        testStatus: "not_started",
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    announcementsForSession(session, 6),
  ]);

  const theme = themeFromColor(department.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={`${t.deptBoard.adminRolePrefix} ${department.name}`} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-6 sm:px-5 sm:py-8">
        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.hub.announcementsTitle}</h2>
          <AnnouncementList
            canDelete={false}
            announcements={announcements.map((a) => ({
              id: a.id,
              title: a.title,
              body: a.body,
              audience: a.audience,
              departmentName: a.department?.name ?? null,
              authorName: a.authorName,
              createdAt: a.createdAt.toISOString(),
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
                    memberName: tk.member.fullName,
                    targetDepartmentName: tk.targetDepartment.name,
                  }}
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

        <section>
          <Card className="p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">{t.deptBoard.testTitlePrefix} {department.name}</h2>
              <p className="text-xs text-black/40">{t.deptBoard.testHint}</p>
            </div>
            <Link
              href={`/admin/departments/${slug}/test`}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.surface, color: theme.accentDark }}
            >
              {t.admin.editQuestions}
            </Link>
          </Card>
        </section>
      </main>
    </div>
  );
}
