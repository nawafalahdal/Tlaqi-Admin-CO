"use client";

import { useTranslations } from "@/i18n/LocaleProvider";

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
  const labels = useTranslations().status as Record<string, string>;
  const c = STATUS_COLORS[status] ?? { bg: "#EDEBE8", text: "#5B5450" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: c.bg, color: c.text }}
    >
      {labels[status] ?? status}
    </span>
  );
}
