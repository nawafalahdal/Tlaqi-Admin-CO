"use client";

import { useState, useTransition } from "react";
import { remindTicketAction, remindRequestAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function ReminderButton({
  target,
  theme,
}: {
  target: { type: "ticket" | "request"; id: string };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<"sent" | string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        theme={theme}
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res =
              target.type === "ticket" ? await remindTicketAction(target.id) : await remindRequestAction(target.id);
            setResult(res.error ?? "sent");
            setTimeout(() => setResult(null), 3000);
          })
        }
      >
        {pending ? t.actions.sending : t.actions.sendReminder}
      </Button>
      {result === "sent" && <span className="text-xs text-green-700">{t.opsExtras.reminderSent}</span>}
      {result && result !== "sent" && <span className="text-xs text-red-700">{result}</span>}
    </div>
  );
}
