import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/format";
import { fmt } from "@/i18n/fmt";
import { getLocale, getDictionary } from "@/i18n/server";
import { canManageOnboardingSurvey, onboardingRows, onboardingSummary, type SurveyStatus } from "@/lib/onboardingSurvey";
import { StatusChip } from "./StatusChip";

export const dynamic = "force-dynamic";

const FILTERS: (SurveyStatus | "all")[] = ["all", "not_completed", "needs_follow_up", "banner_missing", "completed"];

/** **لوحةُ استبيان الانضمام** — للمؤسس والرئيس التنفيذي ومسؤول المتابعة والتشغيل.
 *
 *  أعدادٌ ومتوسّطات، ومن يحتاج متابعة، وإفادةُ البنر بجانب سجلّ إرساله الفعلي (لا تُصحِّح
 *  إحداهما الأخرى). والصلاحيةُ هنا في الخادم قبل أيّ قراءة. */
export default async function OnboardingSurveyDashboard({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!canManageOnboardingSurvey(session.user.role)) redirect("/admin");
  const t = getDictionary(await getLocale()).onboarding;
  const sp = await searchParams;
  const status = FILTERS.includes(sp.status as SurveyStatus) ? (sp.status as SurveyStatus | "all") : "all";
  const q = (sp.q ?? "").trim().slice(0, 80).toLowerCase();

  const rows = await onboardingRows();
  const s = onboardingSummary(rows);
  const label: Record<SurveyStatus, string> = {
    not_completed: t.kNotCompleted,
    completed: t.kCompleted,
    banner_missing: t.kBannerMissing,
    needs_follow_up: t.kFollowUp,
  };
  const visible = rows.filter(
    (r) => (status === "all" || r.status === status) && (!q || r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
  );
  const count: Record<SurveyStatus | "all", number> = {
    all: s.total,
    not_completed: s.notCompleted,
    completed: s.completed,
    banner_missing: s.bannerMissing,
    needs_follow_up: s.needsFollowUp,
  };
  const href = (st: string) => {
    const p = new URLSearchParams();
    if (st !== "all") p.set("status", st);
    if (q) p.set("q", q);
    const qs = p.toString();
    return qs ? `/admin/onboarding?${qs}` : "/admin/onboarding";
  };

  const tiles: { label: string; value: string | number }[] = [
    { label: t.kRequired, value: s.total },
    { label: t.kAnswered, value: s.answered },
    { label: t.kNotCompleted, value: s.notCompleted },
    { label: t.kBannerMissing, value: s.bannerMissing },
    { label: t.kFollowUp, value: s.needsFollowUp },
    { label: t.kAvgJourney, value: s.avgJourney ?? "—" },
    { label: t.kAvgRole, value: s.avgRoleClarity ?? "—" },
  ];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <PageHeader
        title={t.dashTitle}
        description={t.dashDesc}
        actions={
          <form method="post" action="/api/onboarding-survey/export" className="flex flex-col items-end gap-1">
            <button type="submit" className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold">
              {t.exportXlsx}
            </button>
            <span className="text-xs text-black/45">{t.exportNote}</span>
          </form>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((x) => (
          <Card key={x.label} className="flex flex-col gap-1 p-4">
            <span className="text-xs text-black/50">{x.label}</span>
            <span className="text-2xl font-bold text-black/85">{x.value}</span>
          </Card>
        ))}
      </section>

      {s.statedVsDelivered > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{fmt(t.statedVsDelivered, s.statedVsDelivered)}</p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-2" aria-label={t.colStatus}>
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={href(f)}
              aria-current={status === f ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${
                status === f ? "border-[var(--brand-temptress)] bg-[var(--brand-temptress)] text-white" : "border-black/15 text-black/65"
              }`}
            >
              {f === "all" ? t.filterAll : label[f]} · {count[f]}
            </Link>
          ))}
        </nav>
        <form method="get" action="/admin/onboarding" className="flex gap-2">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder={t.search}
            aria-label={t.search}
            className="min-h-11 w-full rounded-xl border border-black/10 px-3 text-sm sm:w-64"
          />
        </form>
      </div>

      {visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-black/45">{t.empty}</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/admin/onboarding/${r.id}`} className="font-semibold text-black/85 hover:underline">
                    {r.fullName}
                  </Link>
                  <p className="truncate text-xs text-black/50">
                    {[r.department?.name, r.jobTitle].filter(Boolean).join(" · ")}
                    {r.decidedAt ? ` · ${fmt(t.approvedOn, formatDate(r.decidedAt))}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-black/60">
                  <StatusChip status={r.status} label={label[r.status]} />
                  {r.current && (
                    <>
                      <span>
                        {t.journeyShort} {r.current.journeyRating}/5 · {t.roleShort} {r.current.roleClarityRating}/5
                      </span>
                      <span>
                        {r.current.bannerReceived ? t.statedYes : t.statedNo} —{" "}
                        {r.welcomeEmailSentAt ? fmt(t.deliveredOn, formatDate(r.welcomeEmailSentAt)) : t.notDelivered}
                      </span>
                      <span>{formatDate(r.current.submittedAt)}</span>
                    </>
                  )}
                  <Link href={`/admin/onboarding/${r.id}`} className="font-semibold text-[var(--brand-temptress)] hover:underline">
                    {t.open}
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
