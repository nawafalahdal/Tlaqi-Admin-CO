import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { DataTable } from "@/components/DataTable";
import { formatDate } from "@/lib/format";
import { departmentsReport, membersReport, closedOnTimeTickets } from "@/lib/reports";
import { TICKET_RETENTION_DAYS } from "@/lib/retention";
import { outlineFor } from "@/lib/orgChart";

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
  const session = await auth();
  if (!session) redirect("/login");
  const role = session.user.role;
  if (role === "member") redirect("/member");

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
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
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName="التقارير" userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton />
          <h1 className="text-lg font-bold sm:text-xl">التقارير</h1>
          <p className="mt-1 text-sm leading-relaxed text-black/50">
            {seesDepartments
              ? "ملخّص الأقسام وقادتها، والتذاكر التي أُغلقت في موعدها."
              : "ملخّص أعضاء قسمك، والتذاكر التي أُغلقت في موعدها."}
            {" "}
            والأرقام تُعَدّ لحظة الإغلاق فتبقى بعد أرشفة التذاكر إلى الإكسل.
          </p>
        </div>

        {seesDepartments && (
          <section>
            <h2 className="mb-3 text-base font-bold">ملخّص القادة والأقسام</h2>
            <DataTable
              emptyLabel="لا أقسام بعد"
              columns={[
                { key: "dept", label: "القسم", primary: true },
                { key: "lead", label: "القائد" },
                { key: "members", label: "الأعضاء" },
                { key: "open", label: "تذاكر مفتوحة" },
                { key: "onTime", label: "أُغلقت في موعدها" },
                { key: "late", label: "متأخّرة" },
                { key: "rate", label: "نسبة الالتزام" },
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
                  lead: d.leadName ?? <span className="text-amber-700">شاغر</span>,
                  members: d.membersCount,
                  open: d.openTickets,
                  onTime: d.tally.onTime,
                  late: d.tally.late,
                  rate:
                    d.onTimeRate === null ? (
                      <span className="text-black/35">لا تذاكر بعد</span>
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
          </section>
        )}

        {isLead && (
          <section>
            <h2 className="mb-1 text-base font-bold">
              أعضاء {myDepartment?.name ?? "قسمك"}
            </h2>
            <p className="mb-3 text-xs text-black/45">
              أعضاء قسمك وحدهم — ولا تُقرأ من هنا أقسامٌ أخرى.
            </p>
            <DataTable
              emptyLabel="لا أعضاء معتمدين في قسمك بعد"
              columns={[
                { key: "name", label: "العضو", primary: true },
                { key: "title", label: "المسمّى" },
                { key: "open", label: "تذاكر مفتوحة عليه" },
                { key: "raised", label: "رفعها" },
                { key: "warnings", label: "تنبيهات" },
                { key: "joined", label: "منذ" },
              ]}
              rows={members.map((m) => ({
                id: m.memberId,
                cells: {
                  name: m.fullName,
                  title: m.jobTitle ?? "عضو",
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
            أُغلقت في موعدها ({onTime.length})
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-black/45">
            المعروض هنا ما لم يُؤرشَف بعد — التذكرة تبقى {TICKET_RETENTION_DAYS} أيام بعد إغلاقها
            ثم تنتقل إلى الإكسل ليلة السبت. وعددُها الكلّي في عمود «أُغلقت في موعدها» أعلاه.
          </p>
          <DataTable
            emptyLabel="لا تذاكر مُغلقة في موعدها ضمن الأسبوع الجاري"
            columns={[
              { key: "subject", label: "الموضوع", primary: true },
              { key: "number", label: "الرقم" },
              { key: "dept", label: "القسم" },
              { key: "by", label: "أغلقها" },
              { key: "at", label: "تاريخ الإغلاق" },
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

        <Card className="p-4 text-xs leading-relaxed text-black/50">
          السجلّ الكامل — كلُّ تذكرة بموضوعها وردّها ومن أغلقها ومتى، ولو أُرشفت من المنصة —
          في ملفّ الإكسل المرجعي. والمنصة شاشةُ عملٍ لا أرشيف.
        </Card>
      </main>
    </div>
  );
}
