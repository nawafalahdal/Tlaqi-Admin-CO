"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { activeNavId, NAV_GROUPS, type NavGroup, type NavItem } from "@/lib/navigation";
import { useTranslations } from "@/i18n/LocaleProvider";
import { LogoMark, ThemedLockup } from "../Logo";
import { NavGlyph } from "../icons";

/** القائمة الجانبية — كبسولةٌ عمودية.
 *
 *  - **سطح المكتب (≥١٠٢٤):** موسَّعة: الشعارُ الرسميُّ كاملاً، والبنودُ
 *    مجمّعةً تحت عناوينها. وتُطوى أيقوناتٍ وحدها بزرّ (الرمزُ وحده في
 *    رأسها، ولا عناوين)، ويُحفظ الاختيار.
 *  - **اللوحيّ (٦٤٠–١٠٢٣):** مطويّةٌ دائماً — المساحةُ للمحتوى.
 *  - **الجوال (<٦٤٠):** لا قائمة جانبية. البنودُ نفسها، بمجموعاتها، في
 *    قائمة الترويسة (`HeaderShell`) عبر السياق أدناه — زرُّ قائمةٍ واحد.
 *
 *  والبنودُ تأتي من الخادم محسوبةً للدور ومرتّبةً بمجموعاتها (`navFor`)؛
 *  هذا المكوّن يرسمها ويُضيء الحاليّ فقط. وقائمةُ الحساب (`account`) تأتي
 *  مرسومةً من الخادم لأن الخروجَ إجراءُ خادم. */

/** الشاشاتُ التي لا قائمة فيها: مسارُ المرشّح قبل اعتماده، والطباعة */
const BARE = ["/member/test", "/member/pending", "/member/welcome", "/structure/pdf"];

type Raise = { href: string; label: string };
type Nav = { items: NavItem[]; homeHref: string; raise: Raise } | null;
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

/** البنودُ مقسومةً على مجموعاتها بترتيبها — المجموعةُ الفارغةُ لا تظهر */
function grouped(items: NavItem[]): { group: NavGroup; items: NavItem[] }[] {
  return NAV_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter(
    (g) => g.items.length > 0
  );
}

export function SidebarProvider({
  items,
  homeHref,
  userName,
  roleName,
  account,
  raise,
  children,
}: {
  items: NavItem[];
  homeHref: string;
  userName: string;
  roleName: string;
  account: ReactNode;
  raise: Raise;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const bare = BARE.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return (
    <NavContext.Provider value={bare ? null : { items, homeHref, raise }}>
      {!bare && (
        <SidebarRail
          items={items}
          homeHref={homeHref}
          userName={userName}
          roleName={roleName}
          account={account}
          raise={raise}
          pathname={pathname}
        />
      )}
      {children}
    </NavContext.Provider>
  );
}

function SidebarRail({
  items,
  homeHref,
  userName,
  roleName,
  account,
  raise,
  pathname,
}: {
  items: NavItem[];
  homeHref: string;
  userName: string;
  roleName: string;
  account: ReactNode;
  raise: Raise;
  pathname: string;
}) {
  const t = useTranslations();
  const s = t.shell;
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
    <aside className="app-sidebar" aria-label={s.mainNav}>
      <div className="app-sidebar__top">
        {/* الشعارُ الرسميُّ لا يُقصّ ولا يُعاد رسمه: كاملاً موسَّعة، والرمزُ
            وحده مطويّة — والـCSS يختار أيّهما يظهر */}
        <Link href={homeHref} className="app-sidebar__brand" aria-label={s.homeLink} title="تَـــلاقِ">
          <span className="app-sidebar__lockup">
            <ThemedLockup height={28} />
          </span>
          <span className="app-sidebar__mark">
            <LogoMark size={30} />
          </span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          className="app-sidebar__toggle"
          aria-label={collapsed ? s.expand : s.collapse}
          title={collapsed ? s.expand : s.collapse}
          aria-expanded={!collapsed}
        >
          <NavGlyph name="chevron" />
        </button>
      </div>

      {/* رفعُ التذكرة: الإجراءُ الأوّل في المنصة، فهو أوّلُ ما تحت الشعار —
          زرٌّ بارز لا بندٌ بين البنود. ومطويّةً يبقى أيقونةً بتلميح */}
      <Link
        href={raise.href}
        className="app-sidebar__cta"
        data-active={pathname === raise.href ? "true" : undefined}
        aria-current={pathname === raise.href ? "page" : undefined}
        title={raise.label}
      >
        <NavGlyph name="plus" className="app-sidebar__cta-icon" />
        <span className="app-sidebar__label">{raise.label}</span>
      </Link>

      <nav className="app-sidebar__nav">
        {grouped(items).map(({ group, items: gi }) => (
          <div key={group} className="app-sidebar__group">
            <p className="app-sidebar__label app-sidebar__section" id={`nav-g-${group}`}>
              {s.groups[group]}
            </p>
            <ul className="app-sidebar__list" aria-labelledby={`nav-g-${group}`}>
              {gi.map((it) => {
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
          </div>
        ))}
      </nav>

      {/* قائمةُ الحساب في ذيل القائمة: بياناتي والتحقق وكلمة المرور والخروج —
          كانت أزراراً تزحم الترويسة في كل شاشة */}
      <details className="account-menu">
        <summary className="app-sidebar__user" title={`${userName} — ${roleName}`} aria-label={`${s.accountMenu}: ${userName}`}>
          <span className="app-sidebar__avatar" aria-hidden="true">{initials || "؟"}</span>
          <span className="app-sidebar__label app-sidebar__who">
            <span className="app-sidebar__name">{userName}</span>
            <span className="app-sidebar__role">{roleName}</span>
          </span>
          <NavGlyph name="chevron" className="app-sidebar__label account-menu__caret" />
        </summary>
        {account}
      </details>
    </aside>
  );
}

/** بنودُ القائمة داخل قائمة الجوال في الترويسة — بمجموعاتها نفسها */
export function MobileNavList({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useAppNav();
  const pathname = usePathname() ?? "";
  const t = useTranslations();
  if (!nav || nav.items.length === 0) return null;
  const active = activeNavId(nav.items, pathname);
  return (
    <nav aria-label={t.shell.mainNav} className="mobile-nav">
      <Link href={nav.raise.href} onClick={onNavigate} className="mobile-nav__cta">
        <NavGlyph name="plus" className="mobile-nav__icon" />
        <span>{nav.raise.label}</span>
      </Link>
      {grouped(nav.items).map(({ group, items }) => (
        <div key={group}>
          <p className="mobile-nav__group">{t.shell.groups[group]}</p>
          <ul>
            {items.map((it) => (
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
        </div>
      ))}
    </nav>
  );
}
