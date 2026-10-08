import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";
import { ROLE_LABELS, accountRoleLabel } from "@/lib/testTracks";
import { formatDate } from "@/lib/format";
import { AdminProfileForm } from "./ProfileForm";
import { WelcomeMailCard } from "@/components/WelcomeMailCard";
import { SecurityGuidance } from "@/components/SecurityGuidance";
import { GovernanceCharter } from "@/components/GovernanceCharter";

/** بيانات صاحب الحساب الإداري.
 *
 *  كان العضو يسجّل بياناته كاملة قبل اختباره بينما الحسابات الإدارية —
 *  الفاوندر والتنفيذي والمشغّل وقادة الأقسام — بلا سجلّ إلا اسم وبريد.
 *  اللقب لا يُغني عن السجلّ: من يقود الفريق جزءٌ منه. */
export default async function AdminProfilePage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === "member") redirect("/member");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { department: true },
  });

  const t = getDictionary(await getLocale());
  const tp = t.adminProfile;
  const theme = themeFromColor(user.department?.colorHex ?? SUPER_ADMIN_THEME.colorHex);
  const roleLabel = accountRoleLabel(user.role);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={roleLabel} userName={user.fullName}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton />
          <h1 className="text-lg font-bold sm:text-xl">{tp.title}</h1>
          <p className="mt-1 text-sm text-black/50">{tp.subtitle}</p>
        </div>

        {/* الهوية: تُعرض ولا تُعدَّل من هنا */}
        <Card className="p-4 sm:p-5">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label={tp.email} value={user.email} ltr />
            <Row label={tp.role} value={roleLabel} />
            <Row label={tp.department} value={user.department?.name ?? "—"} />
            <Row
              label={tp.since}
              value={formatDate(user.createdAt)}
            />
            <Row
              label={tp.completedAt}
              value={user.profileCompletedAt ? formatDate(user.profileCompletedAt) : tp.notCompleted}
            />
          </dl>
          <p className="mt-3 border-t border-black/5 pt-3 text-xs text-black/40">{tp.identityNote}</p>
        </Card>

        {/* البريد الترحيبي ودليل الحماية: كلاهما يخصّ صاحب الحساب وحده،
            فموضعهما صفحته لا صفحة من يديره */}
        <WelcomeMailCard
          theme={theme}
          sentAt={user.welcomeEmailSentAt ? formatDate(user.welcomeEmailSentAt) : null}
          count={user.welcomeEmailCount}
        />

        <SecurityGuidance theme={theme} totpEnabled={user.totpEnabled} />

        <GovernanceCharter theme={theme} />

        <Card className="p-4 sm:p-5">
          <h2 className="text-base font-bold">{tp.formTitle}</h2>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-black/45">{tp.formHint}</p>
          <AdminProfileForm
            theme={theme}
            defaults={{
              fullName: user.fullName,
              phone: user.phone ?? "",
              jobTitle: user.jobTitle ?? "",
              specialization: user.specialization ?? "",
              section: user.section ?? "",
            }}
          />
        </Card>
      </main>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-black/40">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${ltr ? "break-all" : ""}`} dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}
