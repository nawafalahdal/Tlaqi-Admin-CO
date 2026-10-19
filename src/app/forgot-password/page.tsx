import Link from "next/link";
import { ThemedLockup } from "@/components/Logo";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup, ControlDivider } from "@/components/ControlGroup";
import { getLocale, getDictionary } from "@/i18n/server";
import { ForgotForm } from "./ForgotForm";

export default async function ForgotPasswordPage() {
  const t = getDictionary(await getLocale());

  return (
    <main
      className="auth-page flex min-h-screen items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
      <ControlGroup color="var(--ink)">
        <ThemeToggle />
        <ControlDivider />
        <LocaleToggle />
      </ControlGroup>
        </div>
        <div className="mb-8 flex justify-center">
          <ThemedLockup height={34} />
        </div>

        <div className="auth-card rounded-3xl bg-white p-6 shadow-xl sm:p-8">
          <h1 className="mb-1 text-lg font-bold text-black/90">{t.forgot.title}</h1>
          <p className="mb-6 text-sm leading-relaxed text-black/50">{t.forgot.subtitle}</p>
          <ForgotForm />
          <Link
            href="/login"
            className="mt-5 block text-center text-sm font-semibold text-black/50 hover:text-black/80"
          >
            {t.forgot.backToLogin}
          </Link>
        </div>
      </div>
    </main>
  );
}
