import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { AccountRow } from "./AccountRow";
import { MemberAccountRow } from "./MemberAccountRow";
import { StuckCandidateRow, type StuckCandidate } from "./StuckCandidateRow";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";
import { CANDIDATE_EXPIRY_REASON, sweepExpiredCandidateAccounts } from "@/lib/workflow";
import { ROLE_LABELS } from "@/lib/testTracks";

export default async function AccountsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const isSuperAdmin = session.user.role === "super_admin";
  const t = getDictionary(await getLocale());

  await sweepExpiredCandidateAccounts();

  const [accounts, members, removedUsers, lapsed, stuckRaw] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: isSuperAdmin
          ? { in: ["executive", "operations_officer", "department_admin"] }
          : { in: ["operations_officer", "department_admin"] },
      },
      include: { department: true },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
    }),
    prisma.member.findMany({
      where: { approvalStatus: "approved", isActive: true },
      include: { department: true },
      orderBy: [{ department: { name: "asc" } }, { fullName: "asc" }],
    }),
    // الحسابات القيادية المُنحّاة — سجل فقط، لا تَقبل دخولاً
    prisma.user.findMany({
      where: { isActive: false },
      include: { department: true },
      orderBy: { removedAt: "desc" },
      take: 20,
    }),
    // الحسابات التي أسقطتها المهلة — تُعرض هنا وحدها لأن هذه هي النافذة
    // الوحيدة التي تُعيد إصدارها، وإخفاؤها يعني ضياعها بلا طريق للعودة
    prisma.member.findMany({
      where: { isActive: false, exitReason: CANDIDATE_EXPIRY_REASON },
      include: { department: true },
      orderBy: { terminatedAt: "desc" },
      take: 30,
    }),
    // كل من أُنشئ له حساب ولم يُعتمد: راسب، أو ساقط المهلة، أو لم يُسلّم بعد.
    // هؤلاء هم من يحجزون المناصب والبُرُد دون أن يظهروا في أي قائمة عاملة.
    prisma.member.findMany({
      where: { approvalStatus: { not: "approved" } },
      include: { department: true, invite: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // الحسابات القيادية النشطة مفتاحاً للاسم والبريد: بها نُفسّر الاسم
  // المكرّر في قائمة العالقين بدل أن يُخمّنه من يقرأ
  const leaderEmails = new Set(accounts.map((a) => a.email.toLowerCase()));
  const leaderNames = new Set(accounts.map((a) => a.fullName.trim()));

  const stuck: StuckCandidate[] = stuckRaw.map((m) => ({
    id: m.id,
    fullName: m.fullName,
    email: m.email,
    scope: m.department?.name ?? (ROLE_LABELS[m.invite.targetRole] ?? "—"),
    stage: !m.isActive
      ? m.exitReason === CANDIDATE_EXPIRY_REASON
        ? t.membersPage.stageLapsed
        : t.membersPage.stageStopped
      : m.approvalStatus === "rejected"
        ? t.membersPage.stageRejected
        : m.testStatus === "failed"
          ? t.membersPage.stageFailed
          : m.testStatus === "passed"
            ? t.membersPage.stageAwaitingApproval
            : m.firstLoginAt
              ? t.membersPage.stageTesting
              : t.membersPage.stageNotLoggedIn,
    testScore: m.testScore,
    warningsCount: m.warningsCount,
    reopenCount: m.testReopenCount,
    // الاختبار يُعاد لمن سلّمه فرسب أو رُفض — لا لمن لم يبدأه بعد
    canReopen: m.testStatus !== "not_started" && m.approvalStatus !== "approved",
    twin: leaderEmails.has(m.email.toLowerCase())
      ? ("email" as const)
      : leaderNames.has(m.fullName.trim())
        ? ("name" as const)
        : null,
  }));

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  // المناصب التي يشغلها أكثر من حساب نشط الآن
  const duplicateSeats: { label: string; holders: string[] }[] = [];
  for (const role of ["executive", "operations_officer"] as const) {
    const holders = accounts.filter((a) => a.role === role).map((a) => a.fullName);
    if (holders.length > 1) {
      duplicateSeats.push({ label: ROLE_LABELS[role], holders });
    }
  }
  const byDept = new Map<string, string[]>();
  for (const a of accounts.filter((x) => x.role === "department_admin")) {
    const key = a.department?.name ?? "—";
    byDept.set(key, [...(byDept.get(key) ?? []), a.fullName]);
  }
  for (const [dept, holders] of byDept) {
    if (holders.length > 1) {
      duplicateSeats.push({ label: `${ROLE_LABELS.department_admin} — ${dept}`, holders });
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? t.admin.founderRole : t.admin.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-8">
        <BackButton />

        <h1 className="mb-1 text-xl font-bold">{t.admin.accountsTitle}</h1>
        <p className="mb-6 text-sm text-black/50">
          {isSuperAdmin ? t.accounts.subtitleSuper : t.accounts.subtitleExec}
        </p>

        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t.seats.governance}
        </p>

        {/* بيانات سابقة لتطبيق القاعدة قد تحمل أكثر من شاغل لمنصب واحد —
            تُعرض صراحةً لأن القاعدة تمنع الإضافة ولا تحسم ما هو قائم */}
        {duplicateSeats.length > 0 && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-900">
            <p className="font-bold">{t.seats.duplicatesTitle}</p>
            <ul className="mt-1 list-inside list-disc">
              {duplicateSeats.map((d) => (
                <li key={d.label}>
                  {d.label}: {d.holders.join("، ")}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 opacity-80">{t.seats.duplicatesHint}</p>
          </div>
        )}

        {accounts.length === 0 ? (
          <Card className="p-8 text-center text-sm text-black/40">{t.accounts.empty}</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                theme={theme}
                canRemove={isSuperAdmin}
                account={{
                  id: a.id,
                  fullName: a.fullName,
                  email: a.email,
                  role: a.role,
                  departmentName: a.department?.name ?? null,
                }}
              />
            ))}
          </div>
        )}

        <h2 className="mb-1 mt-10 text-lg font-bold">{t.opsExtras.memberAccountsTitle}</h2>
        <p className="mb-6 text-sm text-black/50">
          {t.misc.memberAccountsHint}
        </p>

        {members.length === 0 ? (
          <Card className="p-8 text-center text-sm text-black/40">{t.opsExtras.memberAccountsEmpty}</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {members.map((m) => (
              <MemberAccountRow
                key={m.id}
                theme={theme}
                member={{
                  id: m.id,
                  fullName: m.fullName,
                  email: m.email,
                  departmentName: m.department?.name ?? "—",
                }}
              />
            ))}
          </div>
        )}

        {removedUsers.length > 0 && (
          <>
            <h2 className="mb-4 mt-10 text-lg font-bold">{t.seats.removedTitle}</h2>
            <div className="flex flex-col gap-3">
              {removedUsers.map((u) => (
                <Card key={u.id} className="p-4">
                  <p className="text-sm font-semibold">{u.fullName}</p>
                  <p className="break-all text-xs text-black/50" dir="ltr">
                    {u.email}
                  </p>
                  <p className="mt-1 text-xs text-black/40">
                    {u.department ? `${u.department.name} — ` : ""}
                    {u.removalReason}
                  </p>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* المرشّحون العالقون — من هنا تُفكّ العُقَد التي تحجز المناصب والبُرُد */}
        <section>
          <h2 className="mb-1 mt-10 text-lg font-bold">{t.stuck.sectionTitle}</h2>
          <p className="mb-4 text-sm text-black/50">{t.stuck.sectionHint}</p>
          {stuck.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{t.stuck.empty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {stuck.map((c) => (
                <StuckCandidateRow
                  key={c.id}
                  candidate={c}
                  canPurge={isSuperAdmin}
                  theme={theme}
                />
              ))}
            </div>
          )}
        </section>

        {lapsed.length > 0 && (
          <>
            <h2 className="mb-1 mt-10 text-lg font-bold">{t.candidateWindow.lapsedTitle}</h2>
            <p className="mb-6 text-sm text-black/50">{t.candidateWindow.lapsedHint}</p>
            <div className="flex flex-col gap-3">
              {lapsed.map((m) => (
                <MemberAccountRow
                  key={m.id}
                  theme={theme}
                  lapsed
                  member={{
                    id: m.id,
                    fullName: m.fullName,
                    email: m.email,
                    departmentName: m.department?.name ?? "—",
                  }}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
