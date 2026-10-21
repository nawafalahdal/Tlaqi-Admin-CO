import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TICKET_STAGE_DAYS } from "@/lib/tickets";
import { PageHeader } from "@/components/PageHeader";
import { TicketComposer } from "@/components/tickets/TicketComposer";
import { memberTicketTargets } from "@/components/tickets/targets";
import { raiseTicketAction } from "../../actions";
import { getLocale, getDictionary } from "@/i18n/server";

/** رفعُ تذكرة — للعضو المعتمد. إجراءُ بوابته نفسُه، والحارسُ حارسُها:
 *  لا تذكرةَ قبل الاعتماد، ولا لحسابٍ مُنهى. */
export default async function NewMemberTicketPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "member") redirect("/admin");

  const member = await prisma.member.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { department: true },
  });
  if (member.approvalStatus !== "approved") {
    redirect(member.testStatus === "not_started" ? "/member/test" : "/member/pending");
  }
  if (!member.isActive) redirect("/member");

  const t = getDictionary(await getLocale());
  const tt = t.ticketsPage;
  const targets = await memberTicketTargets(
    { id: member.id, departmentId: member.departmentId },
    { departments: tt.groupDepartments, leadership: tt.groupLeadership, members: tt.groupMembers },
    (role) => t.roles[role as keyof typeof t.roles] ?? role
  );

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={t.composer.pageTitle} description={t.composer.pageDesc} />
        <TicketComposer
          action={raiseTicketAction}
          targets={targets}
          allowLink={false}
          mineHref="/member#my-tickets"
          stageDays={TICKET_STAGE_DAYS}
        />
      </main>
    </div>
  );
}
