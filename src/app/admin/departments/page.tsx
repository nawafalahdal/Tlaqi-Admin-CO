import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { getLocale, getDictionary } from "@/i18n/server";
import { canCreateDepartment, canDeleteDepartment } from "@/lib/departments";
import { NewDepartmentForm } from "./NewDepartmentForm";
import { DepartmentColor } from "./DepartmentColor";
import { DeleteDepartment } from "./DeleteDepartment";
import { CommitteeRequests } from "./CommitteeRequests";
import { canDecideCommittee, pendingCommittees, committeeLeadTitle } from "@/lib/committees";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";

/** فهرس الأقسام وإنشاء قسم جديد.
 *
 *  كان الهيكل مزروعاً في قاعدة البيانات لا يُغيَّر إلا بسكربت. الآن
 *  يبنيه من يملك القرار التنظيمي من داخل المنصة. */

// شارةُ «الإدارة العليا» ببنفسجها، ومفتوحاً في الداكن ليُرى (`liftForDark`)
const SENIOR_FILL = themeFromColor("#341D2B").fill;

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
  const canCreate = canCreateDepartment(session.user.role);
  const canDelete = canDeleteDepartment(session.user.role);

  const canDecide = canDecideCommittee(session.user.role);

  const [departments, pending] = await Promise.all([
    // department-scope: all — صفحةُ الحوكمة: تُعرَض فيها المقترحةُ والمردودة
    prisma.department.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { members: { where: ROSTER_MEMBER_WHERE }, admins: { where: { isActive: true } } } },
        testTracks: { include: { _count: { select: { questions: true } } } },
        parent: { select: { id: true, name: true } },
      },
    }),
    // الطابورُ يُقرأ لمن يقرّر وحده: قراءةٌ لا تُجرى لمن لا يملكها
    canDecide ? pendingCommittees() : Promise.resolve([]),
  ]);

  /** الأقسامُ الأصيلة أولاً، وكلُّ لجنةٍ تحت أبيها مباشرةً — فتُقرأ
   *  الصفحةُ شجرةً كالهيكل، لا قائمةً تُخالفه.
   *
   *  والمقترحةُ والمردودةُ تُعرضان هنا أيضاً لمن يملك الهيكل: هذه صفحةُ
   *  الحوكمة لا قائمةَ وجهات — وإخفاءُ المردودة يجعل اقتراحاً مُعاداً
   *  يبدو جديداً. */
  const roots = departments.filter((d) => !d.parentId);
  const childrenOf = (id: string) => departments.filter((d) => d.parentId === id);
  const ordered = roots.flatMap((root) => {
    const kids = childrenOf(root.id).flatMap((kid) => [
      { row: kid, depth: 1 },
      ...childrenOf(kid.id).map((g) => ({ row: g, depth: 2 })),
    ]);
    return [{ row: root, depth: 0 }, ...kids];
  });

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName={t.admin.founderRole} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <h1 className="text-lg font-bold sm:text-xl">{td.title}</h1>
          <p className="mt-1 text-sm text-black/50">{td.subtitle}</p>
        </div>

        {canCreate && (
          <Card className="p-4 sm:p-5">
            <NewDepartmentForm theme={theme} />
          </Card>
        )}

        {/* حدّ الصلاحية مكتوب لا مفترَض */}
        <Card className="p-4 text-xs leading-relaxed text-black/50">{td.scopeNote}</Card>

        {canDecide && (
          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-bold">اقتراحات اللجان ({pending.length})</h2>
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

        <section className="flex flex-col gap-3">
          {ordered.map(({ row: d, depth }) => {
            const memberTrack = d.testTracks.find((tr) => tr.scope === "department_member");
            const questionCount = memberTrack?._count.questions ?? 0;
            const isCommittee = Boolean(d.parentId);
            return (
              <Card
                key={d.id}
                className="p-4"
                // الإزاحةُ تُقرأ تبعيةً: اللجنةُ تحت أبيها لا بجانبه
                style={depth > 0 ? { marginInlineStart: `${depth * 1.5}rem` } : undefined}
              >
                <div className="flex items-start gap-4">
                  <span
                    className="h-11 w-11 shrink-0 rounded-2xl"
                    style={{ background: d.colorHex }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold">
                        {isCommittee ? `لجنة ${d.name}` : d.name}
                      </h2>
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
                      {isCommittee && d.committeeStatus === "pending_review" && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
                          بانتظار الاعتماد
                        </span>
                      )}
                      {isCommittee && d.committeeStatus === "rejected" && (
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
                          لم تُعتمد
                        </span>
                      )}
                      {d.leadershipOnly && (
                        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-[#FDFBF6]" style={{ background: SENIOR_FILL }}>
                          {td.exceptionalBadge}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-black/45">
                      {td.membersCount}: {d._count.members} · {td.leadsCount}: {d._count.admins}
                      {/* القسم الاستثنائي بلا بنك أسئلة، فعرض عدّاده صفراً
                          يوحي بنقصٍ ليس فيه */}
                      {!d.leadershipOnly && ` · ${td.questionsCount}: ${questionCount}`}
                    </p>
                    {isCommittee && (
                      <p className="mt-0.5 text-xs text-black/40">
                        مسمّى قائدها: {committeeLeadTitle(d.name, d.leadTitle)}
                        {d.decisionNote ? ` · ملاحظة القرار: ${d.decisionNote}` : ""}
                      </p>
                    )}
                    {/* اللجنةُ التي لم تُعتمد بلا بنكٍ بعد — وذاك ليس نقصاً
                        يُنذَر به، بل حالُها قبل الفتح */}
                    {questionCount === 0 &&
                      !d.leadershipOnly &&
                      (!isCommittee || d.committeeStatus === "approved") && (
                        <p className="mt-1 text-xs font-semibold text-[#9A2E1C]">{td.emptyTrack}</p>
                      )}
                  </div>
                </div>
                {(canCreate || canDelete) && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-black/5 pt-3">
                    {canCreate && <DepartmentColor departmentId={d.id} current={d.colorHex} />}
                    {/* الحذف للمؤسس وحده — والخادم يفرضه، وهذا موضعه */}
                    {canDelete && (
                      <DeleteDepartment departmentId={d.id} departmentName={d.name} theme={theme} />
                    )}
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
