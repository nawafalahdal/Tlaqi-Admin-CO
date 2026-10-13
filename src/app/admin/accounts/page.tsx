import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { AccountRow } from "./AccountRow";
import { MyAccountCard } from "./MyAccountCard";
import { SeatConflicts } from "@/components/SeatConflicts";
import { RemovedAccountRow } from "./RemovedAccountRow";
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

  const [accounts, members, removedUsers, lapsed, stuckRaw, allDepartments] = await Promise.all([
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
    // الأقسام العاملة وحدها تُعرَض للتصنيف: القسم الاستثنائي يتبع
    // الإدارة العليا ولا يُصنَّف فيه عضوٌ بقرارٍ إداري
    prisma.department.findMany({
      where: { leadershipOnly: false },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
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

        {/* التعارض يُعرض هنا بوقائعه وبزرّ محوه — لا نصّاً يُحيل إلى
            شاشةٍ أخرى. وكان قائمةً نصّية تقول «نحِّ من لم يبقَ في
            منصبه»، فيرى المؤسس العطب ولا يملك أداته. والمكوّن نفسه
            يُستعمل في اللوحة، فالقاعدة في موضعٍ واحد. */}
        <div className="mb-4">
          <SeatConflicts canPurge={isSuperAdmin} />
        </div>

        {/* حسابُ المؤسس نفسه — خارج القائمة لأنها لا تَعرض له تنحيةً ولا
            حذفاً، فلو تُرك بلا موضعٍ هنا لم يجد طريقاً إلى بطاقته */}
        {isSuperAdmin && (
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-bold text-black/70">{t.accounts.myAccountTitle}</h3>
            <MyAccountCard
              theme={theme}
              account={{
                id: session.user.id,
                fullName: session.user.name ?? "—",
                email: session.user.email ?? "—",
                roleLabel: t.roles.super_admin,
              }}
            />
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
                canPurge={isSuperAdmin}
                // التصنيف يُعرَض لغير المصنّف وحده: من صُنِّف لا يُعاد
                // تصنيفه، والخادم يرفضه على كل حال
                assignableDepartments={
                  isSuperAdmin && m.departmentId === null ? allDepartments : undefined
                }
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
              {/* المُنحّى بريدُه ما يزال محجوزاً في القاعدة. فكان القسم
                  سجلاً بلا طريق: لا يَقبل الحساب دخولاً، ولا يُدعى
                  صاحبه من جديد ببريده، ولا يملك المؤسس ما يُحرّره به. */}
              {removedUsers.map((u) => (
                <RemovedAccountRow
                  key={u.id}
                  theme={theme}
                  canPurge={isSuperAdmin}
                  account={{
                    id: u.id,
                    fullName: u.fullName,
                    email: u.email,
                    departmentName: u.department?.name ?? null,
                    removalReason: u.removalReason,
                  }}
                />
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
                  canPurge={isSuperAdmin}
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
