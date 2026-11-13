import { PageHeader } from "@/components/PageHeader";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor } from "@/lib/brand";
import { TestEditor } from "../../../tests/TestEditor";
import { toQuestionViewModel, canEditDepartmentTrack, ensureMemberTrack } from "@/lib/testTracks";
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

  // بنكُ أسئلة القسم لقائده وحده — وقائدُ الإدارة العليا هو الرئيسُ التنفيذي (أو المؤسسُ بالخلافة).
  //
  // المؤسس والتنفيذي يملكان الهيكل: إنشاء القسم ولونه ودعوة قائده، وتصلهما تذاكره إن تأخّرت. أما
  // بنكُ أسئلة أعضائه فملكُ قائده — والاطّلاعُ عليه بلا سبب رقابةٌ لا تُحاسِب أحداً.
  const department = await prisma.department.findUnique({ where: { slug } });
  if (!department) notFound();
  if (!(await canEditDepartmentTrack(session, department))) {
    redirect(session.user.role === "super_admin" || session.user.role === "executive" ? "/admin/departments" : "/admin");
  }

  const track = await ensureMemberTrack(department.id);

  const theme = themeFromColor(department.colorHex);
  const t = getDictionary(await getLocale());

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-8">
        {/* الإدارةُ العليا لوحتُها «/senior» لا صفحةُ قسم */}
        <BackButton fallbackHref={department.leadershipOnly && !department.parentId ? "/senior" : `/admin/departments/${department.slug}`} />
        <PageHeader title={<>{t.testEditorPage.deptTitlePrefix} {department.name}</>} description={<>{t.testEditorPage.deptSubtitle}</>} />
        <TestEditor trackId={track.id} questions={track.questions.map(toQuestionViewModel)} theme={theme} />
      </main>
    </div>
  );
}
