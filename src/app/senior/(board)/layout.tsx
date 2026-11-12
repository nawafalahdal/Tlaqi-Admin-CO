import { AppSidebar } from "@/components/sidebar/AppSidebar";

/** إطارُ الصفحة الموحَّد — الهوامشُ والعرضُ الأقصى كبقية صفحات المنصة (كان المحتوى يلتصق بحافة الشاشة) */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AppSidebar>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-5 sm:py-8">{children}</main>
    </AppSidebar>
  );
}
