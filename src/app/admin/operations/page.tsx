import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepOverdueRequests, REQUEST_TYPE_LABELS } from "@/lib/workflow";
import { sweepTicketEscalation, TICKET_STAGE_LABELS } from "@/lib/tickets";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card, StatusBadge } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { formatDate } from "@/lib/format";
import { ReminderButton } from "./ReminderButton";

function isOverdue(dueAt: Date) {
  return Date.now() > dueAt.getTime();
}

export default async function OperationsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "operations_officer") redirect("/admin");

  await sweepOverdueRequests();
  await sweepTicketEscalation();

  const [tickets, requests] = await Promise.all([
    prisma.ticket.findMany({
      where: { status: { in: ["open", "in_progress"] } },
      include: { member: true, targetDepartment: true },
      orderBy: { stageDueAt: "asc" },
    }),
    prisma.request.findMany({
      where: { status: { in: ["new", "in_progress", "overdue"] } },
      include: { targetDepartment: true, linkedMember: true },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName="مسؤول التشغيل" userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-5xl px-5 py-8 flex flex-col gap-8">
        <section>
          <h1 className="mb-1 text-xl font-bold">التذاكر المفتوحة — كل الأقسام ({tickets.length})</h1>
          <p className="mb-4 text-sm text-black/50">
            مراقبة ومتابعة فقط — حل التذكرة نفسها يبقى مسؤولية القسم أو القائد المعني
          </p>
          {tickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">لا توجد تذاكر مفتوحة حالياً</Card>
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
                        {TICKET_STAGE_LABELS[t.stage]}
                      </span>
                      {isLate && (
                        <span className="rounded-full bg-[#FBE5E1] px-2.5 py-1 text-xs font-semibold text-[#9A2E1C]">
                          متأخرة
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold">{t.subject}</p>
                    <p className="mt-1 text-sm text-black/60">{t.description}</p>
                    <p className="mt-2 text-xs text-black/40">
                      من: {t.member.fullName} — إلى: {t.targetDepartment.name} — الموعد: {formatDate(t.stageDueAt)}
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
          <h2 className="mb-1 text-lg font-bold">الطلبات بين الأقسام — بانتظار الإنجاز ({requests.length})</h2>
          <p className="mb-4 text-sm text-black/50">بانرات ترحيبية، تصاميم، اجتماعات شرح... إلخ عبر كل الأقسام</p>
          {requests.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">لا توجد طلبات معلّقة حالياً</Card>
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
                  <p className="text-sm font-bold">{REQUEST_TYPE_LABELS[r.type] ?? r.type}</p>
                  {r.note && <p className="mt-1 text-sm text-black/60">{r.note}</p>}
                  <p className="mt-2 text-xs text-black/40">
                    {r.linkedMember ? `متعلق بـ: ${r.linkedMember.fullName} — ` : ""}
                    {r.dueDate ? `الموعد: ${formatDate(r.dueDate)}` : "بلا موعد محدد"}
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
