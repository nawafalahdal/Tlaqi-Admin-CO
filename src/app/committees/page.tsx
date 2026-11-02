import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Pager } from "@/components/Pager";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { orgActor } from "@/lib/org/actor";
import { listCommittees, departmentsForCreation, departmentOverview, COMMITTEE_STATUSES } from "@/lib/org/queries";
import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
import { DepartmentOverview } from "./_components/DepartmentOverview";
import { StatusChip, Chip, inputCls, fmtDay } from "./_components/bits";

export const dynamic = "force-dynamic";

/** اللجان — قائمةٌ واحدة لكل من له صلةٌ بلجنة، محدودةٌ بما يحقّ له.
 *
 *  - **المؤسس والرئيس التنفيذي ومسؤول التشغيل:** كلُّ اللجان، وتصفيةٌ بالقسم.
 *  - **قائدُ القسم ونائبُه:** لجانُ قسمه، ونظرةُ القسم فوقها.
 *  - **العضو:** اللجانُ التي هو فيها أو يقودها — لا غيرها.
 *
 *  والتصفيةُ والبحثُ والتقسيمُ في الاستعلام نفسه (`listCommittees`)، لا بعده. */
export default async function CommitteesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; lead?: string; q?: string; dept?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const actor = await orgActor(session);
  if (!actor?.role) redirect("/login");
  const sp = await searchParams;
  const t = getDictionary(await getLocale());
  const L = t.org;

  const wide = actor.isTop || actor.isOps;
  const deptFilter = wide ? sp.dept || undefined : undefined;
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const overviewDeptId = actor.leadsDepartmentId ?? actor.deputy?.departmentId ?? deptFilter ?? null;

  const [list, creatable, overview] = await Promise.all([
    listCommittees(actor, { status: sp.status, leadMemberId: sp.lead, q: sp.q, departmentId: deptFilter, page }),
    departmentsForCreation(actor),
    overviewDeptId ? departmentOverview(actor, overviewDeptId) : Promise.resolve(null),
  ]);
  if (!list) redirect("/login");

  const theme = themeFromColor(overview?.dept.colorHex ?? SUPER_ADMIN_THEME.colorHex);
  const filtered = !!(sp.status || sp.lead || sp.q || deptFilter);
  const href = (n: number) => {
    const p = new URLSearchParams();
    if (sp.status) p.set("status", sp.status);
    if (sp.lead) p.set("lead", sp.lead);
    if (sp.q) p.set("q", sp.q);
    if (deptFilter) p.set("dept", deptFilter);
    if (n > 1) p.set("page", String(n));
    const s = p.toString();
    return s ? `/committees?${s}` : "/committees";
  };

  const columns = [
    { key: "name", label: L.cols.name, primary: true },
    { key: "lead", label: L.cols.lead },
    { key: "status", label: L.cols.status },
    { key: "members", label: L.cols.members },
    { key: "progress", label: L.cols.progress },
    { key: "dates", label: L.cols.dates },
  ];
  const rows = list.rows.map((c) => ({
    id: c.id,
    cells: {
      name: (
        <div className="flex flex-col gap-1">
          <Link href={`/committees/${c.id}`} className="font-bold hover:underline">
            {c.name}
          </Link>
          <span className="flex items-center gap-1.5 text-xs text-black/50">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ border: `1.5px dashed ${c.parent?.colorHex ?? "#999"}` }}
              aria-hidden
            />
            {c.parent?.name}
            {" · "}
            {c.committeeKind ? L.kinds[c.committeeKind] : L.kinds.permanent}
          </span>
        </div>
      ),
      lead: c.leadMember ? (
        <span className={c.leadMember.isActive ? "" : "text-red-700"}>{c.leadMember.fullName}</span>
      ) : c.legacyLeadName ? (
        fmt(L.legacyLead, c.legacyLeadName)
      ) : (
        <Chip tone="warn">{L.noLead}</Chip>
      ),
      status: c.committeeStatus ? <StatusChip status={c.committeeStatus} label={L.statuses[c.committeeStatus]} /> : null,
      members: <span className="tabular-nums">{c.stats.members}</span>,
      progress: (
        <div className="flex flex-col items-end gap-1 sm:items-start">
          <span className="tabular-nums">{c.stats.progress === null ? L.notSet : `${c.stats.progress}%`}</span>
          <span className="text-xs text-black/50">
            {L.cols.openTasks}: <span className="tabular-nums">{c.stats.open}</span>
            {c.stats.overdue > 0 && (
              <>
                {" "}
                <Chip tone="danger">{fmt(L.overdueN, c.stats.overdue)}</Chip>
              </>
            )}
          </span>
        </div>
      ),
      dates: (
        <span className="text-xs tabular-nums text-black/60">
          {fmtDay(c.startDate)} ← {c.endDate ? fmtDay(c.endDate) : L.openEnded}
        </span>
      ),
    },
  }));

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title={L.title}
          description={L.desc}
          actions={
            creatable.length > 0 ? (
              <Link
                href={deptFilter && creatable.some((d) => d.id === deptFilter) ? `/committees/new?dept=${deptFilter}` : "/committees/new"}
                className="btn-brand inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
              >
                {L.newCommittee}
              </Link>
            ) : undefined
          }
        />

        {overview && <DepartmentOverview o={overview} theme={theme} L={L} />}

        <Card className="p-4">
          <form method="get" action="/committees" className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
            <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder={L.filters.search} aria-label={L.filters.search} className={inputCls} />
            <select name="status" defaultValue={sp.status ?? ""} aria-label={L.cols.status} className={inputCls}>
              <option value="">{L.filters.allStatuses}</option>
              {COMMITTEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {L.statuses[s]}
                </option>
              ))}
            </select>
            <select name="lead" defaultValue={sp.lead ?? ""} aria-label={L.cols.lead} className={inputCls}>
              <option value="">{L.filters.allLeads}</option>
              {list.leads.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
            {list.departments.length > 0 ? (
              <select name="dept" defaultValue={deptFilter ?? ""} aria-label={L.cols.department} className={inputCls}>
                <option value="">{L.filters.allDepartments}</option>
                {list.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-brand inline-flex min-h-11 flex-1 items-center justify-center rounded-xl px-4 text-sm font-semibold">
                {L.filters.apply}
              </button>
              {filtered && (
                <Link href="/committees" className="inline-flex min-h-11 items-center rounded-xl border border-black/10 px-3 text-xs font-bold hover:bg-black/[0.04]">
                  {L.filters.reset}
                </Link>
              )}
            </div>
          </form>
        </Card>

        <p className="text-xs text-black/50">{fmt(L.totalN, list.total)}</p>
        <DataTable columns={columns} rows={rows} emptyLabel={filtered ? L.noneMatch : L.noneVisible} />
        <Pager page={list.page} pages={list.pages} href={href} labels={t.common} />
      </main>
    </div>
  );
}
