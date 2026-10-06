import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, BRAND } from "@/lib/brand";
import { LogoLockup } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { LocaleToggle } from "@/components/LocaleToggle";
import { toCandidateQuestion } from "@/lib/testTracks";
import { getLocale, getDictionary } from "@/i18n/server";
import { CandidateTest } from "./CandidateTest";

export default async function MemberTestPage() {
  const session = await auth();
  if (!session || session.user.role !== "member") redirect("/login");

  // المرحلة تُقرأ من قاعدة البيانات لا من الجلسة: رمز الجلسة يُلتقط لحظة
  // الدخول، فيبقى "لم يختبر" حتى بعد تسليم الاختبار ويحبس صاحبه في حلقة
  const member = await prisma.member.findUniqueOrThrow({
    where: { id: session.user.id },
    include: {
      department: true,
      invite: { include: { testTrack: { include: { questions: { orderBy: { order: "asc" } } } } } },
    },
  });

  if (member.approvalStatus === "approved") redirect("/member");
  if (member.testStatus !== "not_started") redirect("/member/pending");

  const t = getDictionary(await getLocale());
  const theme = themeFromColor(member.department?.colorHex ?? BRAND.temptress);
  const roleLabel = member.department
    ? `${t.roles[member.invite.targetRole]} — ${member.department.name}`
    : t.roles[member.invite.targetRole];

  return (
    <main
      className="flex min-h-screen flex-col items-center px-4 py-8"
      style={{ background: theme.surface }}
    >
      <div className="mb-6 flex w-full max-w-xl items-center justify-between gap-3">
        <LogoLockup size={22} color={theme.accentDark} dotColor={theme.accentDark} />
        <div className="flex flex-wrap items-center gap-2">
          <LocaleToggle color={theme.accentDark} />
          <LogoutButton color={theme.accentDark} />
        </div>
      </div>

      <div className="w-full max-w-xl">
        <div className="mb-5 text-center">
          <h1 className="text-lg font-bold sm:text-xl">
            {t.memberTest.welcome} {member.fullName}
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-black/60">{t.memberTest.intro}</p>
        </div>

        <CandidateTest
          roleLabel={roleLabel}
          questions={member.invite.testTrack.questions.map(toCandidateQuestion)}
          theme={theme}
        />
      </div>
    </main>
  );
}
