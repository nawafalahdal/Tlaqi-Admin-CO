import type { ReactNode } from "react";
import { ThemedLockup } from "./Logo";
import { HeaderShell } from "./HeaderShell";
import { brandInk, brandInkBorder, type themeFromColor } from "@/lib/brand";
import { ImproveButton } from "./ImproveButton";
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
    <>
      {/* ترويسةٌ محايدة بلون الصفحة — لا شريطٌ بلون القسم يملأ رأس كل شاشة.
          كان الشريطُ في الداكن خمريّاً ثقيلاً، والاتفاقُ رماديٌّ محايد.
          وهويةُ القسم لا تضيع: خطٌّ بلونه على حافّة الترويسة السفلى. */}
      <header
        className="app-header sticky top-0 z-20"
        style={{ borderBlockEnd: `3px solid ${theme.base}` }}
      >
        <HeaderShell
          textColor="var(--ink)"
          borderColor="var(--hairline)"
          userName={userName}
          roleName={roleName}
          homeHref={homeHref}
          logo={<ThemedLockup height={30} />}
          actions={children}
        />
      </header>
      {/* «تحسين» العائم يُرسَم هنا — خارج الترويسة — لا مع أدواتها.
          أدواتُ الترويسة تُرسَم مرّتين (شريطُ المكتب وقائمةُ الجوال) وأولاهما
          مخفيّةٌ على الجوال؛ فزرٌّ بينها يختفي على الجوال ويتكرّر حين تُفتح
          القائمة. وهنا يُرسَم مرّةً واحدةً في كل شاشة عمل. */}
      <ImproveButton />
    </>
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
      className={`scroll-mt-24 rounded-2xl border border-hairline bg-white shadow-sm shadow-black/[0.06] ${className}`}
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
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-95";

  const solid = variant === "solid";
  /** حبرُ الخطّ والشبح يتبع السمة: `accentDark` على سطحٍ داكن لا يُقرأ.
   *  والمملوء لا يحتاجه — سطحُه ملوَّنٌ في السمتين. */
  const style: React.CSSProperties = solid
    ? { background: theme.fill, color: theme.onFill }
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
