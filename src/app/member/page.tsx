import { redirect } from "next/navigation";
import { avatarUrl } from "@/lib/avatarUrl";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, BRAND } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { ThemedLockup } from "@/components/Logo";
import { WarningCard } from "./WarningCard";
import { MyTicketCard } from "./MyTicketCard";
import { WelcomeMailCard } from "@/components/WelcomeMailCard";
import { SecurityGuidance } from "@/components/SecurityGuidance";
import { AvatarUpload } from "@/components/AvatarUpload";
import { AlertsPanel } from "@/components/AlertsPanel";
import { alertsForMember } from "@/lib/alerts";
import { MyTasks } from "@/components/execution/MyTasks";
import { myTasks } from "@/lib/executionViews";
import { GovernanceCharter } from "@/components/GovernanceCharter";
import { TerminationRequestCard } from "@/components/TerminationRequestCard";
import { openRequestFor } from "@/lib/termination";
import { formatDate } from "@/lib/format";
import { TicketCta } from "@/components/tickets/TicketCta";
import { sweepTicketEscalation, ticketVisibilityWhere, TICKET_LIST_TAKE } from "@/lib/tickets";
import { getLocale, getDictionary } from "@/i18n/server";
import { announcementsForSession } from "@/lib/announcements";
import { AnnouncementList } from "@/app/admin/hub/AnnouncementList";
import { scheduleDueSweeps } from "@/lib/sweepThrottle";
import { WorkspaceOverview } from "@/components/dashboard/WorkspaceOverview";
import { avatarHasTransparency } from "@/lib/avatars";

export default async function MemberPortalPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "member") redirect("/admin");

  const member = await prisma.member.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { department: true, warnings: { orderBy: { createdAt: "desc" } } },
  });

  // حارس المرحلة من قاعدة البيانات: المرشّح يملك حساباً حقيقياً منذ إنشائه،
  // فلا تفتح له البوابة قبل اجتياز الاختبار والاعتماد
  if (member.approvalStatus !== "approved") {
    redirect(member.testStatus === "not_started" ? "/member/test" : "/member/pending");
  }

  const theme = themeFromColor(member.department?.colorHex ?? BRAND.temptress);
  const t = getDictionary(await getLocale());

  scheduleDueSweeps({ ticket_escalation: () => sweepTicketEscalation() });
  const openTermination = await openRequestFor(session.user.id);

  if (!member.isActive) {
    return (
      <main className="auth-page flex min-h-screen flex-col items-center justify-center gap-6 px-4">
        <ThemedLockup height={32} />
        <div className="w-full max-w-md auth-card rounded-3xl bg-white p-8 text-center shadow-xl">
          <h1 className="mb-2 text-lg font-bold text-red-700">{t.member.deactivatedTitle}</h1>
          <p className="text-sm text-black/60">{t.member.deactivatedBody}</p>
        </div>
      </main>
    );
  }

  const unacknowledged = member.warnings.filter((w) => !w.acknowledgedAt).length;

  // وجهاتُ التذكرة صارت لصفحة الرفع (`/member/tickets/new`)
  const [tickets, announcements] = await Promise.all([
    // تذاكره: ما رفعه، وما وُجِّه إليه باسمه، وما وُجِّه إلى قسمه.
    // الأخير كان ناقصاً: مسار العمل اليومي (محتوى ← تصميم ← نشر) يُوجَّه
    // إلى القسم لا إلى شخصٍ بعينه، فكانت تذاكر القسم لا يراها أحد من
    // أعضائه — تُرفع فتقف عند قائده وحده.
    prisma.ticket.findMany({
      where: ticketVisibilityWhere(session),
      orderBy: { createdAt: "desc" },
      take: TICKET_LIST_TAKE,
    }),
    announcementsForSession(session, 6),
  ]);

  const tasks = await myTasks({ memberId: member.id });

  const alerts = await alertsForMember({
    memberId: member.id,
    mustChangePassword: member.mustChangePassword,
    profileCompletedAt: member.profileCompletedAt,
    avatarVersion: member.avatarVersion,
    phone: member.phone,
    unacknowledgedWarnings: unacknowledged,
  });


  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName={member.department?.name ?? t.member.roleFallback}
        userName={member.fullName}
        homeHref="/member"
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6 sm:px-5 sm:py-8">
        <WorkspaceOverview
          session={session}
          lead={
            <TicketCta
              href="/member/tickets/new"
              title={t.composer.homeCtaTitle}
              body={t.composer.homeCtaBody}
              cta={t.composer.cta}
            />
          }
        />

        {/* ما ينتظره أوّلاً — ولا يُقرأ بالتجوال في الصفحات */}
        <AlertsPanel alerts={alerts} />

        {/* ما عليه هذا الأسبوع — بمعاييره وأدلّته */}
        <MyTasks tasks={tasks} theme={theme} />
        <section>
          <Card className="p-4 sm:p-6">
            <p className="text-xs text-black/40">{t.member.memberOf}</p>
            <p className="text-lg font-bold">{member.department?.name ?? t.member.departmentFallback}</p>
            {member.jobTitle && <p className="text-sm text-black/50">{member.jobTitle}</p>}
          </Card>
        </section>

        {/* البريد الترحيبي وشروط الحماية للجميع — العضو كالقائد في هذا */}
        <section className="flex flex-col gap-4">
          {/* صورته في الهيكل — للأعضاء كما للقادة */}
          <AvatarUpload
            current={avatarUrl("member", member.id, member.avatarVersion)}
            theme={theme}
            opaque={(await avatarHasTransparency(member.avatarData)) === false}
          />
          <WelcomeMailCard
            theme={theme}
            sentAt={member.welcomeEmailSentAt ? formatDate(member.welcomeEmailSentAt) : null}
          />
          <SecurityGuidance theme={theme} totpEnabled={null} />
          <TerminationRequestCard
            theme={theme}
            open={
              openTermination
                ? {
                    id: openTermination.id,
                    status: openTermination.status,
                    reason: openTermination.reason,
                    assignmentLabel: openTermination.assignmentLabel,
                    submittedAt: formatDate(openTermination.submittedAt),
                    requestedEndDate: openTermination.requestedEndDate
                      ? formatDate(openTermination.requestedEndDate)
                      : null,
                    decisionNote: openTermination.decisionNote,
                    meetingNote: openTermination.meetingNote,
                  }
                : null
            }
          />

          <GovernanceCharter theme={theme} />
        </section>

        <section id="announcements" className="scroll-mt-24">
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.hub.announcementsTitle}</h2>
          <AnnouncementList
            viewerId={null}
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

        <section>
          <h2 className="mb-4 text-lg font-bold">
            {t.member.warningsTitle}{" "}
            {unacknowledged > 0 && (
              <span className="text-sm font-normal text-black/40">
                ({unacknowledged} {t.member.warningsPending})
              </span>
            )}
          </h2>
          {member.warnings.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{t.member.warningsEmpty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {member.warnings.map((w) => (
                <WarningCard
                  key={w.id}
                  theme={theme}
                  warning={{
                    id: w.id,
                    reason: w.reason,
                    createdAt: w.createdAt.toISOString(),
                    acknowledgedAt: w.acknowledgedAt ? w.acknowledgedAt.toISOString() : null,
                  }}
                />
              ))}
            </div>
          )}
        </section>


        <section id="my-tickets">
          <h2 className="mb-4 text-lg font-bold">
            {t.member.myTicketsTitle} {tickets.length > 0 && `(${tickets.length})`}
          </h2>
          {tickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">{t.member.myTicketsEmpty}</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {tickets.map((tk) => (
                <MyTicketCard
                  key={tk.id}
                  theme={theme}
                  ticket={{
                    id: tk.id,
                    ticketNumber: tk.ticketNumber,
                    subject: tk.subject,
                    description: tk.description,
                    status: tk.status,
                    stage: tk.stage,
                    stageDueAt: tk.stageDueAt.toISOString(),
                    resolutionNote: tk.resolutionNote,
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
