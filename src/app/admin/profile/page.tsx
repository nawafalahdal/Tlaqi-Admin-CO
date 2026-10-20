import { redirect } from "next/navigation";
import { avatarUrl } from "@/lib/avatarUrl";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { AvatarUpload } from "@/components/AvatarUpload";
import { getLocale, getDictionary } from "@/i18n/server";
import { accountRoleLabel } from "@/lib/testTracks";
import { formatDate } from "@/lib/format";
import { AdminProfileForm } from "./ProfileForm";
import { seniorDepartment, affiliationFor } from "@/lib/seniorAffiliation";
import { PageHeader } from "@/components/PageHeader";
import { avatarHasTransparency } from "@/lib/avatars";
import { WELCOME_MAX_SENDS, RESENDER_LABEL, resenderRoleFor } from "@/lib/welcomeResend";
import { WelcomeMailCard } from "@/components/WelcomeMailCard";
import { PersonAvatar } from "@/components/PersonAvatar";
import { portraitColorFor } from "@/lib/portraitTone";
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

  // المؤسس والتنفيذي ومسؤول التشغيل من الإدارة العليا بدورهم — `seniorAffiliation`.
  // فلا يُسأل أحدهم عن قسمه، وكان المؤسس يُسجّله بنفسه هنا مرّة.
  const shownDepartment = affiliationFor(user.role, user.department, await seniorDepartment());

  const t = getDictionary(await getLocale());
  const tp = t.adminProfile;
  const theme = themeFromColor(user.department?.colorHex ?? SUPER_ADMIN_THEME.colorHex);
  const roleLabel = accountRoleLabel(user.role);
  const identityColor = shownDepartment?.colorHex ?? SUPER_ADMIN_THEME.colorHex;

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName={roleLabel} userName={user.fullName}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title={tp.title}
          description={tp.subtitle}
          actions={
            <a href="#edit" className="wizard-btn-2">
              تعديل بياناتك
            </a>
          }
        />

        {/* الهوية في سطرٍ واحد: من أنت في الفريق — كبطاقة ملف الشخص تماماً */}
        <Card className="flex flex-wrap items-center gap-4 p-5" style={{ borderTop: `5px solid ${identityColor}` }}>
          <PersonAvatar
            src={avatarUrl("user", session.user.id, user.avatarVersion)}
            name={user.fullName}
            color={portraitColorFor(user.role, shownDepartment)}
            className="h-20 w-20"
            textClassName="text-2xl"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold">{user.fullName}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-black/60">
              {shownDepartment && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: shownDepartment.colorHex }} />
                  {shownDepartment.name}
                </span>
              )}
              <span>· {roleLabel}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                  user.totpEnabled ? "bg-green-50 text-green-800 ring-green-200" : "bg-amber-50 text-amber-900 ring-amber-200"
                }`}
              >
                {user.totpEnabled ? "التحقق بخطوتين مُفعّل" : "التحقق بخطوتين غير مُفعّل"}
              </span>
            </p>
            <p className="mt-1 text-xs text-black/45">
              {tp.since}: {formatDate(user.createdAt)}
            </p>
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* الهوية: تُعرض ولا تُعدَّل من هنا */}
          <Card className="p-5">
            <h2 className="text-base font-bold">الحساب</h2>
            <dl className="mt-3 divide-y divide-black/[0.06]">
              <Row label={tp.email} value={user.email} ltr />
              <Row label={tp.since} value={formatDate(user.createdAt)} />
              <Row
                label={tp.completedAt}
                value={user.profileCompletedAt ? formatDate(user.profileCompletedAt) : tp.notCompleted}
              />
            </dl>
            <p className="mt-3 text-xs text-black/40">{tp.identityNote}</p>
          </Card>

          <div className="flex flex-col gap-5">
            {/* بطاقة الانضمام: إيصالُها، و«لم تصلني» بلاغٌ لمسؤول التشغيل */}
            <WelcomeMailCard
              theme={theme}
              sentAt={user.welcomeEmailSentAt ? formatDate(user.welcomeEmailSentAt) : null}
              // المؤسسُ لنفسه بلا سقف؛ وغيرُه بطاقةُ الاعتماد وإعادةٌ واحدة
              canReport={user.role === "super_admin" || user.welcomeEmailCount < WELCOME_MAX_SENDS}
              selfSend={user.role === "super_admin" ? user.id : undefined}
              resenderLabel={RESENDER_LABEL[resenderRoleFor(user.role)]}
            />
            <Card className="p-5">
              <h2 className="text-base font-bold">الأمان</h2>
              <p className="mt-1 text-xs leading-relaxed text-black/50">
                {user.totpEnabled
                  ? "دخولك محميٌّ بطريقين: كلمة المرور ورمز التطبيق أو البريد."
                  : "دخولك معلّقٌ ببريدك وحده — فعّل التحقق بخطوتين ليبقى لك طريقٌ ثانٍ."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="/admin/security" className="wizard-btn-2">
                  التحقق بخطوتين
                </a>
                <a href="/change-password" className="wizard-btn-2">
                  تغيير كلمة المرور
                </a>
              </div>
            </Card>
          </div>
        </div>

        {/* الصورة الشخصية — لكل شخصٍ لا للقادة وحدهم */}
        <AvatarUpload
          current={avatarUrl("user", session.user.id, user.avatarVersion)}
          theme={theme}
          opaque={(await avatarHasTransparency(user.avatarData)) === false}
        />

        <Card className="p-5 sm:p-6" id="edit">
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
              gender: user.gender ?? null,
            }}
          />
        </Card>

        {/* المرجع: يُفتح عند الحاجة ولا يُطيل الصفحة */}
        <details className="group rounded-2xl">
          <summary className="wizard-btn-2 cursor-pointer list-none">شروط كلمة المرور والتحقق بخطوتين</summary>
          <div className="mt-3">
            <SecurityGuidance theme={theme} totpEnabled={user.totpEnabled} />
          </div>
        </details>
        <details className="group rounded-2xl">
          <summary className="wizard-btn-2 cursor-pointer list-none">الحوكمة — ما يجب وما لا يجوز</summary>
          <div className="mt-3">
            <GovernanceCharter theme={theme} />
          </div>
        </details>
      </main>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="text-xs text-black/45">{label}</dt>
      <dd className={`text-sm font-semibold ${ltr ? "break-all" : ""}`} dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}
