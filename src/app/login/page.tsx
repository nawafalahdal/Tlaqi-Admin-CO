import { LogoLockup } from "@/components/Logo";
import { LoginForm } from "./LoginForm";
import { BRAND } from "@/lib/brand";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; passwordChanged?: string }>;
}) {
  const { callbackUrl, passwordChanged } = await searchParams;

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
          <h1 className="mb-1 text-lg font-bold text-black/90">تسجيل الدخول</h1>
          <p className="mb-6 text-sm text-black/50">
            للإدارة العليا، التنفيذي، قادة الأقسام، والأعضاء المعتمدين
          </p>

          {passwordChanged && (
            <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              تم تغيير كلمة المرور بنجاح، سجّل دخولك بها الآن
            </p>
          )}

          <LoginForm callbackUrl={callbackUrl || "/"} />
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: BRAND.beige, opacity: 0.6 }}>
          منصة تلاقي الداخلية © {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
