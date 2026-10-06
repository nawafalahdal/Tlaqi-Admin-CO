import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { DataTable } from "@/components/DataTable";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";

/** سجل الرسائل الصادرة — صفحته الخاصة.
 *
 *  كان أثر كل رسالة سطراً في الشيت وحده، فلا يمكن فتحه من المنصة ولا
 *  معرفة هل وصل تنبيهٌ ما لشخص بعينه. هذه الصفحة تقرأ من جدول EmailLog
 *  مباشرة، فتعمل حتى لو انقطع الاتصال بالشيت. */
export default async function MessagesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const t = getDictionary(await getLocale());
  const tm = t.messagesPage;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  const [logs, sentCount, failedCount, disabledCount] = await Promise.all([
    prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.emailLog.count({ where: { status: "أُرسلت" } }),
    prisma.emailLog.count({ where: { status: "فشل الإرسال" } }),
    prisma.emailLog.count({ where: { status: "لم تُرسل (البريد معطّل)" } }),
  ]);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={t.admin.founderRole} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton />
          <h1 className="text-lg font-bold sm:text-xl">{tm.title}</h1>
          <p className="mt-1 text-sm text-black/50">{tm.subtitle}</p>
        </div>

        <section className="grid grid-cols-3 gap-3">
          <StatTile label={tm.statSent} value={sentCount} theme={theme} />
          <StatTile label={tm.statFailed} value={failedCount} theme={theme} />
          <StatTile label={tm.statDisabled} value={disabledCount} theme={theme} />
        </section>

        {failedCount > 0 && (
          <Card className="border-r-4 p-4" style={{ borderRightColor: "#C34900" }}>
            <p className="text-sm font-semibold">{tm.failedWarnTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-black/55">{tm.failedWarnBody}</p>
          </Card>
        )}

        <section>
          <h2 className="mb-3 text-base font-bold">{tm.tableTitle}</h2>
          <DataTable
            emptyLabel={tm.empty}
            columns={[
              { key: "subject", label: tm.colSubject, primary: true },
              { key: "recipient", label: tm.colRecipient },
              { key: "kind", label: tm.colKind },
              { key: "status", label: tm.colStatus },
              { key: "at", label: tm.colDate },
            ]}
            rows={logs.map((log) => ({
              id: log.id,
              cells: {
                subject: log.subject,
                recipient: <span className="break-all text-black/70">{log.recipient}</span>,
                kind: log.kind,
                status: <DeliveryBadge status={log.status} />,
                at: formatDate(log.createdAt),
              },
            }))}
          />
          <p className="mt-3 text-xs text-black/40">{tm.limitNote}</p>
        </section>
      </main>
    </div>
  );
}

function DeliveryBadge({ status }: { status: string }) {
  const tone =
    status === "أُرسلت"
      ? "bg-emerald-50 text-emerald-700"
      : status === "فشل الإرسال"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{status}</span>;
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
