import type { ReactNode } from "react";
import { LogoLockup } from "./Logo";
import type { themeFromColor } from "@/lib/brand";
import { readableTextOn } from "@/lib/colors";

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
      className="sticky top-0 z-10 border-b"
      style={{ background: theme.base, borderColor: theme.accentDark }}
    >
      <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
        <LogoLockup size={22} color={theme.text} dotColor={theme.text} />
        <div className="flex items-center gap-4">
          <div className="text-end" style={{ color: theme.text }}>
            <p className="text-sm font-semibold leading-tight">{userName}</p>
            <p className="text-xs opacity-80 leading-tight">{roleName}</p>
          </div>
          {children}
        </div>
      </div>
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

const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  in_progress: "قيد التنفيذ",
  done: "منجز",
  overdue: "متأخر",
  pending_review: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
  open: "مفتوحة",
  used: "مستخدمة",
  expired: "منتهية",
  passed: "ناجح",
  failed: "لم ينجح",
  not_started: "لم يبدأ",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: "#E8ECF7", text: "#30406B" },
  in_progress: { bg: "#FFF1DE", text: "#8A5A00" },
  done: { bg: "#E3F3E8", text: "#1F6B3A" },
  overdue: { bg: "#FBE5E1", text: "#9A2E1C" },
  pending_review: { bg: "#FFF1DE", text: "#8A5A00" },
  approved: { bg: "#E3F3E8", text: "#1F6B3A" },
  rejected: { bg: "#FBE5E1", text: "#9A2E1C" },
  open: { bg: "#E8ECF7", text: "#30406B" },
  used: { bg: "#E3F3E8", text: "#1F6B3A" },
  expired: { bg: "#EDEBE8", text: "#5B5450" },
  passed: { bg: "#E3F3E8", text: "#1F6B3A" },
  failed: { bg: "#FBE5E1", text: "#9A2E1C" },
  not_started: { bg: "#EDEBE8", text: "#5B5450" },
};

export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: "#EDEBE8", text: "#5B5450" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: c.bg, color: c.text }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
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
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90";
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
