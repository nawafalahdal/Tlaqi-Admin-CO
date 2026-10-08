import Link from "next/link";
import { Card } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "@/lib/passwordPolicy";
import { getLocale, getDictionary } from "@/i18n/server";
import type { themeFromColor } from "@/lib/brand";

/** دليل الحماية: شروط كلمة المرور والتحقق الثنائي، مكتوبة قبل الحاجة.
 *
 *  الشرط الذي لا يُعرف إلا لحظة رفضه يبدو تعنّتاً. والتحقق الثنائي الذي
 *  لا يُشرح يبدو عبئاً إضافياً — بينما هو طريق الدخول الثاني حين يتعطّل
 *  البريد أو يتأخّر رمزه. فيُقال الأمران هنا صراحةً. */
export async function SecurityGuidance({
  theme,
  totpEnabled,
}: {
  theme: ReturnType<typeof themeFromColor>;
  /** null للأعضاء: التحقق الثنائي للحسابات الإدارية وحدها، فلا يُعرض
   *  لمن لا يملكه بابٌ لا يستطيع فتحه */
  totpEnabled: boolean | null;
}) {
  const t = getDictionary(await getLocale()).security;

  const rules = [
    t.ruleLength.replace("{n}", String(PASSWORD_MIN_LENGTH)),
    t.ruleUpper,
    t.ruleLower,
    t.ruleDigit,
    t.ruleSymbol,
  ];

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-base font-bold">{t.title}</h2>

      <h3 className="mt-4 text-sm font-bold text-black/75">{t.passwordTitle}</h3>
      <p className="mt-1 text-xs leading-relaxed text-black/55">{t.passwordWhy}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rules.map((r) => (
          <li key={r} className="flex items-start gap-2 text-xs text-black/70">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: theme.accentDark }}
            />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      {totpEnabled !== null && (
        <>
      <h3 className="mt-5 text-sm font-bold text-black/75">{t.totpTitle}</h3>
      <p className="mt-1 text-xs leading-relaxed text-black/55">{t.totpWhy}</p>

      {totpEnabled ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          {t.totpOn}
        </p>
      ) : (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-bold text-amber-900">{t.totpOffTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/85">{t.totpOffBody}</p>
          <Link
            href="/admin/security"
            className="mt-2.5 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-white"
            style={{ background: theme.accentDark }}
          >
            {t.totpEnable}
          </Link>
        </div>
      )}
        </>
      )}
    </Card>
  );
}
