import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, BRAND } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { LogoLockup } from "@/components/Logo";
import { WarningCard } from "./WarningCard";
import { MyTicketCard } from "./MyTicketCard";
import { RaiseTicketForm } from "./RaiseTicketForm";
import { sweepTicketEscalation } from "@/lib/tickets";
import { getLocale, getDictionary } from "@/i18n/server";
import { announcementsForSession } from "@/lib/announcements";
import { AnnouncementList } from "@/app/admin/hub/AnnouncementList";

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

  await sweepTicketEscalation();

  if (!member.isActive) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4" style={{ background: BRAND.temptress }}>
        <LogoLockup size={24} color={BRAND.beige} dotColor={BRAND.mahogany} />
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <h1 className="mb-2 text-lg font-bold text-red-700">{t.member.deactivatedTitle}</h1>
          <p className="text-sm text-black/60">{t.member.deactivatedBody}</p>
        </div>
      </main>
    );
  }

  const unacknowledged = member.warnings.filter((w) => !w.acknowledgedAt).length;

  const [departments, tickets, announcements] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.ticket.findMany({ where: { memberId: member.id }, orderBy: { createdAt: "desc" } }),
    announcementsForSession(session, 6),
  ]);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={member.department?.name ?? t.member.roleFallback} userName={member.fullName}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6 sm:px-5 sm:py-8">
        <section>
          <Card className="p-4 sm:p-6">
            <p className="text-xs text-black/40">{t.member.memberOf}</p>
            <p className="text-lg font-bold">{member.department?.name ?? t.member.departmentFallback}</p>
            {member.jobTitle && <p className="text-sm text-black/50">{member.jobTitle}</p>}
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.hub.announcementsTitle}</h2>
          <AnnouncementList
            canDelete={false}
            announcements={announcements.map((a) => ({
              id: a.id,
              title: a.title,
              body: a.body,
              audience: a.audience,
              departmentName: a.department?.name ?? null,
              authorName: a.authorName,
              createdAt: a.createdAt.toISOString(),
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

        <section>
          <h2 className="mb-4 text-lg font-bold">{t.member.raiseTicketTitle}</h2>
          <p className="mb-4 -mt-3 text-xs text-black/40">{t.member.raiseTicketHint}</p>
          <Card className="p-6">
            <RaiseTicketForm departments={departments} theme={theme} />
          </Card>
        </section>

        <section>
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
