import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LogoLockup } from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { BackButton } from "@/components/BackButton";

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

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: BRAND.temptress }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <LogoLockup size={26} color={BRAND.beige} dotColor={BRAND.mahogany} />
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-xl">
          {!forced && <BackButton fallbackHref={fallbackHref} />}
          <h1 className="mb-1 text-lg font-bold text-black/90">
            {forced ? "غيّر كلمة المرور المؤقتة" : "تغيير كلمة المرور"}
          </h1>
          <p className="mb-6 text-sm text-black/50">
            {forced
              ? "لأمان حسابك، يجب تعيين كلمة مرور جديدة قبل المتابعة."
              : "أدخل كلمة المرور الحالية ثم كلمة المرور الجديدة."}
          </p>
          <ChangePasswordForm forced={forced} />
        </div>
      </div>
    </main>
  );
}
