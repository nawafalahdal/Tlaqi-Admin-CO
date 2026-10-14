import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME, brandInk} from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { AccountRow } from "./AccountRow";
import { MyAccountCard } from "./MyAccountCard";
import { SeatConflicts } from "@/components/SeatConflicts";
import { RemovedAccountRow } from "./RemovedAccountRow";
import { MemberAccountRow } from "./MemberAccountRow";
import { StuckCandidateRow, type StuckCandidate } from "./StuckCandidateRow";
import { BackButton } from "@/components/BackButton";
import { DataTable } from "@/components/DataTable";
import { FounderMemberControls } from "@/components/FounderMemberControls";
import { OrgChartLink } from "@/components/OrgChartLink";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";
import {
  CANDIDATE_EXPIRY_REASON,
  sweepExpiredCandidateAccounts,
  candidateWindowExpired,
} from "@/lib/workflow";
import { ROLE_LABELS } from "@/lib/testTracks";
import { loginHealthFor, loginHealthNotes, loginHealthBlocked } from "@/lib/loginHealth";
import { canAward } from "@/lib/awards";

/** إدارة الأعضاء والهيكل التنظيمي — موضعٌ واحد للشخص وموقعه وقسمه.
 *
 *  كانت «إدارة حسابات القيادة» و«سجلّ الأعضاء» صفحتين: الأولى للإجراء
 *  والثانية للقراءة، وكلتاهما تقرأ الأشخاص نفسهم بشكلٍ مختلف. فمن أراد
 *  أن يعرف حالَ شخصٍ ثم يُجري عليه إجراءً تنقّل بين شاشتين، ومن أراد
 *  إضافةَ شخصٍ لم يَدرِ من أيّ الشاشتين يبدأ — وذاك طريقُ أن يُدخَل
 *  مرتين. فصارتا واحدة: **الإجراءُ أولاً** (الحسابات القيادية، حسابات
 *  الأعضاء، التصنيف، المحو، المُنحّون، العالقون)، ثم **السجلّ** جدولاً
 *  مرجعياً لكلّ من مرّ بالمنصة. ولا بياناً فُقِد: كلُّ قسمٍ من الصفحتين
 *  باقٍ بإجرائه.
 *
 *  والهيكل التنظيمي مربوطٌ من هنا لا مُدخَلاً: يُحسَب من هذه البيانات
 *  نفسها، فمن أُضيف هنا ظهر فيه وحده ولا يُكتَب مرتين.
 */
export default async function PeoplePage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const isSuperAdmin = session.user.role === "super_admin";
  const t = getDictionary(await getLocale());
  const tm = t.membersPage;

  await sweepExpiredCandidateAccounts();

  const [me, accounts, allMembers, removedUsers, allDepartments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { welcomeEmailSentAt: true },
    }),
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
    // قراءةٌ واحدة لكلّ سجلات العضوية ثم تُقسَّم في الذاكرة. كانت
    // أربع قراءاتٍ على الجدول نفسه بمرشّحاتٍ متقاطعة، فيُمكن أن يختلف
    // ما تراه الأقسام إن تغيّر صفٌّ بينها — والقِسمة في الذاكرة تُغني.
    prisma.member.findMany({
      include: { department: true, invite: true },
      orderBy: { createdAt: "desc" },
    }),
    // الحسابات القيادية المُنحّاة — سجل فقط، لا تَقبل دخولاً
    prisma.user.findMany({
      where: { isActive: false },
      include: { department: true },
      orderBy: { removedAt: "desc" },
      take: 20,
    }),
    // كلُّ الأقسام تُعرض للتصنيف — «الإدارة العليا» منها.
    //
    // كانت مُستثناةً بشرط `leadershipOnly: false`، فظهرت القائمة بثلاثة
    // أقسام ولم يجد المؤسس القسمَ الذي أنشأه. والقسم الاستثنائي قسمٌ
    // قائم في القاعدة وله لونُه وصفُّه في الهيكل، فحجبُه عن التصنيف
    // يجعله قسماً لا يُدخَل إليه — وهذا ليس حكماً، بل نقصٌ في الواجهة.
    prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: [{ leadershipOnly: "desc" }, { name: "asc" }],
    }),
  ]);

  // مَن وصلته بطاقتُه فعلاً — من السجل لا من الحقل وحده. قراءةٌ واحدة
  // لكل الصفوف بدل استعلامٍ لكل بطاقة.
  const welcomedEmails = new Set(
    (
      await prisma.emailLog.findMany({
        where: { kind: "ترحيب", status: "أُرسلت" },
        select: { recipient: true },
        distinct: ["recipient"],
      })
    ).map((r) => r.recipient.toLowerCase())
  );
  /** جملةُ الوصول — أو `null` لمن لم تصله بعد */
  const welcomedLabel = (email: string, at: Date | null): string | null => {
    if (at) return `في ${formatDate(at)}`;
    return welcomedEmails.has(email.toLowerCase()) ? "سابقاً (مثبَّتٌ في سجل الرسائل)" : null;
  };

  // ── حالةُ الدخول: للمؤسس وحده. ولا تُجلَب أصلاً لغيره — لا تُجلَب
  //    ثم تُخفى. وعددُ المحاولات الفاشلة وقفلُ الحساب يُقرأ منهما
  //    محاولاتُ انتحالٍ على شخصٍ بعينه، فليست بياناتٍ تُعمَّم.
  const seesLoginHealth = isSuperAdmin;
  const health = seesLoginHealth
    ? await loginHealthFor([
        ...accounts.map((a) => ({
          email: a.email,
          mustChangePassword: a.mustChangePassword,
          totpEnabled: a.totpEnabled,
          neverSignedIn: a.passwordChangedAt === null && a.mustChangePassword,
        })),
        ...allMembers
          .filter((m) => m.isActive)
          .map((m) => ({
            email: m.email,
            mustChangePassword: m.mustChangePassword,
            totpEnabled: false,
            neverSignedIn: m.firstLoginAt === null,
          })),
      ])
    : new Map();

  const notesFor = (email: string): string[] | undefined => {
    if (!seesLoginHealth) return undefined;
    const h = health.get(email.toLowerCase());
    if (!h || !loginHealthBlocked(h)) return undefined;
    return loginHealthNotes(h);
  };

  const mayAward = canAward(session.user.role);

  const members = allMembers
    .filter((m) => m.approvalStatus === "approved" && m.isActive)
    .sort(
      (a, b) =>
        (a.department?.name ?? "").localeCompare(b.department?.name ?? "", "ar") ||
        a.fullName.localeCompare(b.fullName, "ar")
    );

  // كل من أُنشئ له حساب ولم يُعتمد: راسب، أو ساقط المهلة، أو لم يُسلّم بعد.
  // هؤلاء هم من يحجزون المناصب والبُرُد دون أن يظهروا في أي قائمة عاملة.
  const stuckRaw = allMembers.filter((m) => m.approvalStatus !== "approved").slice(0, 50);

  // الحسابات التي أسقطتها المهلة — تُعرض هنا وحدها لأن هذه هي النافذة
  // الوحيدة التي تُعيد إصدارها، وإخفاؤها يعني ضياعها بلا طريق للعودة
  const lapsed = allMembers
    .filter((m) => !m.isActive && m.exitReason === CANDIDATE_EXPIRY_REASON)
    .sort((a, b) => (b.terminatedAt?.getTime() ?? 0) - (a.terminatedAt?.getTime() ?? 0))
    .slice(0, 30);

  // الحسابات القيادية النشطة مفتاحاً للاسم والبريد: بها نُفسّر الاسم
  // المكرّر في قائمة العالقين بدل أن يُخمّنه من يقرأ
  const leaderEmails = new Set(accounts.map((a) => a.email.toLowerCase()));
  const leaderNames = new Set(accounts.map((a) => a.fullName.trim()));

  const stageOf = (m: (typeof allMembers)[number]) => {
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

  const stuck: StuckCandidate[] = stuckRaw.map((m) => ({
    id: m.id,
    fullName: m.fullName,
    email: m.email,
    scope: m.department?.name ?? (ROLE_LABELS[m.invite.targetRole] ?? "—"),
    stage: stageOf(m),
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

  // السجلّ: أقسامه الثلاثة كما كانت في «سجل الأعضاء» بلا نقص
  const registerApproved = members;
  const registerCandidates = allMembers.filter(
    (m) => m.approvalStatus === "pending_review" && m.isActive
  );
  const registerInactive = allMembers.filter(
    (m) => !m.isActive || m.approvalStatus === "rejected"
  );

  const registerRows = (rows: typeof allMembers) =>
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

  const registerColumns = [
    { key: "name", label: tm.colName, primary: true },
    { key: "email", label: tm.colEmail },
    { key: "dept", label: tm.colDept },
    { key: "stage", label: tm.colStage },
    { key: "score", label: tm.colScore },
    { key: "created", label: tm.colCreated },
  ];

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? t.admin.founderRole : t.admin.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-8">
        <BackButton />

        <h1 className="mb-1 text-xl font-bold">إدارة الأعضاء والهيكل التنظيمي</h1>
        <p className="mb-6 text-sm leading-relaxed text-black/50">
          الشخص وموقعه وقسمه في موضعٍ واحد: الإجراءات أولاً، ثم سجلُّ كلّ من مرّ بالمنصة.
          {" "}
          {isSuperAdmin ? t.accounts.subtitleSuper : t.accounts.subtitleExec}
        </p>

        {/* الهيكل يُحسَب من هذه البيانات نفسها: من أُضيف هنا ظهر فيه
            وحده، فلا يُدخَل الشخص مرتين */}
        <div className="mb-4">
          <OrgChartLink theme={theme} />
        </div>

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
                welcomeSentAt: welcomedLabel(
                  session.user.email ?? "",
                  me?.welcomeEmailSentAt ?? null
                ),
              }}
            />
          </div>
        )}

        <h2 className="mb-3 text-lg font-bold">{t.admin.accountsTitle}</h2>
        {accounts.length === 0 ? (
          <Card className="p-8 text-center text-sm text-black/40">{t.accounts.empty}</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                theme={theme}
                canRemove={isSuperAdmin}
                loginNotes={notesFor(a.email)}
                canAward={mayAward}
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
                loginNotes={notesFor(m.email)}
                canAward={mayAward}
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

        {/* إجراءات المؤسس على المعتمدين: تصحيح تاريخ الانضمام التنظيمي
            (لمن سبق المنصة) وإرسال بطاقة الانضمام. للمؤسس وحده —
            والحرس في الخادم لا في إخفاء هذا القسم. */}
        {isSuperAdmin && members.length > 0 && (
          <section>
            <h2 className="mb-1 mt-10 text-lg font-bold">إجراءات المؤسس</h2>
            <p className="mb-3 text-xs text-black/40">
              تاريخ الانضمام التنظيمي لمن انضمّ قبل وجود المنصة، وإرسال بطاقة الانضمام.
            </p>
            <div className="flex flex-col gap-3">
              {members.map((m) => (
                <Card key={m.id} className="p-4">
                  <FounderMemberControls
                    memberId={m.id}
                    memberName={m.fullName}
                    orgJoinDate={m.orgJoinDate ? m.orgJoinDate.toISOString().slice(0, 10) : ""}
                    welcomeSentAt={welcomedLabel(m.email, m.welcomeEmailSentAt)}
                    theme={theme}
                  />
                </Card>
              ))}
            </div>
          </section>
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

        {/* ===== السجلّ: قراءةٌ لا إجراء ===== */}
        <div className="mt-12 border-t border-black/10 pt-8">
          <h2 className="text-lg font-bold">{tm.title}</h2>
          <p className="mt-1 text-sm text-black/50">{tm.subtitle}</p>

          <section className="mt-4 grid grid-cols-3 gap-3">
            <StatTile label={tm.statApproved} value={registerApproved.length} theme={theme} />
            <StatTile label={tm.statCandidates} value={registerCandidates.length} theme={theme} />
            <StatTile label={tm.statInactive} value={registerInactive.length} theme={theme} />
          </section>

          <section className="mt-6">
            <h3 className="mb-3 text-base font-bold">
              {tm.approvedTitle} ({registerApproved.length})
            </h3>
            <DataTable
              emptyLabel={tm.approvedEmpty}
              columns={registerColumns}
              rows={registerRows(registerApproved)}
            />
          </section>

          <section className="mt-6">
            <h3 className="text-base font-bold">
              {tm.candidatesTitle} ({registerCandidates.length})
            </h3>
            <p className="mb-3 mt-1 text-xs text-black/40">{tm.candidatesHint}</p>
            <DataTable
              emptyLabel={tm.candidatesEmpty}
              columns={registerColumns}
              rows={registerRows(registerCandidates)}
            />
          </section>

          <section className="mt-6">
            <h3 className="text-base font-bold">
              {tm.inactiveTitle} ({registerInactive.length})
            </h3>
            <p className="mb-3 mt-1 text-xs text-black/40">{tm.inactiveHint}</p>
            <DataTable
              emptyLabel={tm.inactiveEmpty}
              columns={registerColumns}
              rows={registerRows(registerInactive)}
            />
          </section>
        </div>
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
      <p className="text-2xl font-bold leading-none" style={{ color: brandInk(theme) }}>
        {value}
      </p>
      <p className="mt-1.5 text-xs leading-snug text-black/45">{label}</p>
    </Card>
  );
}
