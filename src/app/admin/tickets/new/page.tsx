import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { TICKET_STAGE_DAYS } from "@/lib/tickets";
import { accountRoleLabel } from "@/lib/testTracks";
import { AppHeader } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { PageHeader } from "@/components/PageHeader";
import { TicketComposer } from "@/components/tickets/TicketComposer";
import { adminTicketTargets } from "@/components/tickets/targets";
import { raiseAdminTicketAction } from "../actions";
import { getLocale, getDictionary } from "@/i18n/server";

/** رفعُ تذكرة — للحسابات الإدارية. الإجراءُ نفسُه الذي كانت تستعمله
 *  نماذجُ اللوحات، بصلاحيته وتحقّقه، في صفحةٍ له وحده. */
export default async function NewAdminTicketPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const allowed = ["super_admin", "executive", "operations_officer", "department_admin"];
  if (!allowed.includes(session.user.role)) redirect("/admin");

  const dict = getDictionary(await getLocale());
  const tt = dict.ticketsPage;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const targets = await adminTicketTargets(
    { id: session.user.id, role: session.user.role },
    { departments: tt.groupDepartments, leadership: tt.groupLeadership, members: tt.groupMembers },
    accountRoleLabel
  );

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName={dict.shell.roles[session.user.role]} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={dict.composer.pageTitle} description={dict.composer.pageDesc} />
        <TicketComposer
          action={raiseAdminTicketAction}
          targets={targets}
          allowLink
          mineHref="/admin/tickets"
          stageDays={TICKET_STAGE_DAYS}
        />
      </main>
    </div>
  );
}
