import Link from "next/link";
import { ThemedLockup } from "@/components/Logo";
import { getLocale, getDictionary } from "@/i18n/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup } from "@/components/ControlGroup";

/** الروابط القديمة لم تعد تفتح اختباراً: صار لكل مرشّح حساب ببريد وكلمة مرور
 *  مؤقتة منذ لحظة إنشائه، والاختبار داخل حسابه. تبقى هذه الصفحة لئلا تُرجع
 *  الروابط المُرسَلة سابقاً خطأ 404، وتدل صاحبها على الطريق الصحيح. */
export default async function LegacyInvitePage() {
  const t = getDictionary(await getLocale());

  return (
    <main
      className="auth-page flex min-h-screen flex-col items-center justify-center gap-6 px-4"
    >
      <div className="flex w-full max-w-md justify-end">
      <ControlGroup color="var(--ink)" label={t.ui.displayTools}>
        <ThemeToggle />
      </ControlGroup>
      </div>
      <ThemedLockup height={32} />
      <div className="w-full max-w-md auth-card rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <h1 className="mb-3 text-lg font-bold">{t.legacyInvite.title}</h1>
        <p className="mb-6 text-sm leading-relaxed text-black/60">{t.legacyInvite.body}</p>
        <Link
          href="/login"
          className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold"
        >
          {t.legacyInvite.goToLogin}
        </Link>
      </div>
    </main>
  );
}
