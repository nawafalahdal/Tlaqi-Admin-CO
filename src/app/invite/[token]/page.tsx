import { prisma } from "@/lib/prisma";
import { themeFromColor } from "@/lib/brand";
import { LogoLockup } from "@/components/Logo";
import { InviteFlow } from "./InviteFlow";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { department: true },
  });

  const theme = themeFromColor(invite?.department.colorHex ?? "#341D2B");

  return (
    <main
      className="flex min-h-screen flex-col items-center px-4 py-10"
      style={{ background: theme.surface }}
    >
      <div className="mb-8">
        <LogoLockup size={24} color={theme.accentDark} dotColor={theme.accentDark} />
      </div>

      <div className="w-full max-w-lg">
        {!invite ? (
          <StateCard theme={theme} title="الرابط غير صحيح" body="تعذّر العثور على دعوة بهذا الرابط." />
        ) : (
          <InviteFlow
            token={token}
            fullName={invite.fullName}
            email={invite.email}
            departmentName={invite.department.name}
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
