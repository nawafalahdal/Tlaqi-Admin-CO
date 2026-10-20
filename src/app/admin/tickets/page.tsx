import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepTicketEscalation, TICKET_STAGE_LABELS, TICKET_INCLUDE, ticketAuthor, ticketTargetLabel, ticketVisibilityWhere, canRespondToTicket } from "@/lib/tickets";
import { themeFromColor, SUPER_ADMIN_THEME, brandInk} from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { TicketCard } from "./TicketCard";
import { DataTable } from "@/components/DataTable";
import { TicketCta } from "@/components/tickets/TicketCta";
import { ROLE_LABELS } from "@/lib/testTracks";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";
import { scheduleDueSweeps } from "@/lib/sweepThrottle";

/** المفتوحةُ بطاقاتٌ تفاعلية — أقربُ ستّين موعداً؛ والمغلقةُ جدولٌ — أحدثُ مئة */
const OPEN_TAKE = 60;
const CLOSED_TAKE = 100;

/** صفحة التذاكر الخاصة — كل التذاكر في مكان واحد بدل تفرّقها بين اللوحات.
 *  المفتوحة تُعرض ببطاقات قابلة للإجراء، والمغلقة بجدول مرجعي. */
export default async function TicketsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // قادة الأقسام مشمولون: التذاكر قناة العمل، وحجبها عنهم كان يقطع
  // القيادة عن أهم مسار تواصل في المنصة
  const allowed = ["super_admin", "executive", "operations_officer", "department_admin"];
  if (!allowed.includes(session.user.role)) redirect("/admin");

  scheduleDueSweeps({ ticket_escalation: () => sweepTicketEscalation() });

  const t = getDictionary(await getLocale());
  const tt = t.ticketsPage;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  // الأعدادُ عدٌّ في القاعدة، والقائمتان بحدّ: المفتوحةُ أقربُها موعداً،
  // والمغلقةُ أحدثُها. كانت قراءةً واحدةً لمئتين يُشتقّ منها كلُّ رقم —
  // فبآلافِ التذاكر تكذب البطاقات (تعدّ المئتين وحدها) ويثقل الردّ.
  const now = new Date();
  const visible = ticketVisibilityWhere(session);
  const openW = { AND: [visible, { status: { not: "resolved" as const } }] };
  const closedW = { AND: [visible, { status: "resolved" as const }] };
  const [open, closed, openCount, lateCount, escalatedCount, closedCount] = await Promise.all([
    prisma.ticket.findMany({ where: openW, include: TICKET_INCLUDE, orderBy: { stageDueAt: "asc" }, take: OPEN_TAKE }),
    prisma.ticket.findMany({ where: closedW, include: TICKET_INCLUDE, orderBy: { resolvedAt: "desc" }, take: CLOSED_TAKE }),
    prisma.ticket.count({ where: openW }),
    prisma.ticket.count({ where: { AND: [openW, { stageDueAt: { lt: now } }] } }),
    prisma.ticket.count({ where: { AND: [openW, { stage: "ceo_escalation" as const }] } }),
    prisma.ticket.count({ where: closedW }),
  ]);

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName={t.admin.founderRole} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <h1 className="text-lg font-bold sm:text-xl">{tt.title}</h1>
          <p className="mt-1 text-sm text-black/50">{tt.subtitle}</p>
        </div>

        <TicketCta
          href="/admin/tickets/new"
          title={t.composer.homeCtaTitle}
          body={t.composer.homeCtaBody}
          cta={t.composer.cta}
        />

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={tt.statOpen} value={openCount} theme={theme} />
          <StatTile label={tt.statLate} value={lateCount} theme={theme} />
          <StatTile label={tt.statEscalated} value={escalatedCount} theme={theme} />
          <StatTile label={tt.statClosed} value={closedCount} theme={theme} />
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold">
            {tt.openTitle} ({openCount})
          </h2>
          {open.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{tt.openEmpty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {open.map((x) => (
                <TicketCard
                  key={x.id}
                  theme={theme}
                  // الشاشة تعكس القاعدة نفسها التي يفرضها الخادم: من لا
                  // يملك الردّ لا يُعرض له زرّه أصلاً، فلا يُخطئ ثم يُمنع
                  readOnly={!canRespondToTicket(x, session)}
                  mine={x.raisedByUserId === session.user.id}
                  ticket={{
                    id: x.id,
                    ticketNumber: x.ticketNumber,
                    subject: x.subject,
                    description: x.description,
                    status: x.status,
                    stage: x.stage,
                    stageDueAt: x.stageDueAt.toISOString(),
                    resolutionNote: x.resolutionNote,
                    linkUrl: x.linkUrl,
                    memberName: ticketAuthor(x).name,
                    targetDepartmentName: ticketTargetLabel(x),
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold">
            {tt.closedTitle} ({closedCount})
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
                member: ticketAuthor(x).name,
                dept: (
                  <span className="inline-flex items-center gap-1.5 text-black/70">
                    {x.targetDepartment && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: x.targetDepartment.colorHex }}
                      />
                    )}
                    {ticketTargetLabel(x)}
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
      <p className="text-2xl font-bold leading-none" style={{ color: brandInk(theme) }}>
        {value}
      </p>
      <p className="mt-1.5 text-xs leading-snug text-black/45">{label}</p>
    </Card>
  );
}
