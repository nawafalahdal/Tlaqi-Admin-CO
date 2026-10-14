import type { ReactNode } from "react";
import { LogoLockup } from "./Logo";
import { HeaderShell } from "./HeaderShell";
import { logoToneFor, brandInk, brandInkBorder, type themeFromColor } from "@/lib/brand";
import { readableTextOn } from "@/lib/colors";
export { StatusBadge } from "./StatusBadge";

type Theme = ReturnType<typeof themeFromColor>;

/** الشعار في الهيدر يعود به إلى بيته.
 *
 *  و«بيته» ليس صفحةً واحدة: `/admin` نفسها تُحوّل كلّ دور إلى لوحته —
 *  قائد القسم إلى قسمه، ومسؤول التشغيل إلى تشغيله، والعضو إلى بوابته.
 *  فيكفي رابطٌ واحد، ولا تُكرَّر قواعد التوجيه في سبعة عشر موضعاً حتى
 *  تختلف إحداها عن الباقي. */
export function AppHeader({
  theme,
  roleName,
  userName,
  homeHref = "/admin",
  children,
}: {
  theme: Theme;
  roleName: string;
  userName: string;
  homeHref?: string;
  children?: ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-20 border-b"
      style={{ background: theme.base, borderColor: theme.accentDark }}
    >
      <HeaderShell
        textColor={theme.text}
        borderColor={`${theme.text}22`}
        userName={userName}
        roleName={roleName}
        homeHref={homeHref}
        logo={<LogoLockup height={30} tone={logoToneFor(theme)} />}
        actions={children}
      />
    </header>
  );
}

export function Card({
  children,
  className = "",
  style,
  id,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** مِرساة: رابطُ التذكرة في البريد ينتهي بـ`#ticket-123` فيقف عليها */
  id?: string;
}) {
  return (
    <div
      id={id}
      // الحدُّ من المتغيّر لا من رقمٍ ثابت: `#00000012` على سطحٍ داكن
      // لا يُرى، فتضيع حدودُ البطاقات كلّها في السمة الداكنة
      className={`scroll-mt-24 rounded-2xl border border-hairline bg-white shadow-sm shadow-black/[0.03] ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  theme,
  variant = "solid",
  type = "button",
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  theme: Theme;
  variant?: "solid" | "outline" | "ghost";
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90";

  const solid = variant === "solid";
  /** حبرُ الخطّ والشبح يتبع السمة: `accentDark` على سطحٍ داكن لا يُقرأ.
   *  والمملوء لا يحتاجه — سطحُه ملوَّنٌ في السمتين. */
  const style: React.CSSProperties = solid
    ? { background: theme.accentDark, color: readableTextOn(theme.accentDark) }
    : variant === "outline"
      ? {
          background: "transparent",
          color: brandInk(theme),
          border: `1.5px solid ${brandInkBorder(theme)}`,
        }
      : { background: "transparent", color: brandInk(theme) };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${className}`}
      style={style}
    >
      {children}
    </button>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center text-sm text-black/45">
      {label}
    </div>
  );
}
