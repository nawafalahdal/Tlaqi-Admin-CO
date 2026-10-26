import Link from "next/link";
import type { ReactNode } from "react";
import { themeForDepartment } from "@/lib/brand";

/** قطعٌ صغيرةٌ مشتركةٌ في صفحات وكيل التسويق — بلا حالةٍ ولا خطّافات،
 *  فتُرسم في الخادم وفي مكوّنات العميل معاً. ألوانُ الحالة من اللوحة التي
 *  تُخرَط في السمة الداكنة (`globals.css`) وحدها. */

export const mkTheme = themeForDepartment("marketing");

export type Tone = "neutral" | "progress" | "review" | "good" | "bad";

const TONE: Record<Tone, string> = {
  neutral: "bg-black/[0.06] text-black/65",
  progress: "bg-black/[0.08] text-black/80",
  review: "bg-amber-100 text-amber-900",
  good: "bg-emerald-100 text-emerald-800",
  bad: "bg-red-100 text-red-800",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE[tone]}`}>{children}</span>;
}

export function campaignTone(s: string): Tone {
  if (s === "published") return "good";
  if (s === "blocked") return "bad";
  if (s === "in_progress") return "progress";
  if (s === "ready_for_planning") return "review";
  return "neutral";
}

export function deliverableTone(s: string): Tone {
  if (s === "published" || s === "ready_to_publish") return "good";
  if (s === "blocked" || s === "revision_required") return "bad";
  if (s === "content_review" || s === "design_review" || s === "quality_review") return "review";
  if (s === "content_approved" || s === "design_approved") return "progress";
  return "neutral";
}

export function taskTone(s: string): Tone {
  if (s === "done") return "good";
  if (s === "blocked") return "bad";
  if (s === "in_progress") return "progress";
  return "neutral";
}

export function Section({ title, hint, actions, children, id }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-hairline bg-white p-4 shadow-sm shadow-black/[0.04] sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-black/55">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export const inputCls = "min-h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30";
export const areaCls = "w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm leading-relaxed outline-none focus:border-black/30";

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-bold text-black/70">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-relaxed text-black/50">{hint}</span>}
    </label>
  );
}

/** تبويباتٌ بروابط (`?tab=`) — تُفتح وتُشارَك وتعمل بلا شيفرة متصفّح */
export function Tabs({ items, current, label }: { items: { key: string; label: string; href: string; count?: number }[]; current: string; label: string }) {
  return (
    <nav className="roster-tabs" aria-label={label}>
      {items.map((i) => (
        <Link key={i.key} href={i.href} className="roster-tab" aria-current={i.key === current ? "page" : undefined} prefetch={false}>
          {i.label}
          {i.count !== undefined && i.count > 0 && <span className="ms-1.5 opacity-70">{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-black/50">{children}</p>;
}

/** «عضو الفريق» — اسمٌ من حسابه في المنصة */
export const nameOf = (m: { user: { fullName: string } | null; member: { fullName: string } | null; nameSnapshot?: string | null } | null | undefined) =>
  m?.user?.fullName ?? m?.member?.fullName ?? m?.nameSnapshot ?? "—";

/** تاريخٌ ووقتٌ بتوقيت الرياض وبأرقامٍ لاتينية في اللغتين — كسائر المنصة */
export function when(d: Date | string | null | undefined, withTime = true): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

/** قيمةُ حقل `date` بتوقيت الرياض */
export function dateInput(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
