import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor } from "@/lib/brand";
import { AppHeader } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { TestEditor } from "../../../tests/TestEditor";
import { toQuestionViewModel } from "@/lib/testTracks";

export default async function DepartmentTestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session) redirect("/login");

  const isSuperAdmin = session.user.role === "super_admin";
  const isExecutive = session.user.role === "executive";
  const isOwnDept = session.user.role === "department_admin" && session.user.departmentSlug === slug;
  if (!isSuperAdmin && !isExecutive && !isOwnDept) redirect("/admin");

  const department = await prisma.department.findUnique({ where: { slug } });
  if (!department) notFound();

  const track = await prisma.testTrack.findUniqueOrThrow({
    where: { scope_departmentId: { scope: "department_member", departmentId: department.id } },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  const theme = themeFromColor(department.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={`أدمن ${department.name}`} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="mb-1 text-xl font-bold">اختبار قبول أعضاء {department.name}</h1>
        <p className="mb-6 text-sm text-black/50">الأسئلة التي يجتازها مرشحو هذا القسم</p>
        <TestEditor trackId={track.id} questions={track.questions.map(toQuestionViewModel)} theme={theme} />
      </main>
    </div>
  );
}
