import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor } from "@/lib/brand";
import { orgActor } from "@/lib/org/actor";
import { committeeDetail } from "@/lib/org/queries";
import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
import { StatusChip, Chip, Stat } from "../_components/bits";
import {
  OverviewTab,
  MembersTab,
  TasksTab,
  MeetingsTab,
  DecisionsTab,
  ReportsTab,
  LogTab,
  SettingsTab,
} from "./tabs";

export const dynamic = "force-dynamic";

const TABS = ["overview", "members", "tasks", "meetings", "decisions", "reports", "log", "settings"] as const;
type Tab = (typeof TABS)[number];

/** صفحةُ اللجنة — هويّتُها وأعضاؤها وأعمالُها وسجلُّها، في تبويبات.
 *
 *  من لا يحقّ له رؤيتُها يلقى «غير موجودة» لا «ممنوع»: لا يُكشف وجودُ لجنةٍ
 *  في قسمٍ آخر لمن لا صلةَ له بها. والتبويبُ في الرابط (`?tab=`) — يُشارَك
 *  ويُرجَع إليه، ويُرسم في الخادم بلا شيفرة متصفّح. */
export default async function CommitteePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const actor = await orgActor(session);
  const { id } = await params;
  const d = await committeeDetail(actor, id);
  if (!d || !actor) notFound();
  const { tab: rawTab } = await searchParams;
  const L = getDictionary(await getLocale()).org;
  const c = d.committee;
  const theme = themeFromColor(c.parent?.colorHex ?? "#c34900");

  const showLog = d.role.manage || d.role.lead || actor.isTop || actor.isOps;
  const visible = TABS.filter((t) => (t === "log" ? showLog : t === "settings" ? d.role.manage : true));
  const tab: Tab = visible.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const roleLabel = d.role.manage
    ? L.detail.roleManage
    : d.role.lead
      ? L.detail.roleLead
      : d.role.member
        ? L.detail.roleMember
        : L.detail.roleView;
  const status = c.committeeStatus!;
  const leadName = c.leadMember?.fullName ?? (d.actingLeadName ? fmt(L.actingLead, d.actingLeadName) : c.legacyLeadName ? fmt(L.legacyLead, c.legacyLeadName) : null);
  const ctx = { d, actor, L, theme };

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          back={
            <Link href="/committees" className="mb-2 inline-flex text-xs font-bold text-black/55 hover:underline">
              ← {L.backToList}
            </Link>
          }
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span
                className="inline-block h-5 w-5 shrink-0 rounded-md"
                style={{ border: `2px dashed ${c.parent?.colorHex ?? "#999"}`, background: `${c.parent?.colorHex ?? "#999"}14` }}
                aria-hidden
              />
              {c.name}
              <StatusChip status={status} label={L.statuses[status]} />
            </span>
          }
          description={
            <>
              {c.parent?.name}
              {" · "}
              {c.committeeKind ? L.kinds[c.committeeKind] : L.kinds.permanent}
              {" · "}
              {L.detail.lead}: {leadName ?? L.noLead}
              {" · "}
              {fmt(L.detail.yourRole, roleLabel)}
            </>
          }
        />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={L.detail.members} value={d.stats.members} />
          <Stat label={L.detail.progress} value={d.stats.progress === null ? L.notSet : `${d.stats.progress}%`} />
          <Stat label={L.detail.openTasks} value={d.stats.open} />
          <Stat label={L.detail.overdue} value={d.stats.overdue} tone={d.stats.overdue ? "danger" : undefined} />
        </div>

        <nav aria-label={L.title} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {visible.map((t) => (
            <Link
              key={t}
              href={t === "overview" ? `/committees/${c.id}` : `/committees/${c.id}?tab=${t}`}
              aria-current={t === tab ? "page" : undefined}
              prefetch={false}
              className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ${
                t === tab ? "bg-black/[0.07]" : "text-black/60 hover:bg-black/[0.04]"
              }`}
            >
              {L.tabs[t]}
              {t === "members" && d.proposals.some((p) => p.status === "pending") && d.role.manage && (
                <Chip tone="warn">{d.proposals.filter((p) => p.status === "pending").length}</Chip>
              )}
              {t === "tasks" && d.stats.overdue > 0 && <Chip tone="danger">{d.stats.overdue}</Chip>}
            </Link>
          ))}
        </nav>

        <Card className="p-5 sm:p-6">
          {tab === "overview" && <OverviewTab {...ctx} />}
          {tab === "members" && <MembersTab {...ctx} />}
          {tab === "tasks" && <TasksTab {...ctx} />}
          {tab === "meetings" && <MeetingsTab {...ctx} />}
          {tab === "decisions" && <DecisionsTab {...ctx} />}
          {tab === "reports" && <ReportsTab {...ctx} />}
          {tab === "log" && <LogTab {...ctx} />}
          {tab === "settings" && <SettingsTab {...ctx} />}
        </Card>
      </main>
    </div>
  );
}
