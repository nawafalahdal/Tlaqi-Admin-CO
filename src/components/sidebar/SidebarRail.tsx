"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { activeNavId, type NavItem } from "@/lib/navigation";
import { LogoMark } from "../Logo";
import { NavGlyph } from "../icons";

/** القائمة الجانبية — كبسولةٌ عمودية، الرمزُ وحده في رأسها.
 *
 *  - **سطح المكتب (≥١٠٢٤):** موسَّعة بالأيقونة والاسم، وتُطوى أيقوناتٍ
 *    وحدها بزرّ، ويُحفظ الاختيار.
 *  - **اللوحيّ (٦٤٠–١٠٢٣):** مطويّةٌ دائماً — المساحةُ للمحتوى.
 *  - **الجوال (<٦٤٠):** لا قائمة جانبية. البنودُ نفسها تظهر في قائمة
 *    الترويسة (`HeaderShell`) عبر السياق أدناه — زرُّ قائمةٍ واحد، لا اثنان.
 *
 *  والبنودُ تأتي من الخادم محسوبةً للدور (`navFor`)؛ هذا المكوّن يرسمها
 *  ويُضيء الحاليّ فقط. */

/** الشاشاتُ التي لا قائمة فيها: مسارُ المرشّح قبل اعتماده، والطباعة */
const BARE = ["/member/test", "/member/pending", "/member/welcome", "/structure/pdf"];

type Nav = { items: NavItem[]; homeHref: string } | null;
const NavContext = createContext<Nav>(null);

/** لقائمة الجوال في الترويسة: البنودُ نفسها، أو لا شيء خارج مساحة العمل */
export function useAppNav() {
  return useContext(NavContext);
}

const STORE = "tlaqi-sidebar";
const listeners = new Set<() => void>();
function subscribeSidebar(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function readCollapsed() {
  return document.documentElement.dataset.sidebar === "collapsed";
}

export function SidebarProvider({
  items,
  homeHref,
  userName,
  roleName,
  children,
}: {
  items: NavItem[];
  homeHref: string;
  userName: string;
  roleName: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const bare = BARE.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return (
    <NavContext.Provider value={bare ? null : { items, homeHref }}>
      {!bare && <SidebarRail items={items} homeHref={homeHref} userName={userName} roleName={roleName} pathname={pathname} />}
      {children}
    </NavContext.Provider>
  );
}

function SidebarRail({
  items,
  homeHref,
  userName,
  roleName,
  pathname,
}: {
  items: NavItem[];
  homeHref: string;
  userName: string;
  roleName: string;
  pathname: string;
}) {
  // الحالةُ في وسم `<html>` (يضعه سكربتُ الرأس قبل الرسم من التخزين)، لا في
  // حالة React: فالخادمُ لا يعرفها، والعميلُ يقرؤها بعد الإماهة دون تعارض.
  const collapsed = useSyncExternalStore(subscribeSidebar, readCollapsed, () => false);
  const active = activeNavId(items, pathname);

  const toggle = () => {
    const next = !collapsed;
    document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
    try {
      localStorage.setItem(STORE, next ? "collapsed" : "expanded");
    } catch {
      /* تصفّحٌ خاصّ — يبقى الاختيارُ لهذه الجلسة */
    }
    listeners.forEach((l) => l());
  };

  const initials = userName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

  return (
    <aside className="app-sidebar" aria-label="القائمة الرئيسية">
      <div className="app-sidebar__top">
        <Link href={homeHref} className="app-sidebar__mark" aria-label="الرئيسية" title="تَـــلاقِ">
          <LogoMark size={30} />
        </Link>
        <button
          type="button"
          onClick={toggle}
          className="app-sidebar__toggle"
          aria-label={collapsed ? "توسيع القائمة" : "طيّ القائمة"}
          title={collapsed ? "توسيع القائمة" : "طيّ القائمة"}
          aria-expanded={!collapsed}
        >
          <NavGlyph name="chevron" />
        </button>
      </div>

      <div className="app-sidebar__user" title={`${userName} — ${roleName}`}>
        <span className="app-sidebar__avatar" aria-hidden="true">{initials || "؟"}</span>
        <span className="app-sidebar__label app-sidebar__who">
          <span className="app-sidebar__name">{userName}</span>
          <span className="app-sidebar__role">{roleName}</span>
        </span>
      </div>

      <p className="app-sidebar__label app-sidebar__section">مساحة العمل</p>
      <nav>
        <ul className="app-sidebar__list">
          {items.map((it) => {
            const on = it.id === active;
            return (
              <li key={it.id}>
                <Link
                  href={it.href}
                  className="app-sidebar__item"
                  data-active={on ? "true" : undefined}
                  aria-current={on ? "page" : undefined}
                  // اسمُ البند يبقى مقروءاً للقارئ الآلي حين تُطوى القائمة،
                  // وتلميحٌ لمن يمرّ بالفأرة
                  title={it.label}
                >
                  <NavGlyph name={it.icon} className="app-sidebar__icon" />
                  <span className="app-sidebar__label">{it.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

/** بنودُ القائمة داخل قائمة الجوال في الترويسة */
export function MobileNavList({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useAppNav();
  const pathname = usePathname() ?? "";
  if (!nav || nav.items.length === 0) return null;
  const active = activeNavId(nav.items, pathname);
  return (
    <nav aria-label="القائمة الرئيسية" className="mobile-nav">
      <ul>
        {nav.items.map((it) => (
          <li key={it.id}>
            <Link
              href={it.href}
              onClick={onNavigate}
              className="mobile-nav__item"
              data-active={it.id === active ? "true" : undefined}
              aria-current={it.id === active ? "page" : undefined}
            >
              <NavGlyph name={it.icon} className="mobile-nav__icon" />
              <span>{it.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
