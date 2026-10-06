"use client";

import { useTransition } from "react";
import { reopenInviteAction } from "../../actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function NeedsMeetingRow({
  member,
  theme,
}: {
  member: { id: string; fullName: string; email: string; testScore: number | null };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">{member.fullName}</p>
        <p className="text-xs text-black/50" dir="ltr">
          {member.email}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-sm font-bold" style={{ color: theme.accentDark }}>
          {t.needsMeetingRow.score}: {member.testScore}%
        </p>
        <Button
          theme={theme}
          variant="outline"
          disabled={pending}
          onClick={() => startTransition(() => reopenInviteAction(member.id))}
        >
          {t.needsMeetingRow.reopenInvite}
        </Button>
      </div>
    </Card>
  );
}
