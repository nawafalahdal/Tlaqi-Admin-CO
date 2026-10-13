import Link from "next/link";
import { Card } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** مدخلٌ إلى الهيكل التنظيمي — لكل الأعضاء.
 *
 *  ومن حقّ العضو أن يرى أين هو ومن فوقه ومن معه. فالهيكل لا يُحجَب على
 *  القيادة: هو للعرض، ولا يملك أحدٌ تعديله — لا العضو ولا المؤسس. */
export function OrgChartLink({ theme }: { theme: ReturnType<typeof themeFromColor> }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">هيكل تَـــلاقِ التنظيمي</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/50">
        المؤسس والإدارة العليا وقادة الأقسام والأعضاء — كلٌّ في موضعه. يُبنى من بيانات
        المنصة ويتحدّث وحده، وهو للعرض فقط.
      </p>
      <Link
        href="/structure"
        className="mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-white"
        style={{ background: theme.base }}
      >
        استعرض الهيكل
      </Link>
    </Card>
  );
}
