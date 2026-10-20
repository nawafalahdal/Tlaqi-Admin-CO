import { redirect } from "next/navigation";
import Image from "next/image";
import { auth } from "@/auth";
import { buildOrgChart, MIN_DEPARTMENT_MEMBERS } from "@/lib/orgChart";
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
      <main className="flex min-h-screen items-center justify-center bg-page p-6">
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
            className="mt-4 inline-flex min-h-11 items-center rounded-xl btn-brand px-4 text-sm font-semibold"
          >
            عودة إلى الهيكل
          </a>
        </div>
      </main>
    );
  }

  const today = formatDate(new Date());

  return (
    <main className="min-h-screen bg-page p-4 print:bg-white print:p-0">
      <PrintChart />

      {/* الورقة: A4 عرضيّ. والنِسَب ثابتة فلا يتمدّد التصميم على الشاشة
          ثم ينكسر على الورق */}
      <div
        className="mx-auto w-full max-w-[1123px] overflow-hidden rounded-2xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none"
        id="tlaqi-org-sheet"
      >
        {/* ترويسة الوثيقة: العنوانُ والإصدار، والشعار الرسمي كما هو */}
        <header
          className="mx-8 mt-7 flex items-end justify-between gap-4 pb-4"
          style={{ borderBottom: `2px solid ${BRAND.temptress}` }}
        >
          <div>
            <h1 className="text-2xl font-bold" style={{ color: BRAND.temptress }}>
              الهيكل التنظيمي الرسمي
            </h1>
            <p className="mt-1 text-xs text-black/55">
              تَـــلاقِ — TLAQI · صادرة في {today} من بيانات المنصة المعتمدة
            </p>
          </div>
          <Image
            src="/brand/lockup-on-light.png"
            alt="تَـــلاقِ — TLAQI"
            width={150}
            height={44}
            className="shrink-0"
            style={{ width: 150, height: 44 }}
            priority
          />
        </header>

        <div className="px-6 py-6">
          {/* **ولا علامة «أنت هنا» في النسخة الرسمية.** التمييز للعين
              على الشاشة، أمّا الورقة فتُعمَّم وتُرسَل — ونسخةٌ رسميةٌ
              تحمل «أنت هنا» على شخصٍ بعينه تُقرأ خطأً عند من وصلته. */}
          <OrgTree chart={chart} compact />
        </div>

        {/* تذييل: الأرقام والمرجع — وثيقةٌ تُقرأ بعد شهر فتُعرف نسختُها */}
        <footer className="mx-8 mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-3 text-[10px]">
          <span className="font-semibold text-black/60">
            {chart.counts.people} شخصاً • {chart.counts.departments} أقسام
            {chart.counts.committees > 0 ? ` • ${chart.counts.committees} لجنة` : ""} • لا مقاعد شاغرة
          </span>
          <span className="flex" aria-hidden>
            {[BRAND.greenSheen, BRAND.temptress, BRAND.mahogany, BRAND.beige].map((c) => (
              <span key={c} className="h-1.5 w-10" style={{ background: c }} />
            ))}
          </span>
          <span className="text-black/45">يُبنى آلياً من سجلّات المنصة — لا يُحرَّر يدوياً • صادر من إدارة تَـــلاقِ</span>
        </footer>
      </div>
    </main>
  );
}
