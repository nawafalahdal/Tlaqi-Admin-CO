import Link from "next/link";
import { LogoLockup } from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { getLocale, getDictionary } from "@/i18n/server";

/** الروابط القديمة لم تعد تفتح اختباراً: صار لكل مرشّح حساب ببريد وكلمة مرور
 *  مؤقتة منذ لحظة إنشائه، والاختبار داخل حسابه. تبقى هذه الصفحة لئلا تُرجع
 *  الروابط المُرسَلة سابقاً خطأ 404، وتدل صاحبها على الطريق الصحيح. */
export default async function LegacyInvitePage() {
  const t = getDictionary(await getLocale());

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: BRAND.temptress }}
    >
      <LogoLockup size={24} color={BRAND.beige} dotColor={BRAND.mahogany} />
      <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <h1 className="mb-3 text-lg font-bold">{t.legacyInvite.title}</h1>
        <p className="mb-6 text-sm leading-relaxed text-black/60">{t.legacyInvite.body}</p>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold"
          style={{ background: BRAND.temptress, color: BRAND.beige }}
        >
          {t.legacyInvite.goToLogin}
        </Link>
      </div>
    </main>
  );
}
