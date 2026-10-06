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
import { ROLE_LABELS } from "@/lib/testTracks";
import {
  CANDIDATE_EXPIRY_REASON,
  sweepExpiredCandidateAccounts,
  candidateWindowExpired,
} from "@/lib/workflow";

/** سجل الأعضاء — صفحته الخاصة.
 *
 *  صفحة الحسابات تُدار منها الإجراءات (إعادة إصدار، تنحية). هذه الصفحة
 *  للقراءة: كل شخص مرّ بالمنصة في جدول واحد، وإلى جانبه المرحلة التي يقف
 *  عندها الآن — وهي نفس المراحل المكتوبة في تبويب "الأعضاء — دورة الحياة". */
export default async function MembersPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  await sweepExpiredCandidateAccounts();

  const t = getDictionary(await getLocale());
  const tm = t.membersPage;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  const members = await prisma.member.findMany({
    include: { department: true, invite: true },
    orderBy: { createdAt: "desc" },
  });

  const stageOf = (m: (typeof members)[number]) => {
    if (!m.isActive) {
      return m.exitReason === CANDIDATE_EXPIRY_REASON ? tm.stageLapsed : tm.stageStopped;
    }
    if (m.approvalStatus === "rejected") return tm.stageRejected;
    if (m.approvalStatus === "approved") return tm.stageApproved;
    if (m.testStatus === "passed") return tm.stageAwaitingApproval;
    if (m.testStatus === "failed") return tm.stageFailed;
    if (!m.firstLoginAt) return candidateWindowExpired(m) ? tm.stageLapsed : tm.stageNotLoggedIn;
    return tm.stageTesting;
  };

  const approved = members.filter((m) => m.approvalStatus === "approved" && m.isActive);
  const candidates = members.filter((m) => m.approvalStatus === "pending_review" && m.isActive);
  const inactive = members.filter((m) => !m.isActive || m.approvalStatus === "rejected");

  const section = (rows: typeof members) =>
    rows.map((m) => ({
      id: m.id,
      cells: {
        name: m.fullName,
        email: <span className="break-all text-black/70">{m.email}</span>,
        dept: m.department ? (
          <span className="inline-flex items-center gap-1.5 text-black/70">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: m.department.colorHex }}
            />
            {m.department.name}
          </span>
        ) : (
          (ROLE_LABELS[m.invite.targetRole] ?? "—")
        ),
        stage: <StageBadge label={stageOf(m)} />,
        score: m.testScore === null ? "—" : `${m.testScore}%`,
        created: formatDate(m.createdAt),
      },
    }));

  const columns = [
    { key: "name", label: tm.colName, primary: true },
    { key: "email", label: tm.colEmail },
    { key: "dept", label: tm.colDept },
    { key: "stage", label: tm.colStage },
    { key: "score", label: tm.colScore },
    { key: "created", label: tm.colCreated },
  ];

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
          <StatTile label={tm.statApproved} value={approved.length} theme={theme} />
          <StatTile label={tm.statCandidates} value={candidates.length} theme={theme} />
          <StatTile label={tm.statInactive} value={inactive.length} theme={theme} />
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold">
            {tm.approvedTitle} ({approved.length})
          </h2>
          <DataTable emptyLabel={tm.approvedEmpty} columns={columns} rows={section(approved)} />
        </section>

        <section>
          <h2 className="text-base font-bold">
            {tm.candidatesTitle} ({candidates.length})
          </h2>
          <p className="mb-3 mt-1 text-xs text-black/40">{tm.candidatesHint}</p>
          <DataTable emptyLabel={tm.candidatesEmpty} columns={columns} rows={section(candidates)} />
        </section>

        <section>
          <h2 className="text-base font-bold">
            {tm.inactiveTitle} ({inactive.length})
          </h2>
          <p className="mb-3 mt-1 text-xs text-black/40">{tm.inactiveHint}</p>
          <DataTable emptyLabel={tm.inactiveEmpty} columns={columns} rows={section(inactive)} />
        </section>
      </main>
    </div>
  );
}

function StageBadge({ label }: { label: string }) {
  return (
    <span className="inline-block rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-semibold text-black/70">
      {label}
    </span>
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
