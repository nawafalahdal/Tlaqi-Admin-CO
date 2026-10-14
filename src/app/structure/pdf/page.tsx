import { redirect } from "next/navigation";
import Image from "next/image";
import { auth } from "@/auth";
import { buildOrgChart, MIN_DEPARTMENT_MEMBERS, ORG_SENIOR_COLOR } from "@/lib/orgChart";
import { OrgTree } from "@/components/OrgTree";
import { PrintChart } from "./PrintChart";
import { formatDate } from "@/lib/format";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** النسخة الرسمية من الهيكل — ورقةٌ تُطبع أو تُحفَظ PDF.
 *
 *  **ولماذا صفحةُ طباعةٍ لا ملفٌّ يُولَّد في الخادم؟** النصّ عربي،
 *  وتوليدُ PDF عربيٍّ صحيحٍ يحتاج تشكيلَ الحروف ووصلَها — وهو ما يفعله
 *  محرّك المتصفّح مجاناً وبدقّة، بينما مكتبات PDF في العقدة إمّا تقطّع
 *  الحروف أو تحتاج متصفّحاً كاملاً داخل دالّةٍ بلا حالة. وهذا نفس
 *  الطريق المعتمد في شهادات تَـــلاقِ، فالنسختان متّسقتان.
 *
 *  **والمنع يُفرَض هنا لا في إخفاء الزرّ.** من كتب العنوان بيده يصل إلى
 *  هذا الملف، فيُقاس الاكتمال في الخادم قبل أن يُرسَم حرف: الهيكل
 *  الناقص وثيقةٌ تكذب، وتُعمَّم ولا تُسحَب.
 */
export default async function StructurePdfPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const chart = await buildOrgChart();

  // الحرس في الخادم: لا تُرسَم ورقةٌ لهيكلٍ ناقص ولو كُتب العنوان يدوياً
  if (!chart.readiness.ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FAF8F4] p-6">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/[0.06]">
          <h1 className="text-base font-bold">النسخة الرسمية غير متاحة بعد</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-black/55">
            الهيكل ناقص، ولا تُنزَّل نسخةٌ رسمية لهيكلٍ ناقص. والشرط: كلُّ قسمٍ له قائد و
            {MIN_DEPARTMENT_MEMBERS} أعضاء على الأقل خلا قائده، ولا مقعدَ قيادةٍ شاغر، ولا عضوَ
            بلا قسم.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {chart.readiness.blockers.map((b) => (
              <li
                key={b}
                className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
              >
                {b}
              </li>
            ))}
          </ul>
          <a
            href="/structure"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#341D2B] px-4 text-sm font-semibold text-white"
          >
            عودة إلى الهيكل
          </a>
        </div>
      </main>
    );
  }

  const today = formatDate(new Date());

  return (
    <main className="min-h-screen bg-[#FAF8F4] p-4 print:bg-white print:p-0">
      <PrintChart />

      {/* الورقة: A4 عرضيّ. والنِسَب ثابتة فلا يتمدّد التصميم على الشاشة
          ثم ينكسر على الورق */}
      <div
        className="mx-auto w-full max-w-[1123px] overflow-hidden rounded-2xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none"
        id="tlaqi-org-sheet"
      >
        {/* ترويسة الهوية */}
        <header
          className="flex items-center justify-between gap-4 px-8 py-5"
          style={{ background: BRAND.temptress }}
        >
          <Image
            src="/brand/lockup-on-dark.png"
            alt="تَـــلاقِ — TLAQI"
            width={132}
            height={39}
            className="shrink-0"
            style={{ width: 132, height: 39 }}
            priority
          />
          <div className="text-end">
            <p className="text-sm font-bold" style={{ color: BRAND.beige }}>
              الهيكل التنظيمي
            </p>
            <p className="mt-0.5 text-[10px]" style={{ color: `${BRAND.beige}B3` }}>
              نسخة رسمية — {today}
            </p>
          </div>
        </header>

        <div
          className="h-1 w-full"
          style={{
            background: `linear-gradient(90deg, ${ORG_SENIOR_COLOR} 0%, ${BRAND.mahogany} 50%, ${BRAND.greenSheen} 100%)`,
          }}
          aria-hidden
        />

        <div className="px-6 py-6">
          {/* **ولا علامة «أنت هنا» في النسخة الرسمية.** التمييز للعين
              على الشاشة، أمّا الورقة فتُعمَّم وتُرسَل — ونسخةٌ رسميةٌ
              تحمل «أنت هنا» على شخصٍ بعينه تُقرأ خطأً عند من وصلته. */}
          <OrgTree chart={chart} compact />
        </div>

        {/* تذييل: الأرقام والمرجع — وثيقةٌ تُقرأ بعد شهر فتُعرف نسختُها */}
        <footer
          className="flex flex-wrap items-center justify-between gap-2 px-8 py-3 text-[10px]"
          style={{ background: `${BRAND.beige}80`, borderTop: `1px solid ${ORG_SENIOR_COLOR}1F` }}
        >
          <span className="font-semibold text-black/60">
            {chart.counts.people} شخصاً • {chart.counts.departments} أقسام • لا مقاعد شاغرة
          </span>
          <span className="text-black/40">
            يُبنى آلياً من سجلّات المنصة — لا يُحرَّر يدوياً • tlaqiteam.site
          </span>
        </footer>
      </div>
    </main>
  );
}
