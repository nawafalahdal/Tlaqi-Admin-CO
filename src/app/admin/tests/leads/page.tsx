import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { TestEditor } from "../TestEditor";
import { toQuestionViewModel } from "@/lib/testTracks";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function LeadsTestPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // بنك أسئلة قادة الأقسام يملكه المدير التنفيذي: هو من يقود هذه الطبقة
  // ويُحاسَب على اختيارها. والمؤسس لا يملكه — ملكيته له تجعل التنفيذي
  // منفّذاً لا مسؤولاً، وتُفرغ تسلسل المسؤولية من معناه.
  if (session.user.role !== "executive") redirect("/admin");

  const track = await prisma.testTrack.findFirstOrThrow({
    where: { scope: "department_admin" },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const t = getDictionary(await getLocale());

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName={t.admin.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-8">
        <BackButton />
        <PageHeader title={t.testEditorPage.leadsTitle} description={<>{t.testEditorPage.leadsSubtitle}</>} />
        <TestEditor trackId={track.id} questions={track.questions.map(toQuestionViewModel)} theme={theme} />
      </main>
    </div>
  );
}
