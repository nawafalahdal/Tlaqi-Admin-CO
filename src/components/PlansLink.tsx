import Link from "next/link";
import { Card } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** مدخلٌ إلى مركز الخطط — لكل الأعضاء.
 *
 *  والخطةُ لا تُكتَب ليحرسها كاتبُها: تُكتَب ليَعرفها من يُنفّذها. فمدخلُه
 *  في لوحة العضو كما هو في لوحة الإدارة، وبالصيغة نفسها. */
export function PlansLink({
  theme,
  docCount,
  freshCount = 0,
}: {
  theme: ReturnType<typeof themeFromColor>;
  docCount: number;
  /** ما أُضيف في آخر أسبوع — يُقال على المدخل نفسه */
  freshCount?: number;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">خطط تَـــلاقِ ووثائقها</h2>
        {freshCount > 0 && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-900">
            {freshCount} جديدة هذا الأسبوع
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-black/50">
        نبذةٌ عن المنصة — من نحن ولماذا وكيف — ثم خطةُ تَـــلاقِ وأهدافُها وأهمُّ ملفّاتها
        مرتَّبةً بترتيبٍ مقصود. يقرؤها الجميع، ويرفعها المؤسس والمدير التنفيذي.
      </p>
      <Link
        href="/plans"
        className="mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-on-brand"
        style={{ background: theme.base }}
      >
        {docCount > 0 ? `افتح المركز (${docCount} وثيقة)` : "افتح المركز"}
      </Link>
    </Card>
  );
}
