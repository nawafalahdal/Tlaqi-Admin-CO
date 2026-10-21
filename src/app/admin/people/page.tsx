import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { Card } from "@/components/ui";
import { SeatConflicts } from "@/components/SeatConflicts";
import { RemovedAccountRow } from "./RemovedAccountRow";
import { MemberAccountRow } from "./MemberAccountRow";
import { StuckCandidateRow, type StuckCandidate } from "./StuckCandidateRow";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { RosterRowActions } from "./RosterRowActions";
import { roleTitle } from "@/lib/gender";
import { avatarUrl } from "@/lib/avatarUrl";
import { formatDate, sinceLabel } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";
import {
  CANDIDATE_EXPIRY_REASON,
  sweepExpiredCandidateAccounts,
  candidateWindowExpired,
} from "@/lib/workflow";
import { accountRoleLabel } from "@/lib/testTracks";
import { loginHealthFor, loginHealthNotes, loginHealthBlocked } from "@/lib/loginHealth";
import { scheduleDueSweeps } from "@/lib/sweepThrottle";
import { isRosterMember } from "@/lib/roster";
import { affiliationFor } from "@/lib/seniorAffiliation";
import { PersonAvatar } from "@/components/PersonAvatar";
import { portraitColorFor } from "@/lib/portraitTone";

import { fmt } from "@/i18n/fmt";
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
type Tab = "all" | "leaders" | "members" | "joining" | "attention" | "removed";
// أسماءُ التبويبات من القاموس (`tabs`) — هنا معرّفاتُها وترتيبُها
const TABS: { id: Tab }[] = [
  { id: "all" },
  { id: "leaders" },
  { id: "members" },
  { id: "joining" },
  { id: "attention" },
  { id: "removed" },
];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; dept?: string }>;
}) {
  const locale = await getLocale();
  const L = getDictionary(locale).rPeoplePage;
  const sp = await searchParams;
  const tab: Tab = TABS.find((x) => x.id === sp.tab)?.id ?? "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const deptFilter = sp.dept ?? "";
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const isSuperAdmin = session.user.role === "super_admin";
  const t = getDictionary(locale);
  const tm = t.membersPage;

  scheduleDueSweeps({ candidate_expiry: () => sweepExpiredCandidateAccounts() });

  const [me, accounts, allMembers, removedUsers, allDepartments] =
    await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true, fullName: true, email: true, role: true, jobTitle: true, gender: true,
        createdAt: true, avatarVersion: true, totpEnabled: true, welcomeEmailSentAt: true,
        department: { select: { id: true, name: true, colorHex: true } },
      },
    }),
    prisma.user.findMany({
      // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
      omit: { avatarData: true },
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
      // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
      omit: { avatarData: true },
      include: { department: true, invite: true },
      orderBy: { createdAt: "desc" },
    }),
    // الحسابات القيادية المُنحّاة — سجل فقط، لا تَقبل دخولاً
    prisma.user.findMany({
      // الصورةُ تُطلب من مسارها المخزَّن — لا تُحمَّل مع كل صفّ
      omit: { avatarData: true },
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
      where: OPEN_DEPARTMENT_WHERE,
      select: { id: true, name: true, colorHex: true, leadershipOnly: true, parentId: true },
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
  // من أخفقت بطاقتُه ولم تصله بعدها — يُقال «فشل الإرسال» لا «لم تُرسل»
  const failedWelcome = new Set(
    (
      await prisma.emailLog.findMany({
        where: { kind: "ترحيب", status: "فشل الإرسال" },
        select: { recipient: true },
        distinct: ["recipient"],
      })
    )
      .map((r) => r.recipient.toLowerCase())
      .filter((e) => !welcomedEmails.has(e))
  );
  /** جملةُ الوصول — أو `null` لمن لم تصله بعد */
  const welcomedLabel = (email: string, at: Date | null): string | null => {
    if (at) return fmt(L.on, formatDate(at));
    return welcomedEmails.has(email.toLowerCase()) ? L.earlierRecordedInThe : null;
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
    return loginHealthNotes(h, undefined, locale);
  };


  const members = allMembers
    .filter(isRosterMember)
    .sort(
      (a, b) =>
        (a.department?.name ?? "").localeCompare(b.department?.name ?? "", "ar") ||
        a.fullName.localeCompare(b.fullName, "ar")
    );

  // كل من أُنشئ له حساب ولم يُعتمد: راسب، أو ساقط المهلة، أو لم يُسلّم بعد.
  // هؤلاء هم من يحجزون المناصب والبُرُد دون أن يظهروا في أي قائمة عاملة.
  // والساقطون بالمهلة لهم قسمُهم (بإعادة الإصدار) — فلا يُعرَضون هنا ثانيةً
  const stuckRaw = allMembers
    .filter(
      (m) =>
        m.approvalStatus !== "approved" &&
        !(!m.isActive && m.exitReason === CANDIDATE_EXPIRY_REASON)
    )
    .slice(0, 50);

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
    scope: m.department?.name ?? accountRoleLabel(m.invite.targetRole, locale),
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
          accountRoleLabel(m.invite.targetRole, locale)
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

  // ── السجلّ الموحَّد: كلُّ شخصٍ صفٌّ واحد.
  //
  // **سببُ التكرار الذي ظهر عند التمرير:** كانت الصفحة ترسم العضو المعتمد
  // ثلاث مرات — في «حسابات الأعضاء»، ثم في «إجراءات المؤسس»، ثم في جدول
  // «السجل» أسفلها — والمرشّحَ مرّتين أو ثلاثاً. لم تكن البيانات مكرّرة،
  // بل الرسم. فصار لكلّ شخصٍ صفٌّ واحد في تبويبه، وإجراءاتُه في ملفه.
  type Row = {
    kind: "user" | "member";
    id: string;
    name: string;
    email: string;
    role: string;
    dept: { id: string; name: string; colorHex: string } | null;
    since: Date;
    avatar: string | null;
    status: { label: string; tone: "ok" | "warn" };
    welcome: { label: string; tone: "ok" | "warn" | "bad" };
    leader: boolean;
    self: boolean;
  };
  const welcomeOf = (email: string, at: Date | null): Row["welcome"] => {
    if (welcomedLabel(email, at)) return { label: L.accepted, tone: "ok" };
    if (failedWelcome.has(email.toLowerCase())) return { label: L.sendingFailed, tone: "bad" };
    return { label: L.notSent, tone: "warn" };
  };
  const statusOf = (email: string, totp: boolean | null): Row["status"] => {
    if (notesFor(email)) return { label: L.loginTrouble, tone: "warn" };
    if (totp === false) return { label: L.noTwoFactor, tone: "warn" };
    return { label: L.active, tone: "ok" };
  };

  // المؤسس والتنفيذي ومسؤول التشغيل من الإدارة العليا بدورهم — `seniorAffiliation`
  const seniorDept = allDepartments.find((d) => d.leadershipOnly && !d.parentId) ?? null;
  const seniorRef = seniorDept ? { id: seniorDept.id, name: seniorDept.name, colorHex: seniorDept.colorHex } : null;
  const leaderRows: Row[] = [
    ...(me
      ? [
          {
            kind: "user" as const,
            id: me.id,
            name: me.fullName,
            email: me.email,
            role: roleTitle(me.role, me.gender, me.department?.name, locale),
            dept: affiliationFor(me.role, me.department, seniorRef),
            since: me.createdAt,
            avatar: avatarUrl("user", me.id, me.avatarVersion),
            status: statusOf(me.email, me.totpEnabled),
            welcome: welcomeOf(me.email, me.welcomeEmailSentAt),
            leader: true,
            self: true,
          },
        ]
      : []),
    ...accounts.map((a) => ({
      kind: "user" as const,
      id: a.id,
      name: a.fullName,
      email: a.email,
      role: roleTitle(a.role, a.gender, a.department?.name, locale),
      dept: affiliationFor(
        a.role,
        a.department ? { id: a.department.id, name: a.department.name, colorHex: a.department.colorHex } : null,
        seniorRef
      ),
      since: a.createdAt,
      avatar: avatarUrl("user", a.id, a.avatarVersion),
      status: statusOf(a.email, a.totpEnabled),
      welcome: welcomeOf(a.email, a.welcomeEmailSentAt),
      leader: true,
      self: false,
    })),
  ];
  const memberRows: Row[] = members.map((m) => ({
    kind: "member" as const,
    id: m.id,
    name: m.fullName,
    email: m.email,
    role: [roleTitle("member", m.gender, null, locale), m.jobTitle?.trim()].filter(Boolean).join(" · "),
    dept: m.department ? { id: m.department.id, name: m.department.name, colorHex: m.department.colorHex } : null,
    since: m.orgJoinDate ?? m.decidedAt ?? m.joinDate,
    avatar: avatarUrl("member", m.id, m.avatarVersion),
    status: statusOf(m.email, null),
    welcome: welcomeOf(m.email, m.welcomeEmailSentAt),
    leader: false,
    self: false,
  }));

  const matches = (r: Row) =>
    (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) &&
    (!deptFilter || r.dept?.id === deptFilter);
  const everyone = [...leaderRows, ...memberRows];
  const attention = everyone.filter((r) => r.status.tone !== "ok" || r.welcome.tone !== "ok");
  const counts: Record<Tab, number> = {
    all: everyone.length,
    leaders: leaderRows.length,
    members: memberRows.length,
    joining: stuck.length + lapsed.length,
    attention: attention.length,
    removed: removedUsers.length + registerInactive.length,
  };
  const shown = (tab === "leaders" ? leaderRows : tab === "members" ? memberRows : tab === "attention" ? attention : everyone).filter(matches);
  const rosterTab = tab === "all" || tab === "leaders" || tab === "members" || tab === "attention";

  const href = (patch: Partial<{ tab: string; q: string; dept: string }>) => {
    const p = new URLSearchParams();
    const next = { tab, q: sp.q ?? "", dept: deptFilter, ...patch };
    if (next.tab && next.tab !== "all") p.set("tab", next.tab);
    if (next.q) p.set("q", next.q);
    if (next.dept) p.set("dept", next.dept);
    const s = p.toString();
    return s ? `/admin/people?${s}` : "/admin/people";
  };
  const tone = {
    ok: "bg-green-50 text-green-800 ring-green-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    bad: "bg-red-50 text-red-800 ring-red-200",
  } as const;

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title={L.members}
          description={L.oneRegisterForEveryone}
          actions={
            <Link href="/admin/invites" className="btn-brand ticket-cta__btn">{L.inviteSomeone}</Link>
          }
        />

        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">{t.seats.governance}</p>
        <SeatConflicts canPurge={isSuperAdmin} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="roster-tabs" aria-label={L.registerTabs}>
            {TABS.map((x) => (
              <Link key={x.id} href={href({ tab: x.id })} aria-current={tab === x.id ? "page" : undefined} className="roster-tab">
                {L.tabs[x.id]} <span className="roster-tab__n">{counts[x.id]}</span>
              </Link>
            ))}
          </nav>
          {rosterTab && (
            <form action="/admin/people" className="flex flex-wrap gap-2" role="search">
              {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
              <input
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder={L.searchByNameOr}
                aria-label={L.searchByNameOr}
                className="min-h-10 w-56 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
              />
              <select
                name="dept"
                defaultValue={deptFilter}
                aria-label={L.department}
                className="min-h-10 rounded-xl border border-black/10 bg-white px-3 text-sm"
              >
                <option value="">{L.allDepartments}</option>
                {allDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="wizard-btn-2 !min-h-10">{L.filter}</button>
            </form>
          )}
        </div>

        {rosterTab && (
          <DataTable
            emptyLabel={q || deptFilter ? L.noOneMatchesThe : t.opsExtras.memberAccountsEmpty}
            columns={[
              { key: "name", label: L.name, primary: true },
              { key: "role", label: L.role },
              { key: "dept", label: L.department },
              { key: "status", label: L.status },
              { key: "since", label: L.tenure },
              { key: "welcome", label: L.welcomeCard },
              { key: "actions", label: "" },
            ]}
            rows={shown.map((r) => ({
              id: `${r.kind}-${r.id}`,
              cells: {
                name: (
                  <span className="flex items-center gap-2.5">
                    <PersonAvatar
                      src={r.avatar}
                      name={r.name}
                      color={portraitColorFor(null, r.dept)}
                      className="h-9 w-9"
                    />
                    <span className="min-w-0">
                      <span className="block font-bold">
                        {r.name}
                        {r.self && <span className="ms-1.5 text-[11px] font-semibold text-black/40">{L.you}</span>}
                      </span>
                      <span className="block break-all text-[11px] text-black/45">{r.email}</span>
                    </span>
                  </span>
                ),
                role: <span className="text-sm text-black/70">{r.role}</span>,
                dept: r.dept ? (
                  <span className="inline-flex items-center gap-1.5 text-black/70">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: r.dept.colorHex }} />
                    {r.dept.name}
                  </span>
                ) : (
                  "—"
                ),
                status: <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${tone[r.status.tone]}`}>{r.status.label}</span>,
                since: <span className="text-xs text-black/50">{sinceLabel(r.since, undefined, locale)}</span>,
                welcome: <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${tone[r.welcome.tone]}`}>{r.welcome.label}</span>,
                actions: (
                  <RosterRowActions
                    kind={r.kind}
                    id={r.id}
                    name={r.name}
                    profileHref={`/admin/people/${r.kind}/${r.id}?from=${encodeURIComponent(href({}))}`}
                  />
                ),
              },
            }))}
          />
        )}

        {rosterTab && (
          <p className="text-[11px] leading-relaxed text-black/45">{L.acceptedMeansTheEmail}</p>
        )}

        {/* ── قيد الانضمام: العالقون، ثم الساقطون بالمهلة — كلٌّ في قسمه وحده */}
        {tab === "joining" && (
          <>
            <section>
              <h2 className="mb-1 text-lg font-bold">{t.stuck.sectionTitle}</h2>
              <p className="mb-4 text-sm text-black/50">{t.stuck.sectionHint}</p>
              {stuck.length === 0 ? (
                <Card className="p-8 text-center text-sm text-black/40">{t.stuck.empty}</Card>
              ) : (
                <div className="flex flex-col gap-3">
                  {stuck.map((c) => (
                    <StuckCandidateRow key={c.id} candidate={c} canPurge={isSuperAdmin} theme={theme} />
                  ))}
                </div>
              )}
            </section>
            {lapsed.length > 0 && (
              <section>
                <h2 className="mb-1 text-lg font-bold">{t.candidateWindow.lapsedTitle}</h2>
                <p className="mb-4 text-sm text-black/50">{t.candidateWindow.lapsedHint}</p>
                <div className="flex flex-col gap-3">
                  {lapsed.map((m) => (
                    <MemberAccountRow
                      key={m.id}
                      theme={theme}
                      lapsed
                      canPurge={isSuperAdmin}
                      member={{ id: m.id, fullName: m.fullName, email: m.email, departmentName: m.department?.name ?? "—" }}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── المنحّون والمنتهون: سجلٌّ يُقرأ، ولكلّ مُنحّى طريقُ تحريره */}
        {tab === "removed" && (
          <>
            <section>
              <h2 className="mb-3 text-lg font-bold">{t.seats.removedTitle}</h2>
              {removedUsers.length === 0 ? (
                <Card className="p-8 text-center text-sm text-black/40">{L.noRemovedLeadershipAccounts}</Card>
              ) : (
                <div className="flex flex-col gap-3">
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
              )}
            </section>
            <section>
              <h2 className="text-lg font-bold">{tm.inactiveTitle} ({registerInactive.length})</h2>
              <p className="mb-3 mt-1 text-xs text-black/40">{tm.inactiveHint}</p>
              <DataTable emptyLabel={tm.inactiveEmpty} columns={registerColumns} rows={registerRows(registerInactive)} />
            </section>
          </>
        )}
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
