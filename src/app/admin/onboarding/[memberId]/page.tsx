import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { BackButton } from "@/components/BackButton";
import { formatDate } from "@/lib/format";
import { fmt } from "@/i18n/fmt";
import { getLocale, getDictionary } from "@/i18n/server";
import { canManageOnboardingSurvey, surveyStatus, type SurveyStatus } from "@/lib/onboardingSurvey";
import { StatusChip } from "../StatusChip";
import { ResolveFollowUp, ReopenSurvey } from "../OnboardingActions";

export const dynamic = "force-dynamic";

/** **ملفُّ العضو في سياق الانضمام** — قراءةٌ فقط: من هو، ومتى اعتُمد، وهل وصله البنر فعلاً، وما
 *  أجاب (وما أجاب قبل إعادة الفتح). لا أدوات حسابٍ هنا — فمسؤولُ التشغيل يرى ما يتابع به ولا
 *  يكتسب صلاحيةً على الحساب. والإجراءان الوحيدان إجراءا الاستبيان نفسه. */
export default async function OnboardingMemberPage({ params }: { params: Promise<{ memberId: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!canManageOnboardingSurvey(session.user.role)) redirect("/admin");
  const t = getDictionary(await getLocale()).onboarding;
  const { memberId } = await params;

  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      fullName: true,
      email: true,
      jobTitle: true,
      decidedAt: true,
      approvalStatus: true,
      welcomeEmailSentAt: true,
      onboardingSurveyRequiredAt: true,
      department: { select: { name: true } },
      onboardingSurveys: { orderBy: { submittedAt: "desc" } },
    },
  });
  if (!m || m.approvalStatus !== "approved") notFound();

  const current = m.onboardingSurveys.find((r) => !r.supersededAt) ?? null;
  const previous = m.onboardingSurveys.filter((r) => r.supersededAt);
  const status = surveyStatus(current);
  const label: Record<SurveyStatus, string> = {
    not_completed: t.kNotCompleted,
    completed: t.kCompleted,
    banner_missing: t.kBannerMissing,
    needs_follow_up: t.kFollowUp,
  };
  const top = session.user.role === "super_admin" || session.user.role === "executive";
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="min-w-40 text-xs text-black/50">{k}</dt>
      <dd className="text-sm text-black/80">{v}</dd>
    </div>
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <PageHeader
        title={m.fullName}
        description={t.profileTitle}
        back={<BackButton fallbackHref="/admin/onboarding" />}
        actions={
          top ? (
            <Link href={`/admin/people/member/${m.id}`} className="text-sm font-semibold text-[var(--brand-temptress)] hover:underline">
              {t.fullProfile}
            </Link>
          ) : undefined
        }
      />

      <Card className="p-5">
        <dl className="flex flex-col gap-3">
          {row(t.email, <span dir="ltr">{m.email}</span>)}
          {row(t.department, m.department?.name ?? "—")}
          {row(t.jobTitle, m.jobTitle ?? "—")}
          {row(t.approvedAt, m.decidedAt ? formatDate(m.decidedAt) : "—")}
          {row(t.requiredAt, m.onboardingSurveyRequiredAt ? formatDate(m.onboardingSurveyRequiredAt) : t.profileCardNone)}
          {row(t.colBanner, m.welcomeEmailSentAt ? fmt(t.deliveredOn, formatDate(m.welcomeEmailSentAt)) : t.notDelivered)}
          {row(t.colStatus, <StatusChip status={status} label={label[status]} />)}
        </dl>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-base font-bold text-black/85">{t.currentAnswer}</h2>
        {!current ? (
          <p className="text-sm text-black/55">{m.onboardingSurveyRequiredAt ? t.noAnswer : t.profileCardNone}</p>
        ) : (
          <>
            <dl className="flex flex-col gap-3">
              {row(t.q1, `${current.journeyRating}/5`)}
              {row(t.q2, `${current.roleClarityRating}/5`)}
              {row(t.q3, current.bannerReceived ? t.yes : t.no)}
              {row(t.gender, current.gender === "female" ? t.female : t.male)}
              {row(t.submittedAt, formatDate(current.submittedAt))}
            </dl>
            {current.followUpResolvedAt && (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {fmt(t.followUpDone, current.followUpNote ?? "", current.followUpResolvedByName ?? "", formatDate(current.followUpResolvedAt))}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {(status === "banner_missing" || status === "needs_follow_up") && <ResolveFollowUp responseId={current.id} />}
              <ReopenSurvey memberId={m.id} />
            </div>
          </>
        )}
      </Card>

      {previous.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-bold text-black/85">{t.history}</h2>
          <ul className="flex flex-col gap-3">
            {previous.map((r) => (
              <li key={r.id} className="rounded-xl border border-hairline p-3 text-sm text-black/70">
                <p>
                  {t.journeyShort} {r.journeyRating}/5 · {t.roleShort} {r.roleClarityRating}/5 · {t.colBanner}: {r.bannerReceived ? t.yes : t.no} ·{" "}
                  {formatDate(r.submittedAt)}
                </p>
                <p className="mt-1 text-xs text-black/50">{fmt(t.reopenedBy, r.reopenedByName ?? "", r.reopenReason ?? "")}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
