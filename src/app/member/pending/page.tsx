import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ThemedLockup } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ControlGroup, ControlDivider } from "@/components/ControlGroup";
import { getLocale, getDictionary } from "@/i18n/server";

/** شاشة ما بعد الاختبار وقبل القرار — المرشّح دخل بحساب حقيقي، فلا يصح أن
 *  يرى بوابة العضو كاملة قبل اعتماده، ولا أن يُطرد لصفحة الدخول بلا تفسير. */
export default async function MemberPendingPage() {
  const session = await auth();
  if (!session || session.user.role !== "member") redirect("/login");

  const member = await prisma.member.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { department: true },
  });

  if (member.approvalStatus === "approved") redirect("/member");
  if (member.testStatus === "not_started") redirect("/member/test");

  const t = getDictionary(await getLocale());
  const failed = member.testStatus === "failed";

  return (
    <main
      className="auth-page flex min-h-screen flex-col items-center justify-center gap-6 px-4"
    >
      <ThemedLockup height={32} />
      <div className="w-full max-w-md auth-card rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <h1 className="mb-2 text-lg font-bold">
          {failed ? t.memberTest.failedPendingTitle : t.memberTest.pendingTitle}
        </h1>
        <p className="mb-1 text-sm text-black/60">
          {t.invite.scoreLabel}: {member.testScore}%
        </p>
        <p className="text-sm leading-relaxed text-black/60">
          {failed ? t.memberTest.failedPendingBody : t.memberTest.pendingBody}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
      <ControlGroup color="var(--ink)" label={t.ui.displayTools}>
        <ThemeToggle />
        <ControlDivider />
        <LocaleToggle />
      </ControlGroup>
        <LogoutButton color="var(--ink)" />
      </div>
    </main>
  );
}
