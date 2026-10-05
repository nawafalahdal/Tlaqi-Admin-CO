import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { AccountRow } from "./AccountRow";

export default async function AccountsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const isSuperAdmin = session.user.role === "super_admin";

  const accounts = await prisma.user.findMany({
    where: isSuperAdmin
      ? { role: { in: ["executive", "operations_officer", "department_admin"] } }
      : { role: { in: ["operations_officer", "department_admin"] } },
    include: { department: true },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? "الفاونڈر — الإدارة العليا" : "الإدارة التنفيذية (CEO)"}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="mb-1 text-xl font-bold">إدارة الحسابات القيادية</h1>
        <p className="mb-6 text-sm text-black/50">
          {isSuperAdmin
            ? "كل حسابات قادة الأقسام والإدارة التنفيذية — تقدر تعيد تعيين كلمة المرور أو تعدّل البريد لأي منها عند أي إشكالية."
            : "حسابات قادة الأقسام فقط — تقدر تعيد تعيين كلمة المرور أو تعدّل البريد لأي منها عند أي إشكالية."}
        </p>

        {accounts.length === 0 ? (
          <Card className="p-8 text-center text-sm text-black/40">لا توجد حسابات بعد</Card>
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
      </main>
    </div>
  );
}
