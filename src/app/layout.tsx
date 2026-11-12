import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { getLocale, getDictionary } from "@/i18n/server";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { NavDepth } from "@/components/NavDepth";
import { ThemeScript } from "@/components/ThemeScript";
import { databaseBlocked, deploymentEnv } from "@/lib/deploymentEnv";
import { fmt } from "@/i18n/fmt";

/** **الخطُّ الرسمي لهوية تلاق: The Year of The Camel** (قرار المؤسس) — مستضافٌ مع المنصة (لا من خدمةٍ خارجية)،
 *  بأوزانه المعتمدة الأربعة. والأسماءُ الداخلية في ملفات OTF غير متطابقة، فيُسمّى كلُّ وزنٍ هنا صراحةً بملفّه.
 *  ويعمل للعربية والإنجليزية واتجاه RTL؛ والاحتياطُ Tahoma إلى أن يُحمَّل. */
const brandFont = localFont({
  src: [
    { path: "./fonts/TheYearofTheCamel-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/TheYearofTheCamel-Medium.otf", weight: "500", style: "normal" },
    { path: "./fonts/TheYearofTheCamel-Bold.otf", weight: "700", style: "normal" },
    { path: "./fonts/TheYearofTheCamel-ExtraBold.otf", weight: "800", style: "normal" },
  ],
  variable: "--font-brand",
  display: "swap",
  fallback: ["Tahoma", "Arial", "sans-serif"],
});

// عنوانُ التبويب ووصفُه بلغة الواجهة
export async function generateMetadata(): Promise<Metadata> {
  const L = getDictionary(await getLocale()).rLayout;
  return {
    title: L.title,
    description: L.description,
    icons: { icon: "/brand/favicon.png" },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // معاينةٌ بلا قاعدةٍ معزولة: تُقال الحالُ بدل صفحاتٍ تفشل استعلاماتُها (`deploymentEnv.ts`)
  const G = databaseBlocked() ? getDictionary(locale).previewGuard : null;

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`${brandFont.variable} h-full antialiased`}
      // السمة تُكتب هنا قبل أول رسم (`ThemeScript`)، و`suppressHydrationWarning`
      // لأن الخادم لا يعرف تفضيل الجهاز فيختلف عنه السمةُ المطبَّقة
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LocaleProvider initialLocale={locale}>
          {/* يَعدّ خطواتنا وحدها، فيعرف زرُّ الرجوع متى يَرجع ومتى يَصعد */}
          <NavDepth />
          {G ? (
            <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-16">
              <h1 className="text-lg font-bold">{G.title}</h1>
              <p className="text-sm leading-relaxed text-black/60">{fmt(G.body, deploymentEnv())}</p>
            </main>
          ) : (
            children
          )}
        </LocaleProvider>
      </body>
    </html>
  );
}
