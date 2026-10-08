import { Card } from "@/components/ui";
import { getLocale, getDictionary } from "@/i18n/server";
import type { themeFromColor } from "@/lib/brand";

/** ميثاق الحوكمة — ما يجب أن يجري، وما لا يجوز تجاوزه.
 *
 *  القاعدة التي لا تُكتب لا تُحتَجّ بها: من لا يعرف أن التذكرة لها مهلة
 *  لا يُلام على تأخّره، ومن لا يعرف أن صاحب التذكرة لا يُغلقها يظنّ
 *  المنعَ عطلاً. فتُكتب القواعد في موضع يراه الجميع، بنفس الصيغة التي
 *  تفرضها المنصة فعلاً — فلا ميثاق يَعِد بما لا يُنفَّذ، ولا تنفيذٌ
 *  يفاجئ من لم يقرأ.
 *
 *  والترتيب مقصود: ما يجب أولاً، ثم ما لا يجوز. الأول يُعلِّم، والثاني
 *  يحمي.
 */
export async function GovernanceCharter({
  theme,
  compact = false,
}: {
  theme: ReturnType<typeof themeFromColor>;
  /** على اللوحات المزدحمة يُعرض مختصراً — والتفصيل في صفحة البيانات */
  compact?: boolean;
}) {
  const t = getDictionary(await getLocale()).governance;

  const musts = [t.must1, t.must2, t.must3, t.must4, t.must5];
  const nevers = [t.never1, t.never2, t.never3, t.never4, t.never5];

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-base font-bold">{t.title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/55">{t.intro}</p>

      <h3 className="mt-4 text-sm font-bold text-black/75">{t.mustsTitle}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {musts.map((m) => (
          <li key={m} className="flex items-start gap-2 text-xs leading-relaxed text-black/70">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: theme.accentDark }}
            />
            <span>{m}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-bold text-[#9A2E1C]">{t.neversTitle}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {nevers.map((n) => (
          <li key={n} className="flex items-start gap-2 text-xs leading-relaxed text-black/70">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9A2E1C]"
            />
            <span>{n}</span>
          </li>
        ))}
      </ul>

      {!compact && (
        <p className="mt-4 border-t border-black/5 pt-3 text-xs leading-relaxed text-black/45">
          {t.footnote}
        </p>
      )}
    </Card>
  );
}
