import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor } from "@/lib/brand";
import { AppHeader } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { TestEditor } from "../../../tests/TestEditor";
import { toQuestionViewModel } from "@/lib/testTracks";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function DepartmentTestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session) redirect("/login");

  // لوحة القسم لقائده وحده.
  //
  // المؤسس والتنفيذي يملكان الهيكل: إنشاء القسم ولونه ودعوة قائده،
  // وتصلهما تذاكره إن تأخّرت. أما عمله اليومي وبيانات أعضائه وبنك
  // أسئلته فملك قائده — والاطّلاع عليه بلا سبب رقابةٌ لا تُحاسِب أحداً
  // وتُفرغ ملكية القائد من معناها.
  const isSuperAdmin = session.user.role === "super_admin";
  const isExecutive = session.user.role === "executive";
  const isOwnDept = session.user.role === "department_admin" && session.user.departmentSlug === slug;
  if (!isOwnDept) redirect(isSuperAdmin || isExecutive ? "/admin/departments" : "/admin");

  const department = await prisma.department.findUnique({ where: { slug } });
  if (!department) notFound();

  const track = await prisma.testTrack.findUniqueOrThrow({
    where: { scope_departmentId: { scope: "department_member", departmentId: department.id } },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  const theme = themeFromColor(department.colorHex);
  const t = getDictionary(await getLocale());

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={`${t.deptBoard.adminRolePrefix} ${department.name}`} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-8">
        <BackButton fallbackHref={`/admin/departments/${department.slug}`} />
        <h1 className="mb-1 text-xl font-bold">
          {t.testEditorPage.deptTitlePrefix} {department.name}
        </h1>
        <p className="mb-6 text-sm text-black/50">{t.testEditorPage.deptSubtitle}</p>
        {/* بنك أسئلة القسم يملكه قائده. الفاوندر يطّلع عليه ولا يعدّله:
            الاطّلاع رقابة، والتعديل تجاوزٌ على من يُحاسَب على نتيجته. */}
        {isSuperAdmin && (
          <div className="mb-5 rounded-2xl border border-black/10 bg-white px-4 py-3 text-xs leading-relaxed text-black/55">
            {t.testEditorPage.founderReadOnly}
          </div>
        )}
        <TestEditor
          trackId={track.id}
          questions={track.questions.map(toQuestionViewModel)}
          theme={theme}
          readOnly={isSuperAdmin}
        />
      </main>
    </div>
  );
}
