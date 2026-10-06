import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { DataTable } from "@/components/DataTable";
import { AccountStageBadge } from "@/components/AccountStageBadge";
import {
  ExecutiveInviteForm,
  DeptAdminInviteForm,
  OperationsOfficerInviteForm,
} from "../LeadershipInviteForms";
import { formatDate } from "@/lib/format";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function AdminInvitesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") {
    redirect("/admin");
  }

  const isSuperAdmin = session.user.role === "super_admin";

  const [departments, invites] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.invite.findMany({
      include: { department: true, member: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const dict = getDictionary(await getLocale());
  const t = dict.invitesPage;
  const ta = dict.admin;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? ta.founderRole : ta.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton fallbackHref="/admin" />
          <h1 className="text-lg font-bold sm:text-xl">{t.title}</h1>
          <p className="mt-1 text-sm text-black/50">
            {t.subtitle}
          </p>
        </div>

        {isSuperAdmin && (
          <section>
            <h2 className="mb-1 text-base font-bold sm:text-lg">{ta.createExecTitle}</h2>
            <p className="mb-3 text-sm text-black/50">
              {ta.createExecSubtitle}
            </p>
            <Card className="p-4 sm:p-6">
              <ExecutiveInviteForm />
            </Card>
          </section>
        )}

        <section>
          <h2 className="mb-1 text-base font-bold sm:text-lg">{t.createOpsTitle}</h2>
          <p className="mb-3 text-sm text-black/50">
            {t.createOpsSubtitle}
          </p>
          <Card className="p-4 sm:p-6">
            <OperationsOfficerInviteForm />
          </Card>
        </section>

        <section>
          <h2 className="mb-1 text-base font-bold sm:text-lg">{ta.createLeadTitle}</h2>
          <p className="mb-3 text-sm text-black/50">
            {ta.createLeadSubtitle}
          </p>
          <Card className="p-4 sm:p-6">
            <DeptAdminInviteForm departments={departments} />
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.issuedTitle}</h2>
          <p className="mb-3 -mt-2 text-xs text-black/40">
            {t.issuedHint}
          </p>
          <DataTable
            emptyLabel={ta.invitesEmpty}
            columns={[
              { key: "name", label: ta.colName, primary: true },
              { key: "track", label: ta.colTrack },
              { key: "status", label: t.colAccountStatus },
              { key: "createdAt", label: ta.colIssuedAt },
              { key: "firstLogin", label: t.colFirstLogin },
            ]}
            rows={invites.map((inv) => ({
              id: inv.id,
              cells: {
                name: inv.fullName,
                track: `${dict.roles[inv.targetRole]}${inv.department ? ` — ${inv.department.name}` : ""}`,
                status: (
                  <AccountStageBadge
                    approvalStatus={inv.member?.approvalStatus ?? null}
                    testStatus={inv.member?.testStatus ?? null}
                  />
                ),
                createdAt: formatDate(inv.createdAt),
                firstLogin: inv.member?.firstLoginAt ? (
                  formatDate(inv.member.firstLoginAt)
                ) : (
                  <span className="text-xs font-semibold text-amber-700">{t.notSignedInYet}</span>
                ),
              },
            }))}
          />
        </section>
      </main>
    </div>
  );
}
