import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";
import { canCreateDepartment } from "@/lib/departments";
import { NewDepartmentForm } from "./NewDepartmentForm";
import { DepartmentColor } from "./DepartmentColor";

/** فهرس الأقسام وإنشاء قسم جديد.
 *
 *  كان الهيكل مزروعاً في قاعدة البيانات لا يُغيَّر إلا بسكربت. الآن
 *  يبنيه من يملك القرار التنظيمي من داخل المنصة. */
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

  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { members: true, admins: true } },
      testTracks: { include: { _count: { select: { questions: true } } } },
    },
  });

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={t.admin.founderRole} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton />
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

        <section className="flex flex-col gap-3">
          {departments.map((d) => {
            const memberTrack = d.testTracks.find((tr) => tr.scope === "department_member");
            const questionCount = memberTrack?._count.questions ?? 0;
            return (
              <Card key={d.id} className="p-4">
                <div className="flex items-start gap-4">
                  <span
                    className="h-11 w-11 shrink-0 rounded-2xl"
                    style={{ background: d.colorHex }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold">{d.name}</h2>
                    <p className="mt-0.5 text-xs text-black/45">
                      {td.membersCount}: {d._count.members} · {td.leadsCount}: {d._count.admins} ·{" "}
                      {td.questionsCount}: {questionCount}
                    </p>
                    {questionCount === 0 && (
                      <p className="mt-1 text-xs font-semibold text-[#9A2E1C]">{td.emptyTrack}</p>
                    )}
                  </div>
                </div>
                {canCreate && (
                  <div className="mt-3 border-t border-black/5 pt-3">
                    <DepartmentColor departmentId={d.id} current={d.colorHex} />
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
