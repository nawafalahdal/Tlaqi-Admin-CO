import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { TestEditor } from "../TestEditor";
import { toQuestionViewModel } from "@/lib/testTracks";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function OperationsTestPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") redirect("/admin");

  const t = getDictionary(await getLocale());

  const track = await prisma.testTrack.findFirstOrThrow({
    where: { scope: "operations_officer" },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader
        theme={theme}
        roleName={session.user.role === "super_admin" ? t.admin.founderRole : t.admin.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-8">
        <BackButton />
        <h1 className="mb-1 text-xl font-bold">{t.opsExtras.opsTestTitle}</h1>
        <p className="mb-6 text-sm text-black/50">{t.opsExtras.opsTestHint}</p>
        <TestEditor trackId={track.id} questions={track.questions.map(toQuestionViewModel)} theme={theme} />
      </main>
    </div>
  );
}
