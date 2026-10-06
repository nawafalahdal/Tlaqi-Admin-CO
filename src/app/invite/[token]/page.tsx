import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { ROLE_LABELS, toQuestionViewModel } from "@/lib/testTracks";
import { LogoLockup } from "@/components/Logo";
import { LocaleToggle } from "@/components/LocaleToggle";
import { InviteFlow } from "./InviteFlow";
import { getLocale, getDictionary } from "@/i18n";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { department: true, testTrack: { include: { questions: { orderBy: { order: "asc" } } } } },
  });

  const theme = themeFromColor(invite?.department?.colorHex ?? SUPER_ADMIN_THEME.colorHex);
  const t = getDictionary(await getLocale());

  const roleLabel = invite
    ? invite.department
      ? `${ROLE_LABELS[invite.targetRole]} — ${invite.department.name}`
      : ROLE_LABELS[invite.targetRole]
    : "";

  return (
    <main
      className="flex min-h-screen flex-col items-center px-4 py-10"
      style={{ background: theme.surface }}
    >
      <div className="mb-4 flex w-full max-w-lg justify-end">
        <LocaleToggle color={theme.accentDark} />
      </div>
      <div className="mb-8">
        <LogoLockup size={24} color={theme.accentDark} dotColor={theme.accentDark} />
      </div>

      <div className="w-full max-w-lg">
        {!invite ? (
          <StateCard theme={theme} title={t.invite.invalidLinkTitle} body={t.invite.invalidLinkBody} />
        ) : (
          <InviteFlow
            token={token}
            fullName={invite.fullName}
            email={invite.email}
            roleLabel={roleLabel}
            questions={invite.testTrack.questions.map(toQuestionViewModel)}
            theme={theme}
            initialStatus={invite.status}
          />
        )}
      </div>
    </main>
  );
}

function StateCard({
  theme,
  title,
  body,
}: {
  theme: ReturnType<typeof themeFromColor>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-xl">
      <h1 className="mb-2 text-lg font-bold" style={{ color: theme.accentDark }}>
        {title}
      </h1>
      <p className="text-sm text-black/60">{body}</p>
    </div>
  );
}
