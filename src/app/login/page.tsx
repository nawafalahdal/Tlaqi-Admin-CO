import { LogoLockup } from "@/components/Logo";
import { LoginForm } from "./LoginForm";
import { BRAND } from "@/lib/brand";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup, ControlDivider } from "@/components/ControlGroup";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; passwordChanged?: string }>;
}) {
  const { callbackUrl, passwordChanged } = await searchParams;
  const t = getDictionary(await getLocale());

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6"
      style={{ background: BRAND.temptress }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at 15% 15%, ${BRAND.greenSheen}, transparent 34%), radial-gradient(circle at 90% 85%, ${BRAND.mahogany}, transparent 32%)` }} />
      <div className="relative w-full max-w-md">
        <div className="mb-5 flex justify-end">
      <ControlGroup color={BRAND.beige}>
        <ThemeToggle />
        <ControlDivider />
        <LocaleToggle />
      </ControlGroup>
        </div>
        <div className="mb-8 flex justify-center">
          <LogoLockup height={34} tone="light" />
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-2xl shadow-black/20 sm:p-8">
          <h1 className="mb-1 text-lg font-bold text-black/90">{t.login.title}</h1>
          <p className="mb-6 text-sm text-black/50">{t.login.subtitle}</p>

          {passwordChanged && (
            <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              {t.login.passwordChanged}
            </p>
          )}

          <LoginForm callbackUrl={callbackUrl || "/"} />
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: BRAND.beige, opacity: 0.6 }}>
          {t.login.footer} © {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
