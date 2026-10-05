import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { LogoLockup } from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { SecurityForm } from "./SecurityForm";
import { BackButton } from "@/components/BackButton";

const ROLE_HOME: Record<string, string> = {
  super_admin: "/admin",
  executive: "/admin",
  operations_officer: "/admin/operations",
};

export default async function SecurityPage() {
  const session = await auth();
  if (!session || session.user.role === "member") redirect("/login");

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
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ background: BRAND.temptress }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <LogoLockup size={26} color={BRAND.beige} dotColor={BRAND.mahogany} />
        </div>

        <div className="rounded-3xl bg-white p-8 shadow-xl">
          <BackButton fallbackHref={fallbackHref} />
          <h1 className="mb-1 text-lg font-bold text-black/90">التحقق بخطوتين (2FA)</h1>
          <p className="mb-6 text-sm text-black/50">
            طبقة حماية إضافية لحسابك الإداري عبر تطبيق مصادقة (Google Authenticator، Authy، إلخ).
          </p>
          <SecurityForm initialEnabled={user.totpEnabled} />
        </div>
      </div>
    </main>
  );
}
