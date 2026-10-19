import { ThemedLockup } from "@/components/Logo";
import { NavGlyph } from "@/components/icons";
import { LoginForm } from "./LoginForm";
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
    // صفحةُ الدخول بتصميم الأرشيف: أرضيةٌ محايدةٌ بلون السمة، وبطاقةٌ واحدة.
    // كانت أرضيتُها بنفسجيةً ثابتةً لا تتبع السمة — والدخولُ أوّلُ ما يُرى.
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page px-4 py-8 sm:px-6">
      <div aria-hidden className="login-glow login-glow--a" />
      <div aria-hidden className="login-glow login-glow--b" />
      <div className="relative w-full max-w-[448px]">
        <div className="mb-8 flex justify-end">
          <ControlGroup color="var(--ink)">
            <ThemeToggle />
            <ControlDivider />
            <LocaleToggle />
          </ControlGroup>
        </div>
        <div className="mb-8 flex justify-center">
          <ThemedLockup height={34} />
        </div>

        <div className="login-card">
          <p className="login-card__eyebrow">
            <NavGlyph name="lock" /> {t.login.secureAccess}
          </p>
          <h1 className="mb-1 text-2xl font-bold">{t.login.title}</h1>
          <p className="mb-7 text-sm leading-6 text-black/50">{t.login.subtitle}</p>

          {passwordChanged && (
            <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              {t.login.passwordChanged}
            </p>
          )}

          <LoginForm callbackUrl={callbackUrl || "/"} />
        </div>

        <p className="mt-6 text-center text-xs text-black/45">
          {t.login.footer} © {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
