import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepOverdueRequests, sweepExpiredCandidateAccounts } from "@/lib/workflow";
import { sweepTicketEscalation, TICKET_STAGE_LABELS, ticketAuthor, ticketTargetLabel, TICKET_INCLUDE } from "@/lib/tickets";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card, StatusBadge } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { formatDate } from "@/lib/format";
import { ReminderButton } from "./ReminderButton";
import { getLocale, getDictionary } from "@/i18n/server";
import { announcementsForSession, canPublishAnnouncement } from "@/lib/announcements";
import { AnnouncementComposer } from "../hub/AnnouncementComposer";
import { AnnouncementList } from "../hub/AnnouncementList";
import { RaiseAdminTicketForm, type TicketTargetOption } from "../tickets/RaiseAdminTicketForm";
import { accountRoleLabel } from "@/lib/testTracks";

function isOverdue(dueAt: Date) {
  return Date.now() > dueAt.getTime();
}

export default async function OperationsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "operations_officer") redirect("/admin");

  await sweepOverdueRequests();
  await sweepTicketEscalation();
  await sweepExpiredCandidateAccounts();

  const [tickets, requests, announcements, departments] = await Promise.all([
    prisma.ticket.findMany({
      where: { status: { in: ["open", "in_progress"] } },
      include: TICKET_INCLUDE,
      orderBy: { stageDueAt: "asc" },
    }),
    prisma.request.findMany({
      where: { status: { in: ["new", "in_progress", "overdue"] } },
      include: { targetDepartment: true, linkedMember: true },
      orderBy: { dueDate: "asc" },
    }),
    announcementsForSession(session, 8),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  const dict = getDictionary(await getLocale());
  const tOps = dict.operations;
  const tHub = dict.hub;

  // وجهات التذكرة: الأقسام والحسابات الإدارية والأعضاء المعتمدون.
  // نموذج "الطلبات" القديم كان يعرض الأقسام وحدها، فنوع "رفع للإدارة
  // العليا" لم تكن له وجهة أصلاً — تناقضٌ ظاهر في الواجهة.
  const [ticketPeople, ticketMembers] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, id: { not: session.user.id } },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
    }),
    prisma.member.findMany({
      where: { isActive: true, approvalStatus: "approved" },
      include: { department: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const ticketTargets: TicketTargetOption[] = [
    ...departments.map((d) => ({
      value: `dept:${d.id}`,
      label: d.name,
      group: dict.ticketsPage.groupDepartments,
    })),
    ...ticketPeople.map((u) => ({
      value: `user:${u.id}`,
      label: `${u.fullName} — ${accountRoleLabel(u.role)}`,
      group: dict.ticketsPage.groupLeadership,
    })),
    ...ticketMembers.map((m) => ({
      value: `member:${m.id}`,
      label: m.department ? `${m.fullName} — ${m.department.name}` : m.fullName,
      group: dict.ticketsPage.groupMembers,
    })),
  ];

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const canPublish = canPublishAnnouncement(session.user.role);
  const deptOptions = departments.map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={tOps.role} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6 sm:px-5 sm:py-8">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold sm:text-lg">{tHub.announcementsTitle}</h2>
              <p className="text-xs text-black/40">{tHub.announcementsHintReader}</p>
            </div>
            {canPublish && <AnnouncementComposer departments={deptOptions} theme={theme} />}
          </div>
          <AnnouncementList
            canDelete={canPublish}
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

        {canPublish && (
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold sm:text-lg">{tHub.raiseRequestTitle}</h2>
                <p className="text-xs text-black/40">{tHub.raiseRequestHint}</p>
              </div>
              <RaiseAdminTicketForm targets={ticketTargets} theme={theme} />
            </div>
          </section>
        )}

        <section>
          <h1 className="mb-1 text-xl font-bold">{tOps.openTicketsTitle} ({tickets.length})</h1>
          <p className="mb-4 text-sm text-black/50">
            {tOps.openTicketsHint}
          </p>
          {tickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{tOps.openTicketsEmpty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {tickets.map((t) => {
                const isLate = isOverdue(t.stageDueAt);
                return (
                  <Card key={t.id} className="p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-black/40" dir="ltr">
                        #{t.ticketNumber}
                      </span>
                      <StatusBadge status={t.status} />
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ background: theme.surface, color: theme.accentDark }}
                      >
                        {dict.ticketStage.admin[t.stage] ?? TICKET_STAGE_LABELS[t.stage]}
                      </span>
                      {isLate && (
                        <span className="rounded-full bg-[#FBE5E1] px-2.5 py-1 text-xs font-semibold text-[#9A2E1C]">
                          {tOps.late}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold">{t.subject}</p>
                    <p className="mt-1 text-sm text-black/60">{t.description}</p>
                    <p className="mt-2 text-xs text-black/40">
                      {tOps.from}: {ticketAuthor(t).name} — {tOps.to}: {ticketTargetLabel(t)} —{" "}
                      {tOps.dueOn}: {formatDate(t.stageDueAt)}
                    </p>
                    <div className="mt-3 border-t border-black/5 pt-3">
                      <ReminderButton target={{ type: "ticket", id: t.id }} theme={theme} />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-lg font-bold">{tOps.requestsTitle} ({requests.length})</h2>
          <p className="mb-4 text-sm text-black/50">{tOps.requestsHint}</p>
          {requests.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{tOps.requestsEmpty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {requests.map((r) => (
                <Card key={r.id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.status} />
                    <span className="inline-flex items-center gap-1.5 text-xs text-black/60">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.targetDepartment.colorHex }} />
                      {r.targetDepartment.name}
                    </span>
                  </div>
                  <p className="text-sm font-bold">{dict.requestType[r.type] ?? r.type}</p>
                  {r.note && <p className="mt-1 text-sm text-black/60">{r.note}</p>}
                  <p className="mt-2 text-xs text-black/40">
                    {r.linkedMember ? `${tOps.relatedTo}: ${r.linkedMember.fullName} — ` : ""}
                    {r.dueDate ? `${tOps.dueOn}: ${formatDate(r.dueDate)}` : tOps.noDue}
                  </p>
                  <div className="mt-3 border-t border-black/5 pt-3">
                    <ReminderButton target={{ type: "request", id: r.id }} theme={theme} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
