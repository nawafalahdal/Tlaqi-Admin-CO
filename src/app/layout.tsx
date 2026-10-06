import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/i18n";
import { LocaleProvider } from "@/i18n/LocaleProvider";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "تَـــلاقِ | منصة القبول والتسجيل والإدارة",
  description: "منصة تَـــلاقِ الداخلية لإدارة دورة حياة الانضمام: دعوة، اختبار، اعتماد.",
  icons: { icon: "/brand/favicon.png" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`${cairo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
