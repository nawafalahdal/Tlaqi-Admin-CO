import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ThemedLockup } from "@/components/Logo";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { BackButton } from "@/components/BackButton";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup, ControlDivider } from "@/components/ControlGroup";
import { getLocale, getDictionary } from "@/i18n/server";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";

const ROLE_HOME: Record<string, string> = {
  super_admin: "/admin",
  executive: "/admin",
  operations_officer: "/admin/operations",
  member: "/member",
};

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const forced = session.user.mustChangePassword;
  const fallbackHref =
    session.user.role === "department_admin" && session.user.departmentSlug
      ? `/admin/departments/${session.user.departmentSlug}`
      : (ROLE_HOME[session.user.role] ?? "/admin");
  const t = getDictionary(await getLocale());

  // داخل مساحة العمل: رأسُ الصفحة الموحّد والبطاقةُ نفسها — والإجباريُّ
  // يبقى في صفحة الدخول المنفردة أدناه
  if (!forced) {
    return (
      <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title={t.changePassword.titleNormal}
          description={t.changePassword.subtitleNormal}
          back={<BackButton fallbackHref={fallbackHref} />}
        />
        <Card className="p-5 sm:p-6">
          <ChangePasswordForm forced={false} />
        </Card>
      </main>
      </div>
    );
  }

  return (
    <main
      className="auth-page flex min-h-screen items-center justify-center px-4"
    >
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
      <ControlGroup color="var(--ink)" label={t.ui.displayTools}>
        <ThemeToggle />
        <ControlDivider />
        <LocaleToggle />
      </ControlGroup>
        </div>
        <div className="mb-8 flex justify-center">
          <ThemedLockup height={34} />
        </div>

        <div className="auth-card rounded-3xl bg-white p-8 shadow-xl">
          {!forced && <BackButton fallbackHref={fallbackHref} />}
          <h1 className="mb-1 text-lg font-bold text-black/90">
            {forced ? t.changePassword.titleForced : t.changePassword.titleNormal}
          </h1>
          <p className="mb-6 text-sm text-black/50">
            {forced ? t.changePassword.subtitleForced : t.changePassword.subtitleNormal}
          </p>
          <ChangePasswordForm forced={forced} />
        </div>
      </div>
    </main>
  );
}
