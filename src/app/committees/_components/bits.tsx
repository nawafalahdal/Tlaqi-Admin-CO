import type { ReactNode } from "react";
import type { CommitteeStatus } from "@prisma/client";

/** قطعُ العرض المشتركة في صفحات اللجان — بلا حالةٍ ولا شيفرة متصفّح */

export const inputCls =
  "min-h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2 text-sm outline-none focus:border-black/30";
export const textareaCls =
  "min-h-24 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm leading-relaxed outline-none focus:border-black/30";

const STATUS_CLS: Record<CommitteeStatus, string> = {
  draft: "bg-black/[0.06] text-black/70",
  pending_review: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  suspended: "bg-orange-100 text-orange-900",
  completed: "bg-sky-100 text-sky-900",
  closed: "bg-black/[0.08] text-black/60",
  archived: "bg-black/[0.05] text-black/45",
  rejected: "bg-red-50 text-red-700",
};

export function StatusChip({ status, label }: { status: CommitteeStatus; label: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_CLS[status]}`}>{label}</span>;
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "danger" | "ok" | "info" }) {
  const cls = {
    neutral: "bg-black/[0.06] text-black/70",
    warn: "bg-amber-100 text-amber-900",
    danger: "bg-red-50 text-red-700",
    ok: "bg-emerald-100 text-emerald-900",
    info: "bg-sky-100 text-sky-900",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "warn" }) {
  const color = tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-800" : "";
  return (
    <div className="rounded-2xl border border-hairline bg-white px-3.5 py-3">
      <p className="text-[11px] font-medium text-black/50">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-black/70">
        {label}
        {required && <span className="text-red-600" aria-hidden> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-black/45">{hint}</span>}
    </label>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** نصٌّ طويلٌ كما كُتب — بأسطره */
export function Prose({ children }: { children: string | null | undefined }) {
  if (!children) return <p className="text-sm text-black/40">—</p>;
  return <p className="whitespace-pre-line text-sm leading-relaxed text-black/80">{children}</p>;
}

// ── التواريخ: بتوقيت الرياض، بأرقامٍ لاتينية في الواجهتين (لا اختلافَ بين الخادم والمتصفّح)

const TZ = "Asia/Riyadh";

/** تاريخُ يومٍ مخزَّنٌ منتصفَ ليل UTC (البداية والانتهاء) — يُقرأ كما كُتب */
export function fmtDay(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** لحظةٌ (موعدُ اجتماع، استحقاق، حدث) بتوقيت الرياض */
export function fmtWhen(d: Date | null | undefined, withTime = true): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(d);
}

/** قيمةُ حقل `date` — لليوم المخزَّن منتصفَ ليل UTC */
export function dayInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** قيمةُ حقل `date` للحظةٍ — يومُها في الرياض */
export function riyadhDayInput(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
