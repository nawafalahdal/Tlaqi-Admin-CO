import { LogoLockup } from "@/components/Logo";
import { LoginForm } from "./LoginForm";
import { BRAND } from "@/lib/brand";
import { LocaleToggle } from "@/components/LocaleToggle";
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
