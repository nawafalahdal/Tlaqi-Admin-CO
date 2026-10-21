"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteUnusedInviteAction } from "./actions";

import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
/** حذفُ دعوةٍ لم تُستعمَل — بتأكيدٍ، ويُقال سببُ الرفض كما جاء من الخادم */
export function DeleteInviteButton({ inviteId, name }: { inviteId: string; name: string }) {
  const L = useTranslations().rInviteDelete;
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
        aria-label={fmt(L.deleteSUnusedInvitation, name)}
      >{L.delete}</button>
      <ConfirmDialog
        open={open}
        title={L.deleteAnUnusedInvitation}
        body={fmt(L.sInvitationWillBe, name)}
        confirmLabel={L.deleteTheInvitation}
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
