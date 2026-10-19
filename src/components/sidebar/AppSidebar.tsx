import Link from "next/link";
import { auth, signOut } from "@/auth";
import { navFor, homeFor } from "@/lib/navigation";
import { isSigningRole } from "@/lib/signatures";
import { getLocale, getDictionary } from "@/i18n/server";
import { NavGlyph } from "../icons";
import { SidebarProvider } from "./SidebarRail";
import type { ReactNode } from "react";

/** يحسب بنودَ القائمة لصاحب الجلسة على الخادم، ويُسلّمها لمن يرسمها.
 *
 *  يُركَّب مرّةً في تخطيط كلّ قسمٍ من مساحة العمل (`layout.tsx`)، لا في
 *  كلّ صفحة — فيكون قائمةً واحدة، ولا يُعاد رسمُها عند التنقّل بين صفحاته.
 *
 *  **وقائمةُ الحساب تُبنى هنا لا في المتصفّح:** الخروجُ إجراءُ خادم
 *  (`signOut`)، ولا يُستدعى إلا من مكوّنٍ خادميّ. والروابطُ للصفحات التي
 *  تفتح لصاحب الدور وحدها: العضوُ تردّه `/admin/profile` و`/admin/security`،
 *  فلا تُعرضان له. */
export async function AppSidebar({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session) return <>{children}</>;

  const t = getDictionary(await getLocale());
  const s = t.shell;
  const viewer = {
    role: session.user.role,
    departmentSlug: session.user.departmentSlug,
    canSign: isSigningRole(session.user.role),
  };
  const isMember = session.user.role === "member";

  const accountLinks = [
    ...(isMember ? [] : [
      { href: "/admin/profile", label: s.profile, icon: "members" },
      { href: "/admin/security", label: s.security, icon: "lock" },
    ]),
    { href: "/change-password", label: t.common.changePassword, icon: "lock" },
  ];

  const account = (
    <ul className="account-menu__list">
      {accountLinks.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className="account-menu__item">
            <NavGlyph name={l.icon} className="app-sidebar__icon" />
            <span>{l.label}</span>
          </Link>
        </li>
      ))}
      <li>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="account-menu__item account-menu__item--danger">
            <NavGlyph name="terminations" className="app-sidebar__icon" />
            <span>{t.common.logout}</span>
          </button>
        </form>
      </li>
    </ul>
  );

  return (
    <SidebarProvider
      items={navFor(viewer, s.nav)}
      homeHref={homeFor(viewer)}
      userName={session.user.name ?? ""}
      roleName={s.roles[session.user.role] ?? ""}
      account={account}
    >
      {children}
    </SidebarProvider>
  );
}
