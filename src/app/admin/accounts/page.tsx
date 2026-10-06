import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { AccountRow } from "./AccountRow";
import { MemberAccountRow } from "./MemberAccountRow";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function AccountsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const isSuperAdmin = session.user.role === "super_admin";
  const t = getDictionary(await getLocale());

  const [accounts, members] = await Promise.all([
    prisma.user.findMany({
      where: isSuperAdmin
        ? { role: { in: ["executive", "operations_officer", "department_admin"] } }
        : { role: { in: ["operations_officer", "department_admin"] } },
      include: { department: true },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
    }),
    prisma.member.findMany({
      where: { approvalStatus: "approved", isActive: true },
      include: { department: true },
      orderBy: [{ department: { name: "asc" } }, { fullName: "asc" }],
    }),
  ]);

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

        {accounts.length === 0 ? (
          <Card className="p-8 text-center text-sm text-black/40">{t.accounts.empty}</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                theme={theme}
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
      </main>
    </div>
  );
}
