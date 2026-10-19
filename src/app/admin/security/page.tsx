import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ThemedLockup } from "@/components/Logo";
import { SecurityForm } from "./SecurityForm";
import { getLocale, getDictionary } from "@/i18n/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup } from "@/components/ControlGroup";

const ROLE_HOME: Record<string, string> = {
  super_admin: "/admin",
  executive: "/admin",
  operations_officer: "/admin/operations",
};

export default async function SecurityPage() {
  const session = await auth();
  if (!session || session.user.role === "member") redirect("/login");

  const t = getDictionary(await getLocale());

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { totpEnabled: true },
  });

  const fallbackHref =
    session.user.role === "department_admin" && session.user.departmentSlug
      ? `/admin/departments/${session.user.departmentSlug}`
      : (ROLE_HOME[session.user.role] ?? "/admin");

  return (
    <main
      className="auth-page flex min-h-screen items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
      <ControlGroup color="var(--ink)">
        <ThemeToggle />
      </ControlGroup>
        </div>
        <div className="mb-8 flex justify-center">
          <ThemedLockup height={34} />
        </div>

        <div className="auth-card rounded-3xl bg-white p-8 shadow-xl">
          <h1 className="mb-1 text-lg font-bold text-black/90">{t.security.title}</h1>
          <p className="mb-6 text-sm text-black/50">
            {t.misc.securityHint}
          </p>
          <SecurityForm initialEnabled={user.totpEnabled} />
        </div>
      </div>
    </main>
  );
}
