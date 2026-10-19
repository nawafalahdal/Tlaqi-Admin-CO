import { AppSidebar } from "@/components/sidebar/AppSidebar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppSidebar>{children}</AppSidebar>;
}
