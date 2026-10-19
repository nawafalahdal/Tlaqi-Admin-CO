"use client";

import { useState, useTransition } from "react";
import { approveMemberAction, rejectMemberAction } from "./actions";
import { themeFromColor, brandInk} from "@/lib/brand";
import { Button, Card } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
  onApproved: (fullName: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const theme = themeFromColor(member.departmentColor);
  const t = useTranslations();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // رفضُ الخادم (صلاحيةٌ أو حالةٌ تغيّرت) يُعرض نصّاً — كان يُرمى فيُسقط الصفحة
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveMemberAction(member.id);
        onApproved(member.fullName);
      } catch (e) {
        setError(message(e));
      }
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      try {
        await rejectMemberAction(member.id);
        setAsking(false);
      } catch (e) {
        setError(message(e));
      }
    });
  }

  return (
    <Card
      className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
      style={{ borderInlineStartWidth: 4, borderInlineStartColor: theme.base }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: theme.surface, color: theme.onSurface }}
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
          <p className="text-sm font-bold" style={{ color: brandInk(theme) }}>
            {t.admin.testScoreLabel}: {member.testScore}%
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            theme={theme}
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null);
              setAsking(true);
            }}
          >
            {t.admin.reject}
          </Button>
          <Button theme={theme} disabled={pending} onClick={handleApprove}>
            {t.admin.approveFinal}
          </Button>
        </div>
      </div>
      {error && !asking && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:basis-full">
          {error}
        </p>
      )}

      {/* الرفضُ يُغلق الطلب — فلا يكون بنقرةٍ واحدة بجوار «اعتماد» */}
      <ConfirmDialog
        open={asking}
        title={t.admin.rejectConfirmTitle.replace("{name}", member.fullName)}
        body={t.admin.rejectConfirmBody}
        confirmLabel={t.admin.reject}
        pending={pending}
        error={error}
        onConfirm={handleReject}
        onCancel={() => setAsking(false)}
      />
    </Card>
  );
}
