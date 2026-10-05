"use client";

import { useTransition } from "react";
import { acknowledgeWarningAction } from "./actions";
import { Card, Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { themeFromColor } from "@/lib/brand";

export function WarningCard({
  warning,
  theme,
}: {
  warning: { id: string; reason: string; createdAt: string; acknowledgedAt: string | null };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-black/40">{formatDate(warning.createdAt)}</span>
        {warning.acknowledgedAt ? (
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
            تم الاطلاع
          </span>
        ) : (
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: theme.surface, color: theme.accentDark }}>
            غير مُطّلع عليه
          </span>
        )}
      </div>
      <p className="mb-3 text-sm leading-relaxed">{warning.reason}</p>
      {!warning.acknowledgedAt && (
        <Button
          theme={theme}
          disabled={pending}
          onClick={() => startTransition(() => acknowledgeWarningAction(warning.id))}
        >
          تأكيد الاطلاع
        </Button>
      )}
    </Card>
  );
}
