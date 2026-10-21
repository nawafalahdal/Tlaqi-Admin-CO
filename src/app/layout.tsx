import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { getLocale, getDictionary } from "@/i18n/server";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { NavDepth } from "@/components/NavDepth";
import { ThemeScript } from "@/components/ThemeScript";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
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

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`${cairo.variable} h-full antialiased`}
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
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
