import Link from "next/link";
import { notFound } from "next/navigation";
import type { MarketingCampaignStatus } from "@prisma/client";
import { campaignWorkspace, briefMissing, teamMissing, PRIORITIES } from "@/lib/marketing/campaigns";
import { marketingPage } from "@/lib/marketing/page";
import { fmt } from "@/i18n/fmt";
import { MkHeader } from "../../_components/MkHeader";
import { ActionForm } from "../../_components/ActionForm";
import { BriefFields } from "../../_components/BriefFields";
import { Pill, Section, Tabs, Field, inputCls, campaignTone, nameOf, when } from "../../_components/bits";
import { DeliverablesTab, TasksTab, TeamTab, CommentsTab, AuditTab } from "./tabs";

export const dynamic = "force-dynamic";

const TABS = ["overview", "deliverables", "tasks", "team", "comments", "audit"] as const;
type Tab = (typeof TABS)[number];

/** انتقالاتُ الحملة التي تُعرض — هي ما يقبله `transitionCampaign` من هذه الحالة.
 *  والشروطُ (موجزٌ مكتمل، فريقٌ مكتمل) تُعرض قبل الزرّ، والخادمُ يفرضها بعده. */
const FORWARD: Partial<Record<MarketingCampaignStatus, MarketingCampaignStatus[]>> = {
  idea: ["briefing"],
  briefing: ["ready_for_planning", "idea"],
  ready_for_planning: ["in_progress", "briefing"],
  in_progress: ["ready_for_planning"],
};
const OPEN: MarketingCampaignStatus[] = ["idea", "briefing", "ready_for_planning", "in_progress"];

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const { actor, mk, isManager, locale } = await marketingPage(`/marketing/campaigns/${id}`);
  const ws = await campaignWorkspace(actor, id);
  if (!ws) notFound();
  const { campaign: c, roles } = ws;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "overview";
  const isCoordinator = roles.includes("coordinator");
  const sep = locale === "ar" ? "، " : ", ";
  const missing = briefMissing(c, c._count.deliverables);
  const liveRoles = c.members.filter((m) => m.member.active && m.member.capabilities.includes(m.role)).map((m) => m.role);
  const team = teamMissing(liveRoles);
  const closed = c.status === "archived" || c.status === "published";

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader
        mk={mk}
        current={null}
        isManager={isManager}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            <Pill tone={campaignTone(c.status)}>{mk.campaignStatus[c.status]}</Pill>
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-3 text-xs">
            <span>{mk.common.owner}: {nameOf(c.owner)}</span>
            {c.deadline && <span>{mk.common.deadline}: {when(c.deadline, false)}</span>}
            <span>{mk.common.priority}: {mk.priority[c.priority]}</span>
          </span>
        }
        back={<Link href="/marketing/campaigns" className="text-xs font-bold text-black/55 hover:underline">{mk.campaigns.title}</Link>}
      />

      {roles.length === 0 && <p className="rounded-2xl bg-black/[0.04] px-4 py-3 text-sm text-black/65">{mk.common.viewOnly}</p>}
      {c.status === "blocked" && c.blockedReason && (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{fmt(mk.campaign.blockedBecause, c.blockedReason)}</p>
      )}

      <Tabs
        label={c.name}
        current={tab}
        items={TABS.map((k) => ({
          key: k,
          label: mk.campaign.tabs[k],
          href: `/marketing/campaigns/${c.id}?tab=${k}`,
          count: k === "deliverables" ? c._count.deliverables : k === "team" ? c.members.length : undefined,
        }))}
      />

      {tab === "overview" && (
        <>
          <Section title={mk.campaign.brief}>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {(["objective", "audience", "keyMessage", "description"] as const).map((k) => (
                <div key={k} className={k === "objective" || k === "description" ? "sm:col-span-2" : ""}>
                  <dt className="text-xs font-bold text-black/55">{mk.briefField[k]}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap leading-relaxed">{c[k] || mk.common.none}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs font-bold text-black/55">{mk.briefField.channels}</dt>
                <dd className="mt-0.5" dir="ltr">{c.channels.length ? c.channels.join(", ") : mk.common.none}</dd>
              </div>
            </dl>
            {isCoordinator && !closed && (
              <details className="mt-4 border-t border-black/5 pt-3">
                <summary className="cursor-pointer text-sm font-bold">{mk.campaign.editBrief}</summary>
                <div className="mt-3">
                  <ActionForm op="campaign.brief" submit={mk.campaign.saveBrief}>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <BriefFields mk={mk} priorities={PRIORITIES} value={c} />
                  </ActionForm>
                </div>
              </details>
            )}
          </Section>

          {isCoordinator && (
            <Section title={mk.common.status} hint={c.status === "in_progress" ? mk.campaign.autoPublished : undefined}>
              <div className="flex flex-col gap-3">
                {c.status === "briefing" && missing.length > 0 && (
                  <p className="text-xs text-amber-900">{fmt(mk.campaign.missing, missing.map((m) => mk.briefField[m as keyof typeof mk.briefField] ?? m).join(sep))}</p>
                )}
                {c.status === "ready_for_planning" && team.length > 0 && (
                  <p className="text-xs text-amber-900">{fmt(mk.campaign.teamMissing, team.map((r) => mk.capability[r]).join(sep))}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(FORWARD[c.status] ?? []).map((to) => (
                    <ActionForm key={to} op="campaign.transition" submit={fmt(mk.campaign.moveTo, mk.campaignStatus[to])} variant={OPEN.indexOf(to) > OPEN.indexOf(c.status) ? "solid" : "outline"}>
                      <input type="hidden" name="campaignId" value={c.id} />
                      <input type="hidden" name="to" value={to} />
                      <input type="hidden" name="revision" value={c.revision} />
                    </ActionForm>
                  ))}
                  {c.status === "blocked" && c.statusBeforeBlock && (
                    <ActionForm op="campaign.transition" submit={mk.campaign.unblock}>
                      <input type="hidden" name="campaignId" value={c.id} />
                      <input type="hidden" name="to" value={c.statusBeforeBlock} />
                      <input type="hidden" name="revision" value={c.revision} />
                    </ActionForm>
                  )}
                </div>
                {OPEN.includes(c.status) && (
                  <details className="border-t border-black/5 pt-3">
                    <summary className="cursor-pointer text-sm font-bold">{mk.campaign.block}</summary>
                    <div className="mt-3">
                      <ActionForm op="campaign.transition" submit={mk.campaign.block} variant="danger">
                        <input type="hidden" name="campaignId" value={c.id} />
                        <input type="hidden" name="to" value="blocked" />
                        <input type="hidden" name="revision" value={c.revision} />
                        <Field label={mk.campaign.blockReason}>
                          <input name="reason" required maxLength={500} className={inputCls} />
                        </Field>
                      </ActionForm>
                    </div>
                  </details>
                )}
                {c.status !== "archived" && (
                  <details className="border-t border-black/5 pt-3">
                    <summary className="cursor-pointer text-sm font-bold">{mk.campaign.archive}</summary>
                    <div className="mt-3">
                      <ActionForm op="campaign.transition" submit={mk.campaign.archive} variant="danger" confirm={mk.campaign.archiveConfirm}>
                        <input type="hidden" name="campaignId" value={c.id} />
                        <input type="hidden" name="to" value="archived" />
                        <input type="hidden" name="revision" value={c.revision} />
                      </ActionForm>
                    </div>
                  </details>
                )}
              </div>
            </Section>
          )}
        </>
      )}

      {tab === "deliverables" && <DeliverablesTab mk={mk} campaign={c} canEdit={isCoordinator && !closed} locale={locale} />}
      {tab === "tasks" && <TasksTab mk={mk} actor={actor} campaign={c} roles={roles} />}
      {tab === "team" && <TeamTab mk={mk} actor={actor} campaign={c} canEdit={isCoordinator && !closed} />}
      {tab === "comments" && <CommentsTab mk={mk} actor={actor} campaignId={c.id} canWrite={roles.length > 0} />}
      {tab === "audit" && <AuditTab mk={mk} campaignId={c.id} locale={locale} />}
    </main>
  );
}
