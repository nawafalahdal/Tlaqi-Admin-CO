import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader } from "@/components/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { TestEditor } from "../TestEditor";
import { toQuestionViewModel } from "@/lib/testTracks";

export default async function LeadsTestPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const track = await prisma.testTrack.findFirstOrThrow({
    where: { scope: "department_admin" },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader
        theme={theme}
        roleName={session.user.role === "super_admin" ? "الفاونڈر — الإدارة العليا" : "الإدارة التنفيذية (CEO)"}
        userName={session.user.name ?? ""}
      >
        <LogoutButton color={theme.text} />
      </AppHeader>
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="mb-1 text-xl font-bold">اختبار قادة الأقسام</h1>
        <p className="mb-6 text-sm text-black/50">الأسئلة التي يجتازها مرشحو قيادة أي قسم</p>
        <TestEditor trackId={track.id} questions={track.questions.map(toQuestionViewModel)} theme={theme} />
      </main>
    </div>
  );
}
