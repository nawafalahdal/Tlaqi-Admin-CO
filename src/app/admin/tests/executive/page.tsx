import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { TestEditor } from "../TestEditor";
import { toQuestionViewModel } from "@/lib/testTracks";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function ExecutiveTestPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin") redirect("/admin");

  const track = await prisma.testTrack.findFirstOrThrow({
    where: { scope: "executive" },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const t = getDictionary(await getLocale());

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-8">
        <BackButton />
        <PageHeader title={t.testEditorPage.execTitle} description={<>{t.testEditorPage.execSubtitle}</>} />
        <TestEditor trackId={track.id} questions={track.questions.map(toQuestionViewModel)} theme={theme} />
      </main>
    </div>
  );
}
