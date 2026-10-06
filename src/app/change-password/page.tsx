import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LogoLockup } from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { BackButton } from "@/components/BackButton";
import { LocaleToggle } from "@/components/LocaleToggle";
import { getLocale, getDictionary } from "@/i18n/server";

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

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: BRAND.temptress }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LocaleToggle color={BRAND.beige} />
        </div>
        <div className="mb-8 flex justify-center">
          <LogoLockup size={26} color={BRAND.beige} dotColor={BRAND.mahogany} />
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-xl">
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
