"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "@/i18n/LocaleProvider";
import { ThemedLockup } from "../Logo";
import { ThemeToggle } from "../ThemeToggle";
import { LocaleToggle } from "../LocaleToggle";
import { ControlGroup, ControlDivider } from "../ControlGroup";
import { ImproveButton } from "../ImproveButton";

/** شريطُ مساحة العمل — واحدٌ يُرسَم في الغلاف، لا ترويسةٌ في كل صفحة.
 *
 *  **العطبُ الذي يُصلحه:** كانت كلُّ صفحةٍ ترسم ترويستها القديمة
 *  (`AppHeader`) فوق القائمة الجانبية: شعارٌ يُخفيه الـCSS بجوار شعار
 *  القائمة، واسمُ الحساب وصفتُه مكرَّرين، وأزرارُ حسابٍ يُخفيها الـCSS
 *  على الشاشات الواسعة — واجهةٌ قديمةٌ مستورةٌ لا مُزالة. وثلاثُ صفحاتٍ
 *  لم ترسمها أصلاً، فلم يكن فيها على الجوال قائمةٌ ولا خروج.
 *
 *  والآن شريطٌ واحدٌ لكل صفحةٍ في مساحة العمل:
 *  - **من ٦٤٠ فأعلى:** أدواتُ العرض وحدها (السمة واللغة). الشعارُ
 *    والتنقّلُ والحسابُ في القائمة الجانبية.
 *  - **الجوال:** الشعارُ يعود إلى البيت، وزرُّ قائمةٍ يجمع بنودَ القائمة
 *    نفسها وقائمةَ الحساب نفسها — بلا نسخةٍ ثانيةٍ من أيٍّ منهما. */
export function WorkspaceBar({
  homeHref,
  userName,
  roleName,
  account,
  renderNav,
}: {
  homeHref: string;
  userName: string;
  roleName: string;
  /** قائمةُ الحساب كما رسمها الخادم (فيها نموذجُ الخروج) — هي هي في القائمة الجانبية */
  account: ReactNode;
  /** بنودُ القائمة الجانبية نفسها للجوال، و`close` يُغلق الشريط عند الانتقال */
  renderNav: (close: () => void) => ReactNode;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="ws-bar">
        <div className="ws-bar__inner">
          <Link href={homeHref} aria-label={t.actions.home} className="ws-bar__brand">
            <ThemedLockup height={28} />
          </Link>
          <div className="ws-bar__tools">
            <ControlGroup color="var(--ink)" label={t.ui.displayTools}>
              <ThemeToggle />
              <ControlDivider />
              <LocaleToggle />
            </ControlGroup>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="ws-bar-menu"
              aria-label={open ? t.actions.closeMenu : t.actions.openMenu}
              className="ws-bar__menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                {open ? (
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {open && (
          <div
            id="ws-bar-menu"
            className="ws-bar__panel"
            // تُغلق عند الانتقال برابطٍ فقط: إغلاقُها عند كل ضغطةٍ كان يُزيل
            // زرَّ الخروج قبل أن يُرسَل نموذجُه، فلا يقع الخروج أصلاً
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            <div className="ws-bar__who">
              <p className="ws-bar__name">{userName}</p>
              <p className="ws-bar__role">{roleName}</p>
            </div>
            {renderNav(() => setOpen(false))}
            <div className="ws-bar__account">{account}</div>
          </div>
        )}
      </header>
      {/* «تحسين» العائم: مرّةً واحدةً في كل شاشة عمل */}
      <ImproveButton />
    </>
  );
}
