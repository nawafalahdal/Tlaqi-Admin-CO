import type { SurveyStatus } from "@/lib/onboardingSurvey";

const COLORS: Record<SurveyStatus, { bg: string; text: string }> = {
  not_completed: { bg: "#EDEBE8", text: "#5B5450" },
  completed: { bg: "#E3F3E8", text: "#1F6B3A" },
  banner_missing: { bg: "#FFF1DE", text: "#8A5A00" },
  needs_follow_up: { bg: "#FBE5E1", text: "#9A2E1C" },
};

export function StatusChip({ status, label }: { status: SurveyStatus; label: string }) {
  const c = COLORS[status];
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: c.bg, color: c.text }}>
      {label}
    </span>
  );
}
