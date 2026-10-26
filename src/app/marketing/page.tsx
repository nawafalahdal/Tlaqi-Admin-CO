import Link from "next/link";
import { hasCapability } from "@/lib/marketing/access";
import { actionItems, marketingOverview } from "@/lib/marketing/inbox";
import { marketingPage } from "@/lib/marketing/page";
import { fmt } from "@/i18n/fmt";
import { MkHeader } from "./_components/MkHeader";
import { Pill, Section, deliverableTone, taskTone, when, mkTheme } from "./_components/bits";

export const dynamic = "force-dynamic";

/** لوحةُ الوكيل: ما ينتظرك أولاً، ثم مهامّك، ثم الأعداد — كلُّها من الحقائق.
 *  و«ما ينتظرك» من مسؤولياتك في الحملات التي عُيِّنتَ فيها وحدها. */
export default async function MarketingDashboard() {
  const { actor, mk, isManager } = await marketingPage("/marketing");
  const [{ items, tasks }, overview] = await Promise.all([actionItems(actor), marketingOverview(actor)]);
  const active = ["idea", "briefing", "ready_for_planning", "in_progress", "blocked"].reduce((n, k) => n + (overview.byStatus[k] ?? 0), 0);
  const canCreate = hasCapability(actor, "coordinator");

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader
        mk={mk}
        current="dashboard"
        isManager={isManager}
        title={mk.title}
        description={mk.tagline}
        actions={
          canCreate ? (
            <Link href="/marketing/campaigns/new" className="inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-bold" style={{ background: mkTheme.fill, color: mkTheme.onFill }}>
              {mk.dashboard.newCampaign}
            </Link>
          ) : undefined
        }
      />

      {actor.isFounder && !actor.member && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">{mk.dashboard.founderNoTeam}</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: mk.dashboard.activeCampaigns, value: active },
          { label: mk.dashboard.overdueTasks, value: overview.overdueTasks },
          { label: mk.dashboard.published, value: overview.published },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-hairline bg-white p-4">
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="mt-1 text-xs text-black/55">{s.label}</p>
          </div>
        ))}
      </div>

      <Section title={mk.dashboard.waiting}>
        {items.length === 0 ? (
          <p className="text-sm text-black/50">{mk.dashboard.waitingEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[0.06]">
            {items.map((d) => (
              <li key={d.id}>
                <Link href={`/marketing/campaigns/${d.campaignId}/deliverables/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-black/[0.02]">
                  <span className="text-sm font-bold">{mk.inboxKind[d.kind as keyof typeof mk.inboxKind] ?? mk.inboxKind.view}</span>
                  <span className="text-sm text-black/75">{d.title}</span>
                  <span className="text-xs text-black/50">{d.campaign.name}</span>
                  <Pill tone={deliverableTone(d.status)}>{mk.deliverableStatus[d.status]}</Pill>
                  {d.campaign.deadline && <span className="text-[11px] text-black/45">{fmt(mk.dashboard.due, when(d.campaign.deadline, false))}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={mk.dashboard.myTasks}>
        {tasks.length === 0 ? (
          <p className="text-sm text-black/50">{mk.dashboard.myTasksEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[0.06]">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={`/marketing/campaigns/${t.campaignId}?tab=tasks#task-${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-black/[0.02]">
                  <span className="text-sm font-bold">{t.title}</span>
                  <span className="text-xs text-black/50">{t.campaign.name}{t.deliverable ? ` · ${t.deliverable.title}` : ""}</span>
                  <Pill tone={taskTone(t.status)}>{mk.taskStatus[t.status]}</Pill>
                  {t.dueAt && (
                    <span className={`text-[11px] ${t.dueAt < new Date() ? "font-bold text-red-700" : "text-black/45"}`}>{fmt(mk.dashboard.due, when(t.dueAt, false))}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Link href="/marketing/campaigns" className="self-start text-sm font-bold underline-offset-4 hover:underline">
        {mk.dashboard.allCampaigns}
      </Link>
    </main>
  );
}
