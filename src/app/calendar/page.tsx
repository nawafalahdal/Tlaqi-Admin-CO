import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import {
  calendarEntries,
  monthGrid,
  MONTH_NAMES,
  KIND_LABEL,
  todayKey,
  type CalendarEntry,
} from "@/lib/orgCalendar";
import { fromRiyadhParts, toRiyadh } from "@/lib/riyadh";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

/** التقويمُ الموحَّد — مواعيدُ الأهداف والمحطّات والالتزامات والاجتماعات.
 *
 *  **ولا جدولَ أحداثٍ ثانٍ وراءه:** كلُّ مدخلٍ اشتقاقٌ من سجلّه الأصلي،
 *  فلا يحتاج مزامنةً ولا يَكذب إن غُيّر موعدٌ من مكانٍ آخر.
 *
 *  **ويُعرَض لكلٍّ ما يحقّ له:** المُراجِعُ يرى الكلّ، وغيرُه يرى
 *  التزاماتِه والتزاماتِ قسمه والأهدافَ المعتمَدة والاجتماعات —
 *  والتصفيةُ في الاستعلام لا بعد الجلب.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { m } = await searchParams;
  const now = new Date();
  // الشهرُ المعروض: `m` بصيغة `YYYY-MM`، وإلا فالشهرُ الحالي بتوقيت الرياض
  let anchor = now;
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split("-").map(Number);
    anchor = fromRiyadhParts(y, mo - 1, 1, 12);
  }

  const grid = monthGrid(anchor);
  const entries = await calendarEntries({ session, from: grid.from, to: grid.to });

  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  }

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const isMember = session.user.role === "member";
  const today = todayKey();

  const prevAnchor = toRiyadh(new Date(grid.from.getTime() - 15 * 86_400_000));
  const nextAnchor = toRiyadh(new Date(grid.to.getTime() + 1 * 86_400_000));
  const key = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  const upcoming = entries
    .filter((e) => e.date >= today)
    .slice(0, 12);

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName="التقويم"
        userName={session.user.name ?? ""}
        homeHref={isMember ? "/member" : "/admin"}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title="تقويمُ تَـــلاقِ" description={<>مواعيدُ الأهداف والمحطّات والالتزامات الأسبوعية واجتماعاتِ المراجعة — بتوقيت
            الرياض. وكلُّ مدخلٍ يُفضي إلى سجلّه، ولا يُعرَض لأحدٍ ما لا يخصّه.</>} />

        {/* ── التنقّل بين الأشهر */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">
            {MONTH_NAMES[grid.month]} {grid.year}
          </h2>
          <div className="flex gap-2 text-xs">
            <Link
              href={`/calendar?m=${key(prevAnchor)}`}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-bold text-black/70"
            >
              → الشهر السابق
            </Link>
            <Link
              href="/calendar"
              className="rounded-lg border border-black/10 px-3 py-1.5 font-bold text-black/70"
            >
              هذا الشهر
            </Link>
            <Link
              href={`/calendar?m=${key(nextAnchor)}`}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-bold text-black/70"
            >
              الشهر القادم ←
            </Link>
          </div>
        </div>

        {/* ── الشبكة */}
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b border-black/5">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-[11px] font-bold text-black/50">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.days.map((day) => {
              const items = byDay.get(day.key) ?? [];
              const isToday = day.key === today;
              return (
                <div
                  key={day.key}
                  // مِرساةُ اليوم: التقويمُ المختصر في اللوحة يقف عليها
                  id={`d-${day.key}`}
                  className={`min-h-[92px] scroll-mt-24 border-b border-s border-black/5 p-1.5 ${
                    day.inMonth ? "" : "bg-black/[0.02]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-bold ${
                        isToday
                          ? "rounded-full bg-[#C34900] px-1.5 text-on-brand"
                          : day.inMonth
                            ? "text-black/55"
                            : "text-black/25"
                      }`}
                    >
                      {toRiyadh(day.date).getUTCDate()}
                    </span>
                    {items.length > 2 && (
                      <span className="text-[10px] text-black/35">{items.length}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {items.slice(0, 3).map((e) => (
                      <Link
                        key={e.id}
                        href={e.href}
                        title={`${KIND_LABEL[e.kind]}: ${e.title}${e.detail ? ` — ${e.detail}` : ""}`}
                        className={`block truncate rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          e.overdue ? "ring-1 ring-red-400" : ""
                        }`}
                        style={{
                          background: `${e.colorHex}1F`,
                          color: `light-dark(${e.colorHex}, var(--ink))`,
                        }}
                      >
                        {e.carried ? "↻ " : ""}
                        {e.title}
                      </Link>
                    ))}
                    {items.length > 3 && (
                      <span className="px-1.5 text-[10px] text-black/35">
                        +{items.length - 3} غيرها
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ── القادمُ قريباً: قائمةٌ تُقرأ على الجوّال */}
        <section>
          <h2 className="mb-3 text-base font-bold">القادمُ قريباً</h2>
          {upcoming.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">
              لا مواعيدَ قادمةً في هذا الشهر.
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <Link href={e.href} className="block">
                    <Card className="p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                          style={{
                            background: `${e.colorHex}1F`,
                            color: `light-dark(${e.colorHex}, var(--ink))`,
                          }}
                        >
                          {KIND_LABEL[e.kind]}
                        </span>
                        <span className="text-sm font-bold">{e.title}</span>
                        {e.carried && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                            مُرحَّل
                          </span>
                        )}
                        {e.overdue && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                            متأخّر
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-black/50">
                        {e.date}
                        {e.detail ? ` · ${e.detail}` : ""}
                      </p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
