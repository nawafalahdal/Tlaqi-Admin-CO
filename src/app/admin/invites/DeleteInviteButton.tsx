"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteUnusedInviteAction } from "./actions";

/** حذفُ دعوةٍ لم تُستعمَل — بتأكيدٍ، ويُقال سببُ الرفض كما جاء من الخادم */
export function DeleteInviteButton({ inviteId, name }: { inviteId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-2.5 py-1 text-xs font-bold text-red-700 ring-1 ring-red-200"
        aria-label={`حذف دعوة ${name} غير المستخدمة`}
      >
        حذف
      </button>
      <ConfirmDialog
        open={open}
        title="حذف دعوة غير مستخدمة"
        body={`تُحذف دعوة ${name}: لم يدخل صاحبها ولم يُعتمَد. ويُسجَّل الحذف في السجل الحي باسمك.`}
        confirmLabel="حذف الدعوة"
        tone="danger"
        pending={pending}
        error={error}
        onConfirm={() => {
          setError(null);
          start(async () => {
            const res = await deleteUnusedInviteAction(inviteId);
            if (res.error) return setError(res.error);
            setOpen(false);
            router.refresh();
          });
        }}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />
    </>
  );
}
