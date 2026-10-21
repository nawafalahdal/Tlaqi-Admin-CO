import Link from "next/link";
import type { Session } from "next-auth";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { approvedGoals } from "@/lib/goals";
import { goalProgress } from "@/lib/progress";
import { announcementsForSession } from "@/lib/announcements";
import { calendarEntries, monthGrid, todayKey, MONTH_NAMES } from "@/lib/orgCalendar";
import { OPEN_DEPARTMENT_WHERE } from "@/lib/committees";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { formatDate } from "@/lib/format";
import { NavGlyph } from "../icons";
import { getLocale, getDictionary } from "@/i18n/server";
import type { Locale } from "@/i18n";

/** رأسُ مساحة العمل — بتصميم الأرشيف، وببيانات المنصة وحدها.
 *
 *  الأرشيفُ رسم خمس كتل: الهدفَ القادم وتقدّمه، والإعلانات، والاجتماعات
 *  القادمة، ولمحةَ الأقسام، وتقويماً مختصراً — وكلُّها فيه أرقامٌ وأسماءٌ
 *  مكتوبةٌ باليد («٦٨٪»، «اجتماع قيادة…»). وهنا كلُّ كتلةٍ تُقرأ من مصدرها:
 *
 *  | الكتلة | المصدر |
 *  |---|---|
 *  | الهدف وتقدّمه | `approvedGoals` + `goalProgress` (المتحقَّقُ منه لا المُعلَن) |
 *  | الإعلانات | `announcementsForSession` — بما يحقّ لصاحب الجلسة |
 *  | الاجتماعات والتقويم | `calendarEntries` — بنطاق صاحب الجلسة |
 *  | لمحة الأقسام | أعضاءُ القائمة (`ROSTER_MEMBER_WHERE`) لكل قسمٍ مفتوح، بلونه |
 *
 *  وما لا بيانات له يُقال إنه فارغ — لا يُملأ بمثال. */

/** التاريخُ الطويل بلغة الواجهة — والتقويمُ الميلاديّ والأرقامُ اللاتينية في الحالين */
function riyadhLongDate(d: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Riyadh",
  }).format(d);
}

/** اسمُ الشهر: العربيُّ كما هو في التقويم، والإنجليزيُّ من المتصفّح نفسه */
function monthName(year: number, month: number, locale: Locale) {
  return locale === "ar"
    ? MONTH_NAMES[month]
    : new Intl.DateTimeFormat("en-GB-u-ca-gregory", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month, 1)));
}

export async function WorkspaceOverview({
  session,
  showDepartments = false,
  announcementsHref = "#announcements",
  lead,
}: {
  session: Session;
  /** ما يلي الترحيبَ مباشرةً، قبل الهدف — بابُ رفع التذكرة */
  lead?: ReactNode;
  /** لمحةُ الأقسام لمن يرى كلَّ الأقسام */
  showDepartments?: boolean;
  announcementsHref?: string;
}) {
  const locale = await getLocale();
  const w = getDictionary(locale).workspace;
  const now = new Date();
  const grid = monthGrid(now);
  const horizon = new Date(now.getTime() + 45 * 86_400_000);

  const [goals, announcements, monthEntries, ahead, departments] = await Promise.all([
    approvedGoals(),
    announcementsForSession(session, 3),
    calendarEntries({ session, from: grid.from, to: grid.to }),
    calendarEntries({ session, from: now, to: horizon }),
    showDepartments
      ? prisma.department.findMany({
          where: { ...OPEN_DEPARTMENT_WHERE, parentId: null },
          select: {
            id: true,
            name: true,
            colorHex: true,
            _count: { select: { members: { where: ROSTER_MEMBER_WHERE } } },
          },
          orderBy: [{ leadershipOnly: "desc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  // الهدفُ «القادم»: أقربُ موعدٍ لم يَحِن من المعتمَدة، وإلا فأوّلُها أولويةً
  const upcoming = goals.filter((g) => g.dueDate >= now).sort((a, b) => +a.dueDate - +b.dueDate)[0] ?? goals[0] ?? null;
  const progress = upcoming ? await goalProgress(upcoming.id) : null;
  const pct = progress?.verifiedPercent ?? null;

  const meetings = ahead.filter((e) => e.kind === "meeting").slice(0, 3);
  const days = new Set(monthEntries.map((e) => e.date));
  const today = todayKey();
  const monthKey = `${grid.year}-${String(grid.month + 1).padStart(2, "0")}`;

  const copy = w.roles[session.user.role as keyof typeof w.roles] ?? w.roles.member;
  const firstName = (session.user.name ?? "").trim().split(/\s+/)[0] ?? "";
  const maxCount = Math.max(1, ...departments.map((d) => d._count.members));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-black/45">{riyadhLongDate(now, locale)}</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {copy.title}
          {firstName ? `${w.greetSep}${firstName}` : ""} <span style={{ color: "var(--nav-active)" }}>.</span>
        </h1>
        <p className="mt-2 text-sm text-black/50">{copy.desc}</p>
      </div>

      {lead}

      {/* ── الهدفُ القادم */}
      <section className="ws-hero">
        <div className="ws-hero__glow" aria-hidden="true" />
        <div className="relative max-w-2xl">
          <p className="mb-4 flex items-center gap-2 text-xs font-semibold" style={{ color: "#f0b08a" }}>
            <NavGlyph name="execution" /> {w.nextGoal}
          </p>
          {upcoming ? (
            <>
              <h2 className="text-xl font-bold leading-tight sm:text-3xl">{upcoming.title}</h2>
              {upcoming.description && (
                <p className="mt-3 max-w-xl text-sm leading-7 ws-hero__muted">{upcoming.description}</p>
              )}
              <div className="mt-6 flex flex-wrap items-end gap-6">
                <div className="min-w-56 flex-1 sm:flex-none">
                  <div className="mb-2 flex items-center justify-between gap-10 text-xs ws-hero__muted">
                    <span>{w.verified}</span>
                    <strong className="ws-hero__strong">{pct === null ? "—" : `${pct}%`}</strong>
                  </div>
                  <div className="h-2 w-full rounded-full ws-hero__track sm:w-56" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={w.verified}>
                    <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: "#d86b2f" }} />
                  </div>
                  <p className="mt-2 text-[11px] ws-hero__faint">
                    {pct === null ? w.noEligible : w.dueOn.replace("{date}", formatDate(upcoming.dueDate))}
                  </p>
                </div>
                {/* صفحةُ الأهداف للإداريين — العضو تردّه، فلا يُعرض له رابطٌ مردود */}
                {session.user.role !== "member" && (
                  <Link href="/admin/execution/goals" className="ws-hero__btn">
                    {w.goalDetails}
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold leading-tight sm:text-2xl">{w.noGoal}</h2>
              <p className="mt-3 max-w-xl text-sm leading-7 ws-hero__muted">
                {w.noGoalHint}
              </p>
              {session.user.role !== "member" && (
                <Link href="/admin/execution/goals" className="ws-hero__btn mt-6 inline-flex">
                  {w.openGoals}
                </Link>
              )}
            </>
          )}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        {/* ── الإعلانات */}
        <section className="ws-card">
          <div className="ws-card__head">
            <div>
              <h2 className="font-bold">{w.announcements}</h2>
              <p className="mt-1 text-xs text-black/45">{w.announcementsHint}</p>
            </div>
            <NavGlyph name="messages" className="ws-card__icon" />
          </div>
          {announcements.length === 0 ? (
            <p className="ws-empty">{w.noAnnouncements}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {announcements.map((a) => (
                <li key={a.id}>
                  <a href={`${announcementsHref}`} className="ws-row">
                    <span className="ws-row__badge" style={{ color: "#d86b2f", background: "color-mix(in oklab, #d86b2f 12%, transparent)" }}>
                      <NavGlyph name="reports" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{a.title}</span>
                      <span className="mt-1 block text-[11px] text-black/45">
                        {a.department?.name ?? (a.audience === "leadership" ? w.leadership : w.everyone)} · {a.authorName} · {formatDate(a.createdAt)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <a href={announcementsHref} className="ws-link">{w.allAnnouncements}</a>
        </section>

        {/* ── الاجتماعات القادمة */}
        <section className="ws-card">
          <div className="ws-card__head">
            <div>
              <h2 className="font-bold">{w.meetings}</h2>
              <p className="mt-1 text-xs text-black/45">{w.meetingsHint}</p>
            </div>
            <NavGlyph name="calendar" className="ws-card__icon" />
          </div>
          {meetings.length === 0 ? (
            <p className="ws-empty">{w.noMeetings}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link href={m.href} className="ws-row ws-row--flat">
                    <span className="ws-row__badge ws-row__badge--date" style={{ color: "#3f9d6e", background: "color-mix(in oklab, #69b88a 14%, transparent)" }}>
                      <span className="text-[10px] font-bold">{m.date.slice(8, 10)}/{m.date.slice(5, 7)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.title}</span>
                      {m.detail && <span className="mt-1 block truncate text-[11px] text-black/45">{m.detail}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/calendar" className="ws-link">{w.fullCalendar}</Link>
        </section>
      </div>

      <div className={`grid gap-6 ${showDepartments ? "xl:grid-cols-[1fr_1.35fr]" : ""}`}>
        {/* ── لمحة الأقسام */}
        {showDepartments && (
          <section className="ws-card">
            <div className="ws-card__head">
              <div>
                <h2 className="font-bold">{w.departments}</h2>
                <p className="mt-1 text-xs text-black/45">{w.departmentsHint}</p>
              </div>
              <NavGlyph name="departments" className="ws-card__icon" />
            </div>
            {departments.length === 0 ? (
              <p className="ws-empty">{w.noDepartments}</p>
            ) : (
              <ul className="mt-5 flex flex-col gap-4">
                {departments.map((d) => (
                  <li key={d.id} className="flex items-center gap-3">
                    <span className="ws-swatch size-2.5 shrink-0 rounded-full" style={{ background: d.colorHex }} aria-hidden="true" />
                    <span className="w-32 truncate text-sm">{d.name}</span>
                    <span className="h-2 flex-1 rounded-full bg-black/[0.06]" aria-hidden="true">
                      <span className="ws-swatch block h-full rounded-full" style={{ width: `${(d._count.members / maxCount) * 100}%`, background: d.colorHex }} />
                    </span>
                    <strong className="w-8 text-end text-sm">{d._count.members}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── التقويم المختصر */}
        <section className="ws-card">
          <div className="ws-card__head">
            <div>
              <h2 className="font-bold">{w.miniCalendar}</h2>
              <p className="mt-1 text-xs text-black/45">
                {w.miniCalendarHint.replace("{month}", monthName(grid.year, grid.month, locale)).replace("{year}", String(grid.year))}
              </p>
            </div>
            <NavGlyph name="calendar" className="ws-card__icon" />
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-xs text-black/45">
            {w.weekDays.map((d) => (
              <span key={d} className="font-semibold">{d}</span>
            ))}
            {grid.days.map((day) => {
              const has = days.has(day.key);
              const isToday = day.key === today;
              return (
                <Link
                  key={day.key}
                  href={`/calendar?m=${monthKey}#d-${day.key}`}
                  className="ws-day"
                  data-has={has ? "true" : undefined}
                  data-today={isToday ? "true" : undefined}
                  data-out={day.inMonth ? undefined : "true"}
                  aria-label={`${day.key}${has ? w.hasEvents : ""}`}
                >
                  {Number(day.key.slice(8, 10))}
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
