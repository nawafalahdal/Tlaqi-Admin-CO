import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { formatDate } from "@/lib/format";
import { departmentsReport, membersReport, closedOnTimeTickets } from "@/lib/reports";
import { TICKET_RETENTION_DAYS } from "@/lib/retention";
import { outlineFor } from "@/lib/orgChart";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
export const dynamic = "force-dynamic";

/** التقارير — ملخّصٌ لمن يملك قراءته.
 *
 *  **ومن يرى ماذا قاعدةٌ لا ترتيبُ عرض:**
 *  • المؤسس والتنفيذي: ملخّصُ القادة قسماً قسماً.
 *  • قائد القسم: أعضاؤه **هو** — ولا تُجلَب صفوفُ قسمٍ آخر ثم تُخفى،
 *    بل لا تُجلَب أصلاً (`membersReport(departmentId)`).
 *  • العضو: لا تقارير — حالتُه في بوابته.
 *
 *  **والأرقام من عدّادٍ لا من صفوف.** التذاكر المغلقة تُحال إلى الإكسل
 *  كلَّ سبت، فلو حُسبت التقارير من صفوفها لصارت أسبوعاً ثم تُفرَّغ.
 *  فالنتيجة تُعَدّ لحظة الإغلاق ويبقى العدّ — والقائمة التفصيلية تُظهر
 *  ما لم يُؤرشَف بعد، ويُقال ذلك صريحاً لا يُترَك لُبساً.
 */
export default async function ReportsPage() {
  const L = getDictionary(await getLocale()).rReportsPage;
  const session = await auth();
  if (!session) redirect("/login");
  const role = session.user.role;
  if (role === "member") redirect("/member");

  const seesDepartments = role === "super_admin" || role === "executive" || role === "operations_officer";
  const isLead = role === "department_admin";

  const departments = seesDepartments ? await departmentsReport() : [];
  const myDepartment = isLead && session.user.departmentId
    ? await prisma.department.findUnique({
        where: { id: session.user.departmentId },
        select: { id: true, name: true },
      })
    : null;
  const members = myDepartment ? await membersReport(myDepartment.id) : [];
  const onTime = await closedOnTimeTickets(40);

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={L.reports} description={<>{seesDepartments
              ? L.aSummaryOfDepartments
              : L.aSummaryOfYour}
            {" "}{L.numbersAreCountedAt}</>} />

        {seesDepartments && (
          <section>
            <h2 className="mb-3 text-base font-bold">{L.leadsAndDepartmentsSummary}</h2>
            <DataTable
              emptyLabel={L.noDepartmentsYet}
              columns={[
                { key: "dept", label: L.department, primary: true },
                { key: "lead", label: L.lead },
                { key: "members", label: L.members },
                { key: "open", label: L.openTickets },
                { key: "onTime", label: L.closedOnTime },
                { key: "late", label: L.late },
                { key: "rate", label: L.commitmentRate },
              ]}
              rows={departments.map((d) => ({
                id: d.departmentId,
                cells: {
                  dept: (
                    <span className="inline-flex items-center gap-1.5 text-black/75">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: d.colorHex, boxShadow: `0 0 0 1px ${outlineFor(d.colorHex)}` }}
                      />
                      {d.departmentName}
                    </span>
                  ),
                  lead: d.leadName ?? <span className="text-amber-700">{L.vacant}</span>,
                  members: d.membersCount,
                  open: d.openTickets,
                  onTime: d.tally.onTime,
                  late: d.tally.late,
                  rate:
                    d.onTimeRate === null ? (
                      <span className="text-black/35">{L.noTicketsYet}</span>
                    ) : (
                      <span
                        className={`font-bold ${d.onTimeRate >= 80 ? "text-emerald-700" : d.onTimeRate >= 50 ? "text-amber-700" : "text-red-700"}`}
                      >
                        {d.onTimeRate}%
                      </span>
                    ),
                },
              }))}
            />
            <p className="mt-2 text-xs leading-relaxed text-black/50">{L.eachDepartmentCountsIts}</p>
          </section>
        )}

        {isLead && (
          <section>
            <h2 className="mb-1 text-base font-bold">{L.membersOf}{myDepartment?.name ?? L.yourDepartment}
            </h2>
            <p className="mb-3 text-xs text-black/45">{L.yourDepartmentSMembers}</p>
            <DataTable
              emptyLabel={L.noApprovedMembersIn}
              columns={[
                { key: "name", label: L.member, primary: true },
                { key: "title", label: L.title },
                { key: "open", label: L.openTicketsOnThem },
                { key: "raised", label: L.raised },
                { key: "warnings", label: L.warnings },
                { key: "joined", label: L.since },
              ]}
              rows={members.map((m) => ({
                id: m.memberId,
                cells: {
                  name: m.fullName,
                  title: m.jobTitle ?? L.member2,
                  open: m.openTickets,
                  raised: m.raisedTotal,
                  warnings:
                    m.warningsCount > 0 ? (
                      <span className="font-bold text-red-700">{m.warningsCount}</span>
                    ) : (
                      "0"
                    ),
                  joined: formatDate(m.joinedAt),
                },
              }))}
            />
          </section>
        )}

        <section>
          <h2 className="mb-1 text-base font-bold">
            {fmt(L.closedOnTime2, onTime.length)}</h2>
          <p className="mb-3 text-xs leading-relaxed text-black/45">
            {fmt(L.whatIsShownHere, TICKET_RETENTION_DAYS)}</p>
          <DataTable
            emptyLabel={L.noTicketsClosedOn}
            columns={[
              { key: "subject", label: L.subject, primary: true },
              { key: "number", label: L.number },
              { key: "dept", label: L.department },
              { key: "by", label: L.closedBy },
              { key: "at", label: L.closingDate },
            ]}
            rows={onTime.map((t) => ({
              id: t.id,
              cells: {
                subject: t.subject,
                number: `#${t.ticketNumber}`,
                dept: t.targetDepartment?.name ?? "—",
                by: t.resolvedByUser?.fullName ?? "—",
                at: t.resolvedAt ? formatDate(t.resolvedAt) : "—",
              },
            }))}
          />
        </section>

        <Card className="p-4 text-xs leading-relaxed text-black/50">{L.theFullRecordEvery}</Card>
      </main>
    </div>
  );
}
