import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepTicketEscalation, TICKET_STAGE_LABELS } from "@/lib/tickets";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { TicketCard } from "./TicketCard";
import { DataTable } from "@/components/DataTable";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";

/** صفحة التذاكر الخاصة — كل التذاكر في مكان واحد بدل تفرّقها بين اللوحات.
 *  المفتوحة تُعرض ببطاقات قابلة للإجراء، والمغلقة بجدول مرجعي. */
export default async function TicketsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const allowed = ["super_admin", "executive", "operations_officer"];
  if (!allowed.includes(session.user.role)) redirect("/admin");

  await sweepTicketEscalation();

  const t = getDictionary(await getLocale());
  const tt = t.ticketsPage;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  const tickets = await prisma.ticket.findMany({
    include: { member: true, targetDepartment: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const open = tickets.filter((x) => x.status !== "resolved");
  const closed = tickets.filter((x) => x.status === "resolved");
  const late = open.filter((x) => new Date() > x.stageDueAt);
  const escalated = open.filter((x) => x.stage === "ceo_escalation");

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={t.admin.founderRole} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton />
          <h1 className="text-lg font-bold sm:text-xl">{tt.title}</h1>
          <p className="mt-1 text-sm text-black/50">{tt.subtitle}</p>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={tt.statOpen} value={open.length} theme={theme} />
          <StatTile label={tt.statLate} value={late.length} theme={theme} />
          <StatTile label={tt.statEscalated} value={escalated.length} theme={theme} />
          <StatTile label={tt.statClosed} value={closed.length} theme={theme} />
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold">
            {tt.openTitle} ({open.length})
          </h2>
          {open.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{tt.openEmpty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {open.map((x) => (
                <TicketCard
                  key={x.id}
                  theme={theme}
                  ticket={{
                    id: x.id,
                    ticketNumber: x.ticketNumber,
                    subject: x.subject,
                    description: x.description,
                    status: x.status,
                    stage: x.stage,
                    stageDueAt: x.stageDueAt.toISOString(),
                    resolutionNote: x.resolutionNote,
                    memberName: x.member.fullName,
                    targetDepartmentName: x.targetDepartment.name,
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold">
            {tt.closedTitle} ({closed.length})
          </h2>
          <DataTable
            emptyLabel={tt.closedEmpty}
            columns={[
              { key: "subject", label: tt.colSubject, primary: true },
              { key: "number", label: tt.colNumber },
              { key: "member", label: tt.colMember },
              { key: "dept", label: tt.colDept },
              { key: "owner", label: tt.colClosedBy },
              { key: "at", label: tt.colClosedAt },
            ]}
            rows={closed.map((x) => ({
              id: x.id,
              cells: {
                subject: x.subject,
                number: `#${x.ticketNumber}`,
                member: x.member.fullName,
                dept: (
                  <span className="inline-flex items-center gap-1.5 text-black/70">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: x.targetDepartment.colorHex }}
                    />
                    {x.targetDepartment.name}
                  </span>
                ),
                owner: t.ticketStage.admin[x.stage] ?? TICKET_STAGE_LABELS[x.stage],
                at: x.resolvedAt ? formatDate(x.resolvedAt) : "—",
              },
            }))}
          />
        </section>
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  theme,
}: {
  label: string;
  value: number;
  theme: ReturnType<typeof themeFromColor>;
}) {
  return (
    <Card className="p-3.5 sm:p-4">
      <p className="text-2xl font-bold leading-none" style={{ color: theme.accentDark }}>
        {value}
      </p>
      <p className="mt-1.5 text-xs leading-snug text-black/45">{label}</p>
    </Card>
  );
}
