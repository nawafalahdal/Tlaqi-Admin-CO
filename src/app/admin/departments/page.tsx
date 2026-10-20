import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { getLocale, getDictionary } from "@/i18n/server";
import {
  canCreateDepartment,
  canDeleteDepartment,
  canDecideDepartmentRequest,
  departmentNeedsApproval,
  deleteBlockers,
  pendingDepartmentRequests,
} from "@/lib/departments";
import { NewDepartmentForm } from "./NewDepartmentForm";
import { DepartmentColor } from "./DepartmentColor";
import { DeleteDepartment } from "./DeleteDepartment";
import { CommitteeRequests } from "./CommitteeRequests";
import { DepartmentRequests } from "./DepartmentRequests";
import { canDecideCommittee, pendingCommittees, committeeLeadTitle } from "@/lib/committees";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { SENIOR_ROLES, seniorDepartment } from "@/lib/seniorAffiliation";
import { formatDate } from "@/lib/format";

/** فهرس الأقسام — صفحةُ حوكمة الهيكل.
 *
 *  تُقرأ من أعلى إلى أسفل كما يُتَّخذ القرار: خلاصةٌ بالأرقام، ثم ما
 *  ينتظر قرارك (طلباتُ الأقسام للمؤسس، واقتراحاتُ اللجان للتنفيذي)، ثم
 *  الأقسامُ شجرةً كالهيكل: كلُّ قسمٍ بلونه وقائده وعدد أعضائه.
 *
 *  **ولا زرَّ حذفٍ لقسمٍ فيه أحد** (قرار المؤسس): يُقرأ ما يحمله القسم
 *  بالشروط نفسها التي يفرضها الخادم (`deleteBlockers`)، فلا يظهر الزرّ
 *  إلا لقسمٍ فارغٍ تماماً — والخادمُ يرفض الحذفَ ولو طُلب بغير الزرّ. */

// شارةُ «الإدارة العليا» ببنفسجها، ومفتوحةً في الداكن ليُرى (`liftForDark`)
// — وحبرُها حبرُ ذلك السطح لا أبيضُ ثابت يذوب على البيج
const SENIOR_THEME = themeFromColor("#341D2B");

export default async function DepartmentsIndexPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === "member") redirect("/member");
  if (session.user.role === "department_admin" && session.user.departmentSlug) {
    redirect(`/admin/departments/${session.user.departmentSlug}`);
  }

  const t = getDictionary(await getLocale());
  const td = t.deptAdmin;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const role = session.user.role;
  const canCreate = canCreateDepartment(role);
  const canDelete = canDeleteDepartment(role);
  const canDecide = canDecideCommittee(role);
  const canDecideDepartments = canDecideDepartmentRequest(role);

  const [departments, pending, deptRequests, senior, ceo, opsCount, seniorPeople, holdings] = await Promise.all([
    // department-scope: all — صفحةُ الحوكمة: تُعرَض فيها المقترحةُ والمردودة
    prisma.department.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { members: { where: ROSTER_MEMBER_WHERE } } },
        admins: {
          where: { isActive: true, role: "department_admin" },
          select: { fullName: true },
          orderBy: { createdAt: "asc" },
          take: 3,
        },
        testTracks: { include: { _count: { select: { questions: true } } } },
        parent: { select: { id: true, name: true } },
      },
    }),
    // الطابورُ يُقرأ لمن يقرّر وحده: قراءةٌ لا تُجرى لمن لا يملكها
    canDecide ? pendingCommittees() : Promise.resolve([]),
    canDecideDepartments ? pendingDepartmentRequests() : Promise.resolve([]),
    seniorDepartment(),
    // الإدارة العليا يقودها الرئيس التنفيذي، وأعضاؤها مسؤولو التشغيل ومن
    // أُضيف إليها — بالحساب نفسه الذي في التقارير (`departmentReport`)
    prisma.user.findFirst({
      where: { role: "executive", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { fullName: true },
    }),
    prisma.user.count({ where: { role: "operations_officer", isActive: true } }),
    prisma.user.count({ where: { role: { in: [...SENIOR_ROLES] }, isActive: true } }),
    // ما يحمله كلُّ قسم — كلُّه لا النشطُ وحده، كما يعدّه الخادم عند الحذف
    canDelete
      ? // department-scope: all — يُطابَق كلُّ صفٍّ معروض بما يمنع حذفه
        prisma.department.findMany({
          select: {
            id: true,
            _count: {
              select: {
                admins: true,
                members: true,
                invites: true,
                tickets: true,
                requests: true,
                signatures: true,
                committees: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const holdingsOf = new Map(holdings.map((h) => [h.id, h._count]));

  /** الأقسامُ الأصيلة أولاً، وكلُّ لجنةٍ تحت أبيها مباشرةً — فتُقرأ
   *  الصفحةُ شجرةً كالهيكل. والإدارة العليا أولُ الأقسام كما في الهيكل.
   *
   *  والمقترحةُ والمردودةُ تُعرضان هنا أيضاً لمن يملك الهيكل: هذه صفحةُ
   *  الحوكمة لا قائمةَ وجهات — وإخفاءُ المردودة يجعل طلباً مُعاداً يبدو
   *  جديداً. */
  const roots = departments
    .filter((d) => !d.parentId)
    .sort((a, b) => Number(b.id === senior?.id) - Number(a.id === senior?.id));
  const childrenOf = (id: string) => departments.filter((d) => d.parentId === id);
  const ordered = roots.flatMap((root) => {
    const kids = childrenOf(root.id).flatMap((kid) => [
      { row: kid, depth: 1 },
      ...childrenOf(kid.id).map((g) => ({ row: g, depth: 2 })),
    ]);
    return [{ row: root, depth: 0 }, ...kids];
  });

  const isOpen = (d: (typeof departments)[number]) => d.committeeStatus === null || d.committeeStatus === "approved";
  const membersOf = (d: (typeof departments)[number]) => d._count.members + (d.id === senior?.id ? opsCount : 0);
  const openRows = departments.filter(isOpen);
  const stats = [
    { label: td.statDepartments, value: openRows.filter((d) => !d.parentId).length },
    { label: td.statCommittees, value: openRows.filter((d) => d.parentId).length },
    { label: td.statPeople, value: openRows.reduce((n, d) => n + membersOf(d), 0) },
    { label: td.statPending, value: departments.filter((d) => d.committeeStatus === "pending_review").length },
  ];
  const hasDecisions = deptRequests.length > 0 || pending.length > 0;

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName={t.admin.founderRole} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={td.title} description={<>{td.subtitle}</>} />

        {/* الخلاصةُ بالأرقام: المفتوحُ وحده، والمنتظِرُ عدّاً مستقلاً */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-3.5">
              <p className="text-2xl font-bold leading-none">{s.value}</p>
              <p className="mt-1.5 text-xs text-black/45">{s.label}</p>
            </Card>
          ))}
        </div>

        {canCreate && (
          <Card className="p-4 sm:p-5">
            <NewDepartmentForm theme={theme} requestMode={departmentNeedsApproval(role)} />
          </Card>
        )}

        {/* ما ينتظر قرارك — لا يظهر القسمُ إلا حين يكون فيه ما يُقرَّر */}
        {hasDecisions && (
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-bold sm:text-lg">{td.pendingSection}</h2>
            {deptRequests.length > 0 && (
              <Card className="p-4 sm:p-5">
                <h3 className="mb-1 text-sm font-bold">
                  {td.requestsTitle} ({deptRequests.length})
                </h3>
                <p className="mb-3 text-xs leading-relaxed text-black/50">{td.requestsHint}</p>
                <DepartmentRequests
                  theme={theme}
                  requests={deptRequests.map((r) => ({
                    id: r.id,
                    name: r.name,
                    colorHex: r.colorHex,
                    leadershipOnly: r.leadershipOnly,
                    requestedByName: r.requestedByName,
                    requestedAt: r.requestedAt ? formatDate(r.requestedAt) : null,
                  }))}
                />
              </Card>
            )}
            {pending.length > 0 && (
              <Card className="p-4 sm:p-5">
                <h3 className="mb-1 text-sm font-bold">اقتراحات اللجان ({pending.length})</h3>
                <p className="mb-3 text-xs leading-relaxed text-black/50">
                  اللجنة قسمٌ داخل قسم: يقترحها قائدُ القسم بلونها ومسمّى قائدها، وتُفتح باعتمادك —
                  فيصير لها بنكُ أسئلة، وتظهر في الهيكل فرعاً داخل أبيها، ويدعو قائدُ القسم قيادتَها.
                </p>
                <CommitteeRequests
                  theme={theme}
                  requests={pending.map((p) => ({
                    id: p.id,
                    name: p.name,
                    colorHex: p.colorHex,
                    leadTitle: p.leadTitle,
                    requestedByName: p.requestedByName,
                    parentName: p.parent?.name ?? "—",
                    parentColorHex: p.parent?.colorHex ?? "#341D2B",
                  }))}
                />
              </Card>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-bold sm:text-lg">{td.listTitle}</h2>
            {/* حدُّ الصلاحية مكتوبٌ لا مفترَض، وحدُّ الحذف كذلك */}
            <p className="mt-1 text-xs leading-relaxed text-black/50">{td.scopeNote}</p>
            {canDelete && <p className="mt-1 text-xs leading-relaxed text-black/50">{td.deleteGuardNote}</p>}
          </div>

          {ordered.map(({ row: d, depth }) => {
            const memberTrack = d.testTracks.find((tr) => tr.scope === "department_member");
            const questionCount = memberTrack?._count.questions ?? 0;
            const isCommittee = Boolean(d.parentId);
            const isSenior = d.id === senior?.id;
            const leadNames = isSenior ? (ceo ? [ceo.fullName] : []) : d.admins.map((a) => a.fullName);
            const held = holdingsOf.get(d.id);
            const deletable =
              canDelete && held !== undefined && deleteBlockers(held, isSenior ? seniorPeople : 0).length === 0;
            return (
              <Card
                key={d.id}
                className="p-4"
                // الإزاحةُ تُقرأ تبعيةً: اللجنةُ تحت أبيها لا بجانبه
                style={depth > 0 ? { marginInlineStart: `${depth * 1.5}rem` } : undefined}
              >
                <div className="flex items-start gap-4">
                  {/* حلقةٌ رقيقةٌ حول اللون: القسمُ الداكنُ يبقى مرئياً في
                      الداكن دون أن يتغيّر لونُه */}
                  <span
                    className="h-11 w-11 shrink-0 rounded-2xl ring-1 ring-inset ring-black/10"
                    style={{ background: d.colorHex }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold">{isCommittee ? `لجنة ${d.name}` : d.name}</h3>
                      {isCommittee && (
                        <span
                          className="rounded-full border border-dashed px-2.5 py-0.5 text-[11px] font-bold"
                          style={{
                            background: `${d.colorHex}1F`,
                            borderColor: `${d.colorHex}99`,
                            // لونُ القسم خامٌّ قد يَعمى على سطحٍ داكن —
                            // فالحبرُ يتبع السمة لا اللونَ وحده
                            color: `light-dark(${d.colorHex}, var(--ink))`,
                          }}
                        >
                          داخل {d.parent?.name ?? "—"}
                        </span>
                      )}
                      {d.committeeStatus === "pending_review" && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
                          {isCommittee ? "بانتظار الاعتماد" : td.statusPendingFounder}
                        </span>
                      )}
                      {d.committeeStatus === "rejected" && (
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
                          {isCommittee ? "لم تُعتمد" : td.statusRejected}
                        </span>
                      )}
                      {d.leadershipOnly && (
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                          style={{ background: SENIOR_THEME.fill, color: SENIOR_THEME.onFill }}
                        >
                          {td.exceptionalBadge}
                        </span>
                      )}
                    </div>

                    {/* القائدُ باسمه لا بعدده — والإدارة العليا يقودها
                        الرئيس التنفيذي، وأعضاؤها مسؤولو التشغيل ومن أُضيف */}
                    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <div className="flex gap-1">
                        <dt className="text-black/45">{isSenior ? td.seniorLeadLabel : td.leadLabel}:</dt>
                        <dd className="font-semibold text-black/75">
                          {leadNames.length > 0 ? leadNames.join("، ") : td.noLead}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="text-black/45">{td.membersCount}:</dt>
                        <dd className="font-semibold text-black/75">{membersOf(d)}</dd>
                      </div>
                      {/* القسم الاستثنائي بلا بنك أسئلة، فعرض عدّاده صفراً
                          يوحي بنقصٍ ليس فيه */}
                      {!d.leadershipOnly && isOpen(d) && (
                        <div className="flex gap-1">
                          <dt className="text-black/45">{td.questionsCount}:</dt>
                          <dd className="font-semibold text-black/75">{questionCount}</dd>
                        </div>
                      )}
                    </dl>

                    {isCommittee && (
                      <p className="mt-1 text-xs text-black/40">مسمّى قائدها: {committeeLeadTitle(d.name, d.leadTitle)}</p>
                    )}
                    {/* ما بُني بطلبٍ يبقى منسوباً: من طلبه، ومن اعتمده */}
                    {!isCommittee && d.requestedByName && (
                      <p className="mt-1 text-xs text-black/40">
                        {td.requestedBy}: {d.requestedByName}
                        {d.committeeStatus === null && d.decidedByName ? ` · ${td.approvedBy}: ${d.decidedByName}` : ""}
                      </p>
                    )}
                    {d.decisionNote && (
                      <p className="mt-1 text-xs text-black/40">
                        {td.decisionNoteLabel}: {d.decisionNote}
                      </p>
                    )}
                    {/* ما لم يُفتح بعد بلا بنكٍ — وذاك حالُه قبل الفتح لا
                        نقصٌ يُنذَر به */}
                    {questionCount === 0 && !d.leadershipOnly && isOpen(d) && (
                      <p className="mt-1 text-xs font-semibold text-[#9A2E1C]">{td.emptyTrack}</p>
                    )}
                  </div>
                </div>
                {(canCreate || deletable) && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-black/5 pt-3">
                    {canCreate && <DepartmentColor departmentId={d.id} current={d.colorHex} />}
                    {/* الحذف للمؤسس وحده، ولقسمٍ فارغٍ تماماً — والخادم يفرضهما */}
                    {deletable && <DeleteDepartment departmentId={d.id} departmentName={d.name} theme={theme} />}
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      </main>
    </div>
  );
}
