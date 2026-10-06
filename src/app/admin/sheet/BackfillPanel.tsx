"use client";

import { useActionState } from "react";
import { backfillSheetsAction, type BackfillState } from "./actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

const INITIAL: BackfillState = { error: null, counts: null };

export function BackfillPanel({ theme }: { theme: ReturnType<typeof themeFromColor> }) {
  const [state, formAction, pending] = useActionState(backfillSheetsAction, INITIAL);
  const t = useTranslations().sheetPage;

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-base font-bold sm:text-lg">{t.backfillTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-black/60">{t.backfillBody}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={formAction}>
          <Button type="submit" theme={theme} variant="outline" disabled={pending}>
            {pending ? t.running : t.runStable}
          </Button>
        </form>
        <form action={formAction}>
          <input type="hidden" name="includeEvents" value="1" />
          <Button type="submit" theme={theme} disabled={pending}>
            {pending ? t.running : t.runFull}
          </Button>
        </form>
      </div>

      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        {t.repeatWarning}
      </p>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      {state.counts && (
        <div className="rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-900">
          <p className="font-bold">{t.done}</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            <li>{t.cLifecycle}: {state.counts.lifecycle}</li>
            <li>{t.cAdminAccounts}: {state.counts.adminAccounts}</li>
            <li>{t.cTickets}: {state.counts.tickets}</li>
            <li>{t.cTests}: {state.counts.testResults}</li>
            <li>{t.cEvents}: {state.counts.events}</li>
          </ul>
        </div>
      )}
    </Card>
  );
}
