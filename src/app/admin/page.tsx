import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { isLeadership } from "@/lib/announcements";
import { sweepOverdueRequests, sweepExpiredCandidateAccounts } from "@/lib/workflow";
import { sweepTicketEscalation, ticketAuthor, ticketTargetLabel, TICKET_INCLUDE, openTicketsWhere, canRespondToTicket } from "@/lib/tickets";
import {
  announcementsForSession,
  canPublishAnnouncement,
  announcementPowers,
} from "@/lib/announcements";
import { TicketCard } from "./tickets/TicketCard";
import { themeFromColor, SUPER_ADMIN_THEME, BRAND, brandInk} from "@/lib/brand";
import { AppHeader, Card, StatusBadge } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { DataTable } from "@/components/DataTable";
import { TicketBoard } from "@/components/TicketBoard";
import { ApprovalQueue } from "./ApprovalQueue";
import { SeatConflicts } from "@/components/SeatConflicts";
import { AlertsPanel } from "@/components/AlertsPanel";
import { alertsForUser } from "@/lib/alerts";
import { AnnouncementComposer } from "./hub/AnnouncementComposer";
import { AnnouncementList } from "./hub/AnnouncementList";
import { RaiseAdminTicketForm, type TicketTargetOption } from "./tickets/RaiseAdminTicketForm";
import { accountRoleLabel } from "@/lib/testTracks";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function AdminPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (session.user.role === "department_admin" && session.user.departmentSlug) {
    redirect(`/admin/departments/${session.user.departmentSlug}`);
  }
  if (session.user.role === "operations_officer") redirect("/admin/operations");
  if (session.user.role === "member") redirect("/member");

  const isSuperAdmin = session.user.role === "super_admin";

  await sweepOverdueRequests();
  await sweepTicketEscalation();
  await sweepExpiredCandidateAccounts();

  const [departments, leadershipQueue, memberQueue, requests, escalatedTickets, announcements] =
    await Promise.all([
      prisma.department.findMany({ where: OPEN_DEPARTMENT_WHERE, orderBy: { name: "asc" } }),
      prisma.member.findMany({
        where: {
          approvalStatus: "pending_review",
          testStatus: "passed",
          invite: { targetRole: { in: ["department_admin", "operations_officer", "executive"] } },
        },
        include: { department: true, invite: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.member.findMany({
        where: {
          approvalStatus: "pending_review",
          testStatus: "passed",
          invite: { targetRole: "member" },
        },
        include: { department: true, invite: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.request.findMany({
        include: { targetDepartment: true, linkedMember: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.ticket.findMany({
        where: {
          status: { in: ["open", "in_progress"] },
          // الفاوندر يرى ما بلغ مرحلته هو؛ التنفيذي يرى ما بلغ مرحلته
          stage: isSuperAdmin ? "founder_escalation" : "ceo_escalation",
        },
        include: TICKET_INCLUDE,
        orderBy: { createdAt: "desc" },
      }),
      announcementsForSession(session, 8),
    ]);

  const boardTickets = await prisma.ticket.findMany({
    where: openTicketsWhere(session),
    include: TICKET_INCLUDE,
    orderBy: { stageDueAt: "asc" },
  });

  const dict = getDictionary(await getLocale());
  const t = dict.hub;
  const ti = dict.invitesPage;
  const ta = dict.admin;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const canPublish = canPublishAnnouncement(session.user.role);
  // نفس الدالة التي تفرض الصلاحية في الخادم تُغذّي النموذج، فلا يظهر
  // خيارٌ يُرفض عند الإرسال
  const annPowers = announcementPowers(session);
  const deptOptions = departments.map((d) => ({ id: d.id, name: d.name }));

  const pendingCount = leadershipQueue.length + memberQueue.length;
  const openRequests = requests.filter((r) => r.status !== "done").length;

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
    // القسم الاستثنائي لا يُوجَّه إليه إلا من الإدارة العليا: أعضاؤه
    // جهات تواصل تتبعها، لا قسمٌ يُراسَل من كل أحد
    ...departments
      .filter((d) => !d.leadershipOnly || isLeadership(session.user.role))
      .map((d) => ({
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

  // عددُ ما ينتظر اعتماد هذا الشخص — يُقال على الرابط نفسه، فالطلب
  // المعلَّق لا يُكتشَف بالتجوال في الصفحات
  const awaitingApprovals = await prisma.ticket.count({
    where: { approverUserId: session.user.id, approvalState: { in: ["awaiting", "reviewing"] } },
  });

  const alerts = await alertsForUser(session);

  const quickLinks = [
    // الهيكل أولاً: هو خريطة المنظمة، ويراه الجميع
    {
      href: "/structure",
      title: "الهيكل التنظيمي",
      desc: "المؤسس والإدارة العليا وقادة الأقسام والأعضاء — يُبنى وحده من بيانات المنصة، وللعرض فقط",
    },
    {
      href: "/plans",
      title: "خطط تَـــلاقِ ووثائقها",
      desc: "نبذةُ المنصة وخطّتُها وأهدافُها وأهمُّ ملفّاتها — يقرؤها الجميع، ويرفعها المؤسس والتنفيذي",
    },
    { href: "/admin/profile", title: dict.adminProfile.title, desc: dict.adminProfile.subtitle },
    ...(isSuperAdmin || session.user.role === "executive"
      ? [{ href: "/admin/departments", title: dict.deptAdmin.title, desc: dict.deptAdmin.subtitle }]
      : []),
    {
      href: "/admin/invites",
      title: ti.quickInvites,
      desc: ti.quickInvitesHint,
    },
    // صفحةٌ واحدة للشخص وموقعه وقسمه: ضُمّ إليها سجلّ الأعضاء، فلا
    // يُقرأ الشخص من شاشتين ولا يُدخَل مرتين
    {
      href: "/admin/people",
      title: "إدارة الأعضاء والهيكل التنظيمي",
      desc: "الحسابات القيادية وحسابات الأعضاء والتصنيف والسجلّ الكامل — وربطٌ بالهيكل",
    },
    // طلبات الإنهاء والتوقيعات: يراها من يقرّر فيها لا كلّ إداري
    {
      href: "/admin/terminations",
      title: "طلبات إنهاء فترة الإدارة",
      desc: "يرفعها أصحابها — وأمامك الموافقة أو الرفض أو طلب لقاء",
    },
    {
      href: "/admin/approvals",
      title:
        awaitingApprovals > 0
          ? `الاعتمادات الإدارية (${awaitingApprovals} بانتظارك)`
          : "الاعتمادات الإدارية",
      desc: "ما لا يبدأ تنفيذه إلا بموافقة مسؤولٍ أعلى — خطةٌ أو ميزانيةٌ أو مبادرة",
    },
    {
      href: "/admin/signature",
      title: "توقيعات الشهادات",
      desc: "توقيعك، والتوقيعات التي تنتظر اعتمادك",
    },
    ...(isSuperAdmin
      ? [
          {
            href: "/admin/tests/executive",
            title: ta.execTestTitle,
            desc: ta.execTestHint,
          },
        ]
      : []),
    // بنكا أسئلة قادة الأقسام ومسؤول التشغيل يملكهما المدير التنفيذي
    // وحده — هو من يقود هاتين الطبقتين ويُحاسَب على اختيارهما. ولا تُعرض
    // للمؤسس حتى كرابط: صفحةٌ تُحجب ورابطٌ يبقى ظاهراً وعدٌ كاذب.
    ...(isSuperAdmin
      ? []
      : [
          {
            href: "/admin/tests/leads",
            title: ta.leadTestTitle,
            desc: ta.leadTestHint,
          },
          {
            href: "/admin/tests/operations",
            title: ti.opsTestTitle,
            desc: ti.opsTestHint,
          },
        ]),
  ];

  // التقارير في السجلات لا في الإجراءات: قراءةٌ ومراجعة. ويراها من يملك
  // قراءتها — التنفيذي ملخّصَ القادة، وقائدُ القسم أعضاءه هو.
  // السجلات مفصولة عن الإدارة: هذه صفحات قراءة ومراجعة، وتلك صفحات إجراء.
  // خلطُهما هو ما جعل كل شيء يبدو مكدّساً في مكان واحد.
  const recordLinks = [
    {
      href: "/admin/reports",
      title: "التقارير",
      desc: isSuperAdmin || session.user.role === "executive"
        ? "ملخّص الأقسام وقادتها، والتذاكر التي أُغلقت في موعدها"
        : "ملخّص أعضاء قسمك، والتذاكر التي أُغلقت في موعدها",
    },
    { href: "/admin/tickets", title: dict.ticketsPage.title, desc: dict.ticketsPage.subtitle },
    { href: "/admin/messages", title: dict.messagesPage.title, desc: dict.messagesPage.subtitle },
    ...(isSuperAdmin
      ? [{ href: "/admin/sheet", title: dict.sheetPage.title, desc: dict.sheetPage.subtitle }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? ta.founderRole : ta.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-5 sm:py-8">
        {/* **ما ينتظرك أولاً.** كان هنا شريطٌ واحدٌ لنقص البيانات وحده،
            وبقي ما سواه مبعثراً في الصفحات: توقيعٌ مطلوب، واعتمادٌ ينتظر،
            وتحقّقٌ ثنائيٌّ غيرُ مُفعَّل، وتذكرةٌ تأخّرت. فجُمع كلُّه في
            لوحةٍ واحدةٍ لكلٍّ سطرُه ووجهتُه — وترتفع كلُّها عند السلامة. */}
        <AlertsPanel alerts={alerts} />

        {/* التذاكر أولاً: هي قناة العمل، فمكانها صدر اللوحة */}
        <TicketBoard tickets={boardTickets} theme={theme} viewerId={session.user.id} />

        {/* نبض التشغيل */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t.statEscalated} value={escalatedTickets.length} theme={theme} />
          <StatTile label={t.statPending} value={pendingCount} theme={theme} />
          <StatTile label={t.statOpenRequests} value={openRequests} theme={theme} />
          <StatTile label={t.statDepartments} value={departments.length} theme={theme} />
        </section>

        {/* الإعلانات */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold sm:text-lg">{t.announcementsTitle}</h2>
              <p className="text-xs text-black/40">
                {t.announcementsHint}
              </p>
            </div>
            {canPublish && <AnnouncementComposer departments={deptOptions} theme={theme} powers={annPowers} />}
          </div>
          <AnnouncementList
            viewerId={session.user.id}
            viewerIsFounder={isSuperAdmin}
            announcements={announcements.map((a) => ({
              id: a.id,
              title: a.title,
              body: a.body,
              audience: a.audience,
              departmentName: a.department?.name ?? null,
              authorId: a.authorId,
              authorName: a.authorName,
              createdAt: a.createdAt.toISOString(),
              meetingUrl: a.meetingUrl,
              linkUrl: a.linkUrl,
              linkLabel: a.linkLabel,
            }))}
          />
        </section>

        {/* التذاكر المصعّدة */}
        <section>
          <h2 className="text-base font-bold sm:text-lg">
            {ta.escalatedTicketsTitle} ({escalatedTickets.length})
          </h2>
          <p className="mb-3 mt-1 text-xs text-black/40">
            {ta.escalatedTicketsHint}
          </p>
          {escalatedTickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">
              {ta.escalatedTicketsEmpty}
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {escalatedTickets.map((t) => (
                <TicketCard
                  key={t.id}
                  theme={theme}
                  ticket={{
                    id: t.id,
                    ticketNumber: t.ticketNumber,
                    subject: t.subject,
                    description: t.description,
                    status: t.status,
                    stage: t.stage,
                    stageDueAt: t.stageDueAt.toISOString(),
                    resolutionNote: t.resolutionNote,
                    linkUrl: t.linkUrl,
                    memberName: ticketAuthor(t).name,
                    targetDepartmentName: ticketTargetLabel(t),
                  }}
                  // **هذا كان العطب:** البطاقة هنا كانت بلا حارس، فيظهر
                  // زرّ الردّ على كل تذكرةٍ بلغت مرحلة الفاوندر — ومنها
                  // تذاكرُه هو. فيضغط، فيرفض الخادم بحقّ، فتنهار الصفحة.
                  // والحارس هو نفسه الذي يفرضه الخادم، فلا يُعرض إجراءٌ
                  // يُرفَض.
                  readOnly={!canRespondToTicket(t, session)}
                  mine={t.raisedByUserId === session.user.id}
                />
              ))}
            </div>
          )}
        </section>

        {/* الطلبات بين الأقسام */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold sm:text-lg">{t.requestsTitle}</h2>
              <p className="text-xs text-black/40">
                {t.requestsHint}
              </p>
            </div>
            {canPublish && <RaiseAdminTicketForm targets={ticketTargets} theme={theme} />}
          </div>
          <DataTable
            emptyLabel={ta.requestsEmpty}
            columns={[
              { key: "type", label: ta.colType, primary: true },
              { key: "dept", label: ta.colTargetDept },
              { key: "member", label: ta.colRelatedTo },
              { key: "status", label: ta.colStatus },
              { key: "due", label: ta.colDeadline },
            ]}
            rows={requests.map((r) => ({
              id: r.id,
              cells: {
                type: dict.requestType[r.type],
                dept: (
                  <span className="inline-flex items-center gap-1.5 text-black/70">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: r.targetDepartment.colorHex }}
                    />
                    {r.targetDepartment.name}
                  </span>
                ),
                member: r.linkedMember?.fullName ?? "—",
                status: <StatusBadge status={r.status} />,
                due: r.dueDate ? formatDate(r.dueDate) : "—",
              },
            }))}
          />
        </section>

        {/* تعارض المقاعد: للمؤسس وحده، ولا يظهر إن لم يكن تعارض.
            القاعدة مكتوبة والحرس يمنع الجديد — وهذا يُظهر ما سبقهما. */}
        {isSuperAdmin && (
          <section>
            <SeatConflicts canPurge={isSuperAdmin} />
          </section>
        )}

        {/* الاعتمادات */}
        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{ta.leadershipQueueTitle}</h2>
          <ApprovalQueue
            emptyMessage={ta.leadershipQueueEmpty}
            members={leadershipQueue.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              testScore: m.testScore,
              departmentName: m.department?.name ?? dict.roles[m.invite.targetRole],
              departmentColor: m.department?.colorHex ?? BRAND.temptress,
            }))}
          />
        </section>

        <section>
          <h2 className="text-base font-bold sm:text-lg">
            {ta.memberQueueTitle}
          </h2>
          <p className="mb-3 mt-1 text-xs text-black/40">
            {ta.memberQueueHint}
          </p>
          <ApprovalQueue
            emptyMessage={ta.memberQueueEmpty}
            members={memberQueue.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              testScore: m.testScore,
              departmentName: m.department?.name ?? "—",
              departmentColor: m.department?.colorHex ?? BRAND.temptress,
            }))}
          />
        </section>

        {/* السجلات — لكل سجل صفحته، بدل تكديس كل شيء في مكان واحد */}
        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.recordsSectionTitle}</h2>
          <LinkGrid links={recordLinks} accent={theme.accentDark} />
        </section>

        {/* الإدارة — روابط الإجراءات */}
        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.adminSectionTitle}</h2>
          <LinkGrid links={quickLinks} accent={theme.accentDark} />
        </section>
      </main>
    </div>
  );
}

function LinkGrid({
  links,
  accent,
}: {
  links: { href: string; title: string; desc: string }[];
  accent: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="block">
          <Card className="flex min-h-16 items-center justify-between gap-3 p-4 transition-shadow hover:shadow-md">
            <div className="min-w-0">
              <h3 className="text-sm font-bold">{l.title}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-black/40">{l.desc}</p>
            </div>
            {/* سهم منطقي: يُعكس تلقائياً في LTR بدل تثبيت اتجاه عربي */}
            <span
              className="shrink-0 text-lg font-bold ltr:-scale-x-100"
              style={{ color: accent }}
              aria-hidden
            >
              ←
            </span>
          </Card>
        </Link>
      ))}
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
