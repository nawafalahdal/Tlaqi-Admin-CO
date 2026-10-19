"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "@/i18n/LocaleProvider";
import { MobileNavList } from "./sidebar/SidebarRail";

/** غلاف الهيدر: على الجوال يخفي بيانات المستخدم والأزرار داخل قائمة منسدلة
 *  بدل حشرها في سطر واحد (كانت تتراكم وتقصّ النص على الشاشات الصغيرة).
 *  من sm وأعلى يعود للتخطيط الأفقي الكامل. */
export function HeaderShell({
  textColor,
  borderColor,
  userName,
  roleName,
  logo,
  homeHref,
  actions,
}: {
  textColor: string;
  borderColor: string;
  userName: string;
  roleName: string;
  logo: ReactNode;
  /** الشعار يعود به إلى لوحته — فإن لم يُمرَّر بقي الشعار شعاراً فقط */
  homeHref?: string;
  actions?: ReactNode;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="app-header__logo min-w-0 shrink">
          {homeHref ? (
            <Link href={homeHref} aria-label={t.actions.home} className="inline-flex">
              {logo}
            </Link>
          ) : (
            logo
          )}
        </div>

        {/* سطح المكتب: الاسم والأزرار ظاهرة */}
        <div className="hidden items-center gap-4 sm:flex">
          <div className="text-end" style={{ color: textColor }}>
            <p className="text-sm font-semibold leading-tight">{userName}</p>
            <p className="text-xs leading-tight opacity-80">{roleName}</p>
          </div>
          {actions}
        </div>

        {/* الجوال: زر قائمة بمساحة لمس مريحة */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t.actions.closeMenu : t.actions.openMenu}
          className="-me-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:hidden"
          style={{ color: textColor }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            {open ? (
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div
          className="border-t px-4 pb-4 pt-3 sm:hidden"
          style={{ borderColor }}
          // تُغلق القائمة عند الضغط على رابط فقط — لا على أي ضغطة.
          // إغلاقها عند كل ضغطة كان يُزيل زر الخروج من الصفحة قبل أن
          // يُرسَل نموذجه، فلا يقع الخروج أصلاً: الروابط تنجو لأنها
          // تنتقل فوراً، والنموذج يُلغى بإزالته.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <div className="mb-3" style={{ color: textColor }}>
            <p className="text-sm font-semibold leading-tight">{userName}</p>
            <p className="text-xs leading-tight opacity-80">{roleName}</p>
          </div>
          {/* بنودُ القائمة الجانبية نفسُها — على الجوال لا قائمةَ جانبية، فتأتي هنا:
              زرُّ قائمةٍ واحد يجمع التنقّل وأدوات الحساب */}
          <div style={{ color: textColor }}>
            <MobileNavList onNavigate={() => setOpen(false)} />
          </div>
          <div className="[&>div]:grid [&>div]:gap-2 [&_a]:flex [&_a]:min-h-11 [&_a]:w-full [&_a]:items-center [&_a]:justify-center [&_button]:flex [&_button]:min-h-11 [&_button]:w-full [&_button]:items-center [&_button]:justify-center">
            {actions}
          </div>
        </div>
      )}
    </>
  );
}
