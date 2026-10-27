import Link from "next/link";
import { hasCapability } from "@/lib/marketing/access";
import { listCampaigns, countCampaigns } from "@/lib/marketing/campaigns";
import { marketingPage } from "@/lib/marketing/page";
import { fmt } from "@/i18n/fmt";
import { MkHeader } from "../_components/MkHeader";
import { Pill, Tabs, Pager, campaignTone, nameOf, when, mkTheme } from "../_components/bits";

export const dynamic = "force-dynamic";

const FILTERS = ["active", "all", "archived"] as const;
const PAGE_SIZE = 24;

/** الحملاتُ التي تراها: ما عُيِّنتَ فيه — أو كلُّها لمدير الفريق (اطّلاعاً) */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ f?: string; p?: string }> }) {
  const { actor, mk, isManager, canArchive, work, notices } = await marketingPage("/marketing/campaigns");
  const { f, p } = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(f ?? "") ? (f as (typeof FILTERS)[number]) : "active";
  const where = filter === "all" ? {} : filter === "archived" ? { status: "archived" as const } : { status: "active" as const };
  // بصفحات: لا تُرسم مئاتُ البطاقات في صفحةٍ واحدة
  const total = await countCampaigns(actor, where);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(p ?? "1", 10) || 1));
  const rows = await listCampaigns(actor, where, { page, size: PAGE_SIZE });
  const canCreate = hasCapability(actor, "coordinator");
  const label = { active: mk.campaigns.filterActive, all: mk.campaigns.filterAll, archived: mk.campaigns.filterArchived };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader
        mk={mk}
        current="campaigns"
        isManager={isManager} canArchive={canArchive} work={work} notices={notices}
        title={mk.campaigns.title}
        actions={
          canCreate ? (
            <Link href="/marketing/campaigns/new" className="inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-bold" style={{ background: mkTheme.fill, color: mkTheme.onFill }}>
              {mk.dashboard.newCampaign}
            </Link>
          ) : undefined
        }
      />
      <Tabs label={mk.campaigns.title} current={filter} items={FILTERS.map((k) => ({ key: k, label: label[k], href: `/marketing/campaigns?f=${k}` }))} />

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-hairline bg-white p-6 text-center text-sm text-black/50">
          {canCreate ? mk.campaigns.emptyCoordinator : mk.campaigns.empty}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => {
            const published = c.deliverables.filter((d) => d.status === "published").length;
            return (
              <li key={c.id}>
                <Link href={`/marketing/campaigns/${c.id}`} className="flex h-full flex-col gap-2 rounded-2xl border border-hairline bg-white p-4 hover:border-black/20">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{c.name}</span>
                    <Pill tone={campaignTone(c.status)}>{mk.campaignStatus[c.status]}</Pill>
                    {c.priority !== "normal" && <Pill tone={c.priority === "critical" ? "bad" : "review"}>{mk.priority[c.priority]}</Pill>}
                  </div>
                  <p className="text-xs text-black/55">{fmt(mk.campaigns.deliverablesCount, c._count.deliverables, published)}</p>
                  <p className="mt-auto flex flex-wrap gap-x-3 text-[11px] text-black/45">
                    <span>{mk.common.owner}: {nameOf(c.owner)}</span>
                    {c.deadline && <span>{mk.common.deadline}: {when(c.deadline, false)}</span>}
                    <span>{mk.common.updated}: {when(c.updatedAt)}</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={page} pages={pages} href={(n) => `/marketing/campaigns?f=${filter}&p=${n}`} labels={mk.common} />
    </main>
  );
}
