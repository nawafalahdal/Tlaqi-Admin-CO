"use client";

import { useTranslations } from "@/i18n/LocaleProvider";

/** أين وصل حساب المرشّح في رحلته: استلم بياناته ولم يختبر، أو اختبر وينتظر
 *  القرار، أو اعتُمد، أو رُفض. يُغني من أنشأ الحساب عن تخمين سبب تعثّره. */
export function AccountStageBadge({
  approvalStatus,
  testStatus,
}: {
  approvalStatus: string | null;
  testStatus: string | null;
}) {
  const t = useTranslations().accountStage;

  const stage =
    approvalStatus === "approved"
      ? { label: t.approved, bg: "#E3F3E8", fg: "#1F6B3A" }
      : approvalStatus === "rejected"
        ? { label: t.rejected, bg: "#FBE5E1", fg: "#9A2E1C" }
        : testStatus === "passed"
          ? { label: t.awaitingApproval, bg: "#FFF1DE", fg: "#8A5A00" }
          : testStatus === "failed"
            ? { label: t.failed, bg: "#FBE5E1", fg: "#9A2E1C" }
            : { label: t.notTestedYet, bg: "#E8ECF7", fg: "#30406B" };

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: stage.bg, color: stage.fg }}
    >
      {stage.label}
    </span>
  );
}
