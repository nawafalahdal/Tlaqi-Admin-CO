import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { OrgTree } from "@/components/OrgTree";
import { buildOrgChart, MIN_DEPARTMENT_MEMBERS } from "@/lib/orgChart";

export const dynamic = "force-dynamic";

/** هيكل تَـــلاقِ التنظيمي — شجرةٌ واحدة، للعرض، لكل الأعضاء.
 *
 *  **ولا إجراء في هذه الصفحة على الإطلاق.** لا `"use server"` ولا
 *  `action` ولا `onClick` يُغيّر شيئاً. والسبب أعمق من إخفاء الأزرار:
 *  الهيكل لا يُخزَّن أصلاً — يُحسَب في كل قراءة من المناصب والأقسام
 *  المسجَّلة (`buildOrgChart`). فلا عمودَ ترتيبٍ في القاعدة يُكتَب، ولا
 *  دالّةَ نقلٍ تُنادى. من فتح أدوات المتصفّح لم يجد ما يُناديه.
 *
 *  **وصارت شجرةً موصولة لا صفحاتٍ للأقسام.** كان لكل قسمٍ بطاقتُه
 *  وترشيحُه بـ`?dept=`، فيُقرأ الهيكل قوائمَ متجاورة لا سلسلةَ إدارة.
 *  فحُذف الترشيح ووُصلت المستويات بخطوط: المؤسس ← التنفيذي ← الطبقة
 *  القيادية ← الأقسام. والإدارة العليا **في الأعلى معهم** ولا تُكرَّر
 *  تحت الأقسام: هي الطبقة التي تعلو الفروع لا فرعٌ بينها.
 *
 *  ويراها الجميع — العضو كالقائد كالمؤسس — **وبطاقةُ من يُشاهد مميَّزة**
 *  ليعرف موضعه بعينه بين العشرات.
 */
export default async function StructurePage() {
  const session = await auth();
  if (!session) redirect("/login");

  const chart = await buildOrgChart();
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const isMember = session.user.role === "member";

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName="الهيكل التنظيمي"
        userName={session.user.name ?? ""}
        homeHref={isMember ? "/member" : "/admin"}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold sm:text-xl">هيكل تَـــلاقِ التنظيمي</h1>
            <p className="mt-1 text-sm leading-relaxed text-black/50">
              يُبنى من العضوية والمناصب المعتمدة ويتحدّث وحده — وهو للعرض فقط.
            </p>
          </div>
          {chart.readiness.ready && (
            <Link
              href="/structure/pdf"
              className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold text-on-brand"
              style={{ background: theme.base }}
            >
              النسخة الرسمية (PDF)
            </Link>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Stat label="الأشخاص" value={chart.counts.people} />
          <Stat label="الأقسام" value={chart.counts.departments} />
          {chart.counts.committees > 0 && (
            <Stat label="اللجان" value={chart.counts.committees} />
          )}
          {chart.counts.vacancies > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-900">
              مناصب شاغرة: {chart.counts.vacancies}
            </span>
          )}
        </div>

        {/* ── التنبيه سطرٌ واحد، وتفصيلُه يُفتح عند الحاجة.
            كان صندوقاً بفقرةٍ وقائمةٍ طويلة فوق الهيكل نفسه، فصار الهيكلُ
            يُرى بعد التمرير. والتفصيلُ للقيادة وحدها: هي من تُكمل النقص،
            والعضو يكفيه أن يعرف متى تُتاح النسخة. */}
        {!chart.readiness.ready && (
          <details className="group mt-4 rounded-xl bg-amber-50 text-amber-950 ring-1 ring-amber-200">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 text-xs font-bold">
              <span aria-hidden>⚠</span>
              <span>النسخة الرسمية (PDF) غير متاحة بعد — الهيكل ناقص</span>
              {!isMember && (
                <>
                  <span className="rounded-full bg-amber-200/70 px-2 py-0.5">
                    {chart.readiness.blockers.length} نواقص
                  </span>
                  <span className="ms-auto font-semibold text-amber-800 underline-offset-2 group-open:hidden">
                    عرض التفاصيل
                  </span>
                  <span className="ms-auto hidden font-semibold text-amber-800 group-open:inline">إخفاء</span>
                </>
              )}
            </summary>
            <div className="border-t border-amber-200 px-4 pb-3 pt-2">
              <p className="text-[11px] leading-relaxed text-amber-900/80">
                تُتاح حين يكون لكل قسمٍ قائدٌ و{MIN_DEPARTMENT_MEMBERS} أعضاء على الأقل خلا قائده، ولا
                مقعدَ قيادةٍ شاغر، ولا عضوَ بلا قسم.
              </p>
              {!isMember && (
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {chart.readiness.blockers.map((b) => (
                    <li key={b} className="rounded-lg bg-white/70 px-3 py-1.5 text-[11.5px] font-semibold">
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}

        <section className="mt-7">
          {/* القائد موضعُه فرعُه لا بطاقتُه: يُميَّز قسمُه كلّه، وتبقى
              بطاقتُه هو بـ«أنت هنا» */}
          <OrgTree
            chart={chart}
            viewerId={session.user.id}
            viewerDepartmentId={session.user.departmentId ?? null}
          />
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full bg-black/[0.05] px-3 py-1 font-semibold text-black/55">
      {label}: {value}
    </span>
  );
}
