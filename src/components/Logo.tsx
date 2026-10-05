import Image from "next/image";

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      src="/brand/symbol.png"
      alt="تلاقي"
      width={size}
      height={size}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
      priority
    />
  );
}

/** علامة الاسم النصّية — لاستخدامها فوق أي خلفية فاتحة أو داكنة عبر اختيار color */
export function Wordmark({
  size = 24,
  color = "var(--brand-ink)",
  dotColor = "var(--brand-mahogany)",
  className = "",
}: {
  size?: number;
  color?: string;
  dotColor?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center font-extrabold tracking-wide ${className}`}
      style={{ fontSize: size, color, lineHeight: 1 }}
      dir="ltr"
    >
      TLAQI
      <span
        aria-hidden
        className="inline-block rounded-full ms-1"
        style={{ width: size * 0.22, height: size * 0.22, background: dotColor }}
      />
    </span>
  );
}

export function LogoLockup({
  size = 32,
  color = "var(--brand-ink)",
  dotColor = "var(--brand-mahogany)",
}: {
  size?: number;
  color?: string;
  dotColor?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size + 8} />
      <Wordmark size={size} color={color} dotColor={dotColor} />
    </span>
  );
}
