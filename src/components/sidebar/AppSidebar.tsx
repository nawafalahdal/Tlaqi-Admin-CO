import { auth } from "@/auth";
import { navFor, homeFor } from "@/lib/navigation";
import { isSigningRole } from "@/lib/signatures";
import { SidebarProvider } from "./SidebarRail";
import type { ReactNode } from "react";

/** مسمّياتُ الأدوار كما تُقال في الهيكل. (`accountRoleLabel` يخدم البريد والشيت
 *  بصيغها القائمة، فلا تُغيَّر من هنا.) */
const SIDEBAR_ROLE_LABELS: Record<string, string> = {
  super_admin: "المؤسس",
  executive: "الرئيس التنفيذي",
  operations_officer: "مسؤول المتابعة والتشغيل",
  department_admin: "قائد قسم",
  member: "عضو",
};

/** يحسب بنودَ القائمة لصاحب الجلسة على الخادم، ويُسلّمها لمن يرسمها.
 *
 *  يُركَّب مرّةً في تخطيط كلّ قسمٍ من مساحة العمل (`layout.tsx`)، لا في
 *  كلّ صفحة — فيكون قائمةً واحدة، ولا يُعاد رسمُها عند التنقّل بين صفحاته. */
export async function AppSidebar({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session) return <>{children}</>;

  const viewer = {
    role: session.user.role,
    departmentSlug: session.user.departmentSlug,
    canSign: isSigningRole(session.user.role),
  };
  const roleName = SIDEBAR_ROLE_LABELS[session.user.role] ?? "";

  return (
    <SidebarProvider
      items={navFor(viewer)}
      homeHref={homeFor(viewer)}
      userName={session.user.name ?? ""}
      roleName={roleName}
    >
      {children}
    </SidebarProvider>
  );
}
