"use client";

import { useState, useTransition } from "react";
import { prepareTabsAction } from "./actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function PrepareTabs({ theme }: { theme: ReturnType<typeof themeFromColor> }) {
  const t = useTranslations().sheetPage;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<string[] | null>(null);

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6">
      <div>
        <h2 className="text-base font-bold sm:text-lg">{t.prepareTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-black/60">{t.prepareBody}</p>
      </div>

      <div>
        <Button
          theme={theme}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              setPrepared(null);
              const res = await prepareTabsAction();
              if (res.error) setError(res.error);
              else setPrepared(res.prepared);
            })
          }
        >
          {pending ? t.preparing : t.prepareRun}
        </Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {prepared && (
        <div className="rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-900">
          <p className="font-bold">{t.prepareDone}</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {prepared.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
