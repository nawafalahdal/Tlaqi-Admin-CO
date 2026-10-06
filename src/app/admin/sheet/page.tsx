import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { getLocale, getDictionary } from "@/i18n/server";
import { BackfillPanel } from "./BackfillPanel";

// التعبئة تكتب عشرات الأسطر عبر Google API، فتحتاج مهلة أطول من الافتراضية
export const maxDuration = 60;

export default async function SheetPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin") redirect("/admin");

  const t = getDictionary(await getLocale());
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetUrl = sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null;

  const tabs = [
    { name: t.sheetPage.tabLive, desc: t.sheetPage.tabLiveDesc },
    { name: t.sheetPage.tabTests, desc: t.sheetPage.tabTestsDesc },
    { name: t.sheetPage.tabTickets, desc: t.sheetPage.tabTicketsDesc },
    { name: t.sheetPage.tabLifecycle, desc: t.sheetPage.tabLifecycleDesc },
  ];

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={t.admin.founderRole} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton />
          <h1 className="text-lg font-bold sm:text-xl">{t.sheetPage.title}</h1>
          <p className="mt-1 text-sm text-black/50">{t.sheetPage.subtitle}</p>
        </div>

        {sheetUrl ? (
          <Card className="p-4 sm:p-5">
            <p className="text-xs text-black/40">{t.sheetPage.linkLabel}</p>
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-11 items-center break-all text-sm font-semibold underline"
              style={{ color: theme.accentDark }}
            >
              {sheetUrl}
            </a>
          </Card>
        ) : (
          <Card className="p-4 text-sm text-red-700">{t.sheetPage.notConfigured}</Card>
        )}

        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.sheetPage.tabsTitle}</h2>
          <div className="flex flex-col gap-3">
            {tabs.map((tab) => (
              <Card key={tab.name} className="p-4">
                <p className="text-sm font-bold">{tab.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-black/50">{tab.desc}</p>
              </Card>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-black/40">{t.sheetPage.lazyNote}</p>
        </section>

        <BackfillPanel theme={theme} />
      </main>
    </div>
  );
}
