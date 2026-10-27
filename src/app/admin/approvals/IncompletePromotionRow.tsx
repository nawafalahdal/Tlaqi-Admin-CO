"use client";

import { useState, useTransition } from "react";
import { completeLeadershipPromotionAction } from "../actions";
import { themeFromColor } from "@/lib/brand";
import { Button, Card } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";

/** اعتمادٌ قياديٌّ تعثّر: صاحبُه معتمَدٌ بلا حسابٍ إداري، فيدخل عضواً.
 *  الزرُّ يُنشئ الحسابَ الذي قُرِّر — والخادمُ يعيد فحصَ المنصب والصلاحية. */
export function IncompletePromotionRow({
  member,
}: {
  member: { id: string; fullName: string; email: string; positionName: string; departmentColor: string };
}) {
  const t = useTranslations();
  const L = t.admin;
  const theme = themeFromColor(member.departmentColor);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function complete() {
    setError(null);
    startTransition(async () => {
      try {
        await completeLeadershipPromotionAction(member.id);
        setDone(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <Card
      className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
      style={{ borderInlineStartWidth: 4, borderInlineStartColor: theme.base }}
    >
      <div>
        <p className="text-sm font-semibold">{member.fullName}</p>
        <p className="text-xs text-black/50" dir="ltr">
          {member.email}
        </p>
        <p className="mt-1 text-xs text-black/50">{member.positionName}</p>
      </div>
      {done ? (
        <p role="status" className="text-sm font-semibold text-green-800">
          {L.completePromotionDone.replace("{name}", member.fullName)}
        </p>
      ) : (
        <Button theme={theme} disabled={pending} onClick={complete}>
          {L.completePromotion}
        </Button>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:basis-full">
          {error}
        </p>
      )}
    </Card>
  );
}
