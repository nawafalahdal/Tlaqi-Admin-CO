import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, BRAND } from "@/lib/brand";
import { LogoLockup } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { LocaleToggle } from "@/components/LocaleToggle";
import { getLocale, getDictionary } from "@/i18n/server";
import { ProfileForm } from "./ProfileForm";

/** أول شاشة يراها المدعوّ بعد دخوله.
 *
 *  ترحّب به وتقول له صراحةً لأي قسم دُعي وبأي صفة — قبل هذه الشاشة كان
 *  يدخل مباشرة إلى أسئلة لا يعرف لأي دور يُختبر فيها. ثم تأخذ بياناته
 *  وتسجّلها، فيبدأ الاختبار ونحن نعرف من هو. */
export default async function WelcomePage() {
  const session = await auth();
  if (!session || session.user.role !== "member") redirect("/login");

  const member = await prisma.member.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { department: true, invite: true },
  });

  if (member.approvalStatus === "approved") redirect("/member");
  if (member.profileCompletedAt) {
    redirect(member.testStatus === "not_started" ? "/member/test" : "/member/pending");
  }

  const t = getDictionary(await getLocale());
  const theme = themeFromColor(member.department?.colorHex ?? BRAND.temptress);
  const roleLabel = t.roles[member.invite.targetRole];

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

      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-bold" style={{ color: theme.accentDark }}>
          {t.welcome.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-black/60">
          {t.welcome.intro.replace("{name}", member.fullName)}
        </p>

        {/* الدور والقسم بارزان: المدعوّ يجب أن يعرف لأي موقع يُختبر */}
        <div
          className="mt-5 rounded-2xl p-4"
          style={{ background: theme.surface, border: `1px solid ${theme.border}` }}
        >
          <p className="text-xs text-black/45">{t.welcome.invitedAs}</p>
          <p className="mt-1 text-base font-bold" style={{ color: theme.accentDark }}>
            {member.department ? `${member.department.name} — ${roleLabel}` : roleLabel}
          </p>
        </div>

        <div className="mt-6 border-t border-black/5 pt-6">
          <h2 className="text-base font-bold">{t.welcome.formTitle}</h2>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-black/45">{t.welcome.formHint}</p>
          <ProfileForm
            theme={theme}
            defaults={{
              fullName: member.fullName,
              email: member.email,
              phone: member.phone ?? "",
              jobTitle: member.jobTitle ?? "",
            }}
          />
        </div>
      </div>
    </main>
  );
}
