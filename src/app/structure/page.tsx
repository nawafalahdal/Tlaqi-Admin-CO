import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { SeatCard, OrgCard } from "@/components/OrgCard";
import { buildOrgChart, ORG_SENIOR_COLOR, outlineFor, needsOutline } from "@/lib/orgChart";

export const dynamic = "force-dynamic";

/** هيكل تَـــلاقِ التنظيمي — للعرض، لكل الأعضاء، ولا يُحرَّر.
 *
 *  **ولا إجراء في هذه الصفحة على الإطلاق.** لا `"use server"` ولا
 *  `action` ولا `onClick` يُغيّر شيئاً. والسبب أعمق من إخفاء الأزرار:
 *  الهيكل لا يُخزَّن أصلاً — يُحسَب في كل قراءة من المناصب والأقسام
 *  المسجَّلة (`buildOrgChart`). فلا عمودَ ترتيبٍ في القاعدة يُكتَب، ولا
 *  دالّةَ نقلٍ تُنادى. من فتح أدوات المتصفّح لم يجد ما يُناديه.
 *
 *  والتغيير من بابه: يُعتمد عضوٌ فيظهر، ويُصنَّف فينتقل، وتنتهي عضويتُه
 *  فيختفي، ويُنشأ قسمٌ فيُفتَح له فرع. والصفحة `force-dynamic` فتقرأ
 *  أحدث البيانات في كل فتحة — لا نسخةً مبنيّةً سابقاً.
 *
 *  ويراها الجميع: العضو كالقائد كالمؤسس. ومن حقّ العضو أن يعرف أين هو
 *  ومن فوقه ومن معه.
 */
export default async function StructurePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { dept: focus } = await searchParams;
  const chart = await buildOrgChart();
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  // التركيز على قسمٍ واحد — ترشيحُ عرضٍ بمَعلمةٍ في الرابط، لا تعديلُ
  // بيانات. وبه تُقرأ منظمةٌ كبيرة بلا ازدحام.
  const focused = focus ? chart.departments.filter((d) => d.id === focus) : chart.departments;
  const isMember = session.user.role === "member";

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
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
          يُبنى من بيانات العضوية والمناصب والأقسام المعتمدة في المنصة، ويتحدّث وحده مع كل
          تغييرٍ معتمد. وهو للعرض فقط — لا يُعدَّل من هذه الصفحة ولا من غيرها.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Stat label="الأشخاص" value={chart.counts.people} />
          <Stat label="الأقسام" value={chart.counts.departments} />
          {chart.counts.vacancies > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-900">
              مناصب شاغرة: {chart.counts.vacancies}
            </span>
          )}
        </div>

        {/* ترشيح العرض: الكلّ أو قسمٌ بعينه */}
        {chart.departments.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <FocusLink href="/structure" active={!focus} label="الهيكل كاملاً" color={ORG_SENIOR_COLOR} />
            {chart.departments.map((d) => (
              <FocusLink
                key={d.id}
                href={`/structure?dept=${d.id}`}
                active={focus === d.id}
                label={d.name}
                color={d.displayColor}
              />
            ))}
          </div>
        )}

        {/* ── المستويان الأعلى: المؤسس ثم التنفيذي */}
        {!focus && (
          <section className="mt-7 flex flex-col items-center">
            <SeatCard seat={chart.founder} color={ORG_SENIOR_COLOR} size="lg" />
            <Connector />
            <SeatCard seat={chart.ceo} color={ORG_SENIOR_COLOR} size="lg" />

            {chart.underCeo.length > 0 && (
              <>
                <Connector />
                <p className="mb-2 text-[11px] font-bold tracking-wider text-black/35">
                  تابعٌ للرئيس التنفيذي
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {chart.underCeo.map((seat, i) => (
                    <SeatCard key={i} seat={seat} color={ORG_SENIOR_COLOR} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── الأقسام: لكلٍّ قائدُه ثم أعضاؤه */}
        <section className="mt-8 flex flex-col gap-5">
          {focused.length === 0 && (
            <Card className="p-8 text-center text-sm text-black/40">لا أقسام بعد</Card>
          )}
          {focused.map((d) => (
            <Card key={d.id} className="overflow-hidden p-0">
              <div
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                // والأبيض يُرسَم بحدٍّ داكنٍ يُرى، ولا يُترك شريطاً
                // أبيض على سطحٍ أبيض
                style={{
                  background: needsOutline(d.displayColor) ? "#F6F7F1" : `${d.displayColor}14`,
                  borderBottom: `2px solid ${outlineFor(d.displayColor)}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 rounded-full"
                    style={{ background: d.displayColor, boxShadow: `0 0 0 1px ${outlineFor(d.displayColor)}` }}
                    aria-hidden
                  />
                  <h2 className="text-sm font-bold text-black/80">{d.name}</h2>
                  {d.leadershipOnly && (
                    <span className="rounded-full bg-[#341D2B] px-2 py-0.5 text-[10px] font-bold text-[#EEF6DF]">
                      يتبع الإدارة العليا
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-black/40">
                  {d.members.length} {d.members.length === 1 ? "عضو" : "أعضاء"}
                </span>
              </div>

              <div className="flex flex-col items-center gap-0 px-4 py-5">
                <SeatCard seat={d.lead} color={d.displayColor} />
                {d.members.length > 0 && (
                  <>
                    <Connector />
                    <div className="flex flex-wrap justify-center gap-3">
                      {d.members.map((m) => (
                        <OrgCard key={m.id} person={m} color={d.displayColor} size="sm" />
                      ))}
                    </div>
                  </>
                )}
                {d.members.length === 0 && (
                  <p className="mt-3 text-xs text-black/35">لا أعضاء في هذا القسم بعد</p>
                )}
              </div>
            </Card>
          ))}
        </section>

        {/* معتمدون بلا قسم — يُعرضون ولا يُخفَون، فالهيكل يقول الحقيقة */}
        {!focus && chart.unassigned.length > 0 && (
          <section className="mt-6">
            <Card className="p-4">
              <h2 className="text-sm font-bold text-black/75">أعضاء غير مصنّفين في قسم</h2>
              <p className="mb-3 mt-0.5 text-xs text-black/45">
                معتمدون في المنصة ولم يُصنَّفوا بعد — يُصنّفهم المؤسس من إدارة الأعضاء.
              </p>
              <div className="flex flex-wrap gap-3">
                {chart.unassigned.map((m) => (
                  <OrgCard key={m.id} person={m} color="#8A9470" size="sm" />
                ))}
              </div>
            </Card>
          </section>
        )}
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

/** خطُّ الاتصال بين المستويين — زخرفةٌ تُقرأ تبعيّة */
function Connector() {
  return <span className="my-2 block h-5 w-px bg-black/15" aria-hidden />;
}

function FocusLink({
  href,
  active,
  label,
  color,
}: {
  href: string;
  active: boolean;
  label: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition-colors ${
        active ? "text-white" : "bg-white text-black/60 ring-1 ring-black/10 hover:bg-black/[0.03]"
      }`}
      style={active ? { background: needsOutline(color) ? "#341D2B" : color } : undefined}
    >
      {!active && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: color, boxShadow: `0 0 0 1px ${outlineFor(color)}` }}
          aria-hidden
        />
      )}
      {label}
    </Link>
  );
}
