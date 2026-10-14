import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
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
        <BackButton fallbackHref={isMember ? "/member" : "/admin"} />

        <h1 className="text-lg font-bold sm:text-xl">هيكل تَـــلاقِ التنظيمي</h1>
        <p className="mt-1 text-sm leading-relaxed text-black/50">
          يُبنى من بيانات العضوية والمناصب والأقسام المعتمدة، ويتحدّث وحده مع كل تغييرٍ معتمد.
          وهو للعرض فقط — لا يُعدَّل من هذه الصفحة ولا من غيرها. وبطاقتك فيه مميَّزة بعلامة
          «أنت هنا»، ومن كان له قسمٌ تبيَّن له فرعُه كاملاً.
        </p>

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

        {/* ── النسخة الرسمية: للجميع، ولا تُنزَّل وهي ناقصة */}
        <Card className="mt-5 p-4 sm:p-5">
          <h2 className="text-sm font-bold">نسخة الهيكل الرسمية (PDF)</h2>
          {chart.readiness.ready ? (
            <>
              <p className="mt-1 text-xs leading-relaxed text-black/50">
                الهيكل مكتمل — تُفتح نسخةٌ بمقاس A4 عرضيّ بألوان تَـــلاقِ وشعارها، ثم تُحفَظ
                PDF من المتصفّح.
              </p>
              <Link
                href="/structure/pdf"
                className="mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-on-brand"
                style={{ background: theme.base }}
              >
                افتح النسخة الرسمية
              </Link>
            </>
          ) : (
            <>
              {/* المنع يُسمّي سببه: «غير مكتمل» وحدها تَترك من يقرأ يُخمّن */}
              <p className="mt-1 text-xs leading-relaxed text-black/55">
                النسخة الرسمية لا تُنزَّل والهيكل ناقص — وثيقةٌ تُعمَّم فتقول عن المنظمة غير
                ما فيها. والشرط: كلُّ قسمٍ له قائد و
                {MIN_DEPARTMENT_MEMBERS} أعضاء على الأقل خلا قائده، ولا مقعدَ قيادةٍ شاغر، ولا
                عضوَ بلا قسم.
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
            </>
          )}
        </Card>

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
