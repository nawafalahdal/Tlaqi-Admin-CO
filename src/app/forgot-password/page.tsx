import Link from "next/link";
import { LogoLockup } from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { LocaleToggle } from "@/components/LocaleToggle";
import { getLocale, getDictionary } from "@/i18n/server";
import { ForgotForm } from "./ForgotForm";

export default async function ForgotPasswordPage() {
  const t = getDictionary(await getLocale());

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ background: BRAND.temptress }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LocaleToggle color={BRAND.beige} />
        </div>
        <div className="mb-8 flex justify-center">
          <LogoLockup size={26} color={BRAND.beige} dotColor={BRAND.mahogany} />
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
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
