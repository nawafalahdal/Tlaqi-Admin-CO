import Link from "next/link";
import { LogoLockup } from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { getLocale, getDictionary } from "@/i18n/server";
import { checkResetToken } from "@/lib/passwordReset";
import { ResetForm } from "./ResetForm";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = getDictionary(await getLocale());
  const check = await checkResetToken(token);

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ background: BRAND.temptress }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <LogoLockup size={26} color={BRAND.beige} dotColor={BRAND.mahogany} />
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
          {check.ok ? (
            <>
              <h1 className="mb-1 text-lg font-bold text-black/90">{t.reset.title}</h1>
              <p className="mb-6 text-sm leading-relaxed text-black/50">{t.reset.subtitle}</p>
              <ResetForm token={token} />
            </>
          ) : (
            <div className="text-center">
              <h1 className="mb-2 text-lg font-bold text-red-700">{t.reset.invalidTitle}</h1>
              <p className="text-sm leading-relaxed text-black/60">
                {check.reason === "expired"
                  ? t.reset.invalidExpired
                  : check.reason === "used"
                    ? t.reset.invalidUsed
                    : t.reset.invalidGeneric}
              </p>
              <Link
                href="/forgot-password"
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--brand-temptress)] px-4 text-sm font-semibold text-[var(--brand-beige)]"
              >
                {t.reset.requestNew}
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
