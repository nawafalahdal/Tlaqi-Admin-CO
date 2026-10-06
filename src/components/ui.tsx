import type { ReactNode } from "react";
import { LogoLockup } from "./Logo";
import { HeaderShell } from "./HeaderShell";
import type { themeFromColor } from "@/lib/brand";
import { readableTextOn } from "@/lib/colors";
export { StatusBadge } from "./StatusBadge";

type Theme = ReturnType<typeof themeFromColor>;

export function AppHeader({
  theme,
  roleName,
  userName,
  children,
}: {
  theme: Theme;
  roleName: string;
  userName: string;
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
        logo={<LogoLockup size={22} color={theme.text} dotColor={theme.text} />}
        actions={children}
      />
    </header>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm shadow-black/[0.03] ${className}`}
      style={{ borderColor: "#00000012", ...style }}
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
  const style: React.CSSProperties =
    variant === "solid"
      ? { background: theme.accentDark, color: readableTextOn(theme.accentDark) }
      : variant === "outline"
      ? { background: "transparent", color: theme.accentDark, border: `1.5px solid ${theme.accentDark}` }
      : { background: "transparent", color: theme.accentDark };
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
    <div className="flex flex-col items-center justify-center py-14 text-center text-sm text-black/40">
      {label}
    </div>
  );
}
