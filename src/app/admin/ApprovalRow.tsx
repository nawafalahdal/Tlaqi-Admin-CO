"use client";

import { useTransition } from "react";
import { approveMemberAction, rejectMemberAction } from "./actions";
import { themeFromColor } from "@/lib/brand";
import { Button, Card } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";

export function ApprovalRow({
  member,
  onApproved,
}: {
  member: {
    id: string;
    fullName: string;
    email: string;
    testScore: number | null;
    departmentName: string;
    departmentColor: string;
  };
  onApproved: (result: { email: string; tempPassword: string }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const theme = themeFromColor(member.departmentColor);
  const t = useTranslations();

  function handleApprove() {
    startTransition(async () => {
      const result = await approveMemberAction(member.id);
      onApproved(result);
    });
  }

  return (
    <Card
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderInlineStartWidth: 4, borderInlineStartColor: theme.base }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: theme.surface, color: theme.accentDark }}
        >
          {member.fullName.slice(0, 1)}
        </span>
        <div>
          <p className="text-sm font-semibold">{member.fullName}</p>
          <p className="text-xs text-black/50" dir="ltr">
            {member.email}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-end">
          <p className="text-xs text-black/40">{member.departmentName}</p>
          <p className="text-sm font-bold" style={{ color: theme.accentDark }}>
            {t.admin.testScoreLabel}: {member.testScore}%
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            theme={theme}
            variant="outline"
            disabled={pending}
            onClick={() => startTransition(() => rejectMemberAction(member.id))}
          >
            {t.admin.reject}
          </Button>
          <Button theme={theme} disabled={pending} onClick={handleApprove}>
            {t.admin.approveFinal}
          </Button>
        </div>
      </div>
    </Card>
  );
}
