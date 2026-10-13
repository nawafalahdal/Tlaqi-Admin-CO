"use client";

import { useState, useTransition } from "react";
import { permanentlyDeleteUserAction } from "@/app/admin/accounts/actions";
import { Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { themeFromColor } from "@/lib/brand";

const APPROVAL_LABEL: Record<string, string> = {
  approved: "معتمد",
  pending_review: "بانتظار الاعتماد",
  rejected: "مرفوض",
};

/** شاغلُ مقعدٍ مكرّر — بوقائعه وزرِّ محوه.
 *
 *  الوقائع الثلاث هي ما يُفرّق المكرّر الزائد عن القائد العامل:
 *
 *  • **«لم يُستعمل قطّ»** — أوثقها. حسابٌ لم يُغيَّر رمزُه المؤقّت ولم
 *    يُكمَل سجلُّه لم يدخله صاحبُه أصلاً.
 *  • **«غير معتمد» أو «لا سجلّ ترشّح»** — الحساب الذي أُنشئ خطأً لا
 *    يقابله سجلُّ ترشّحٍ معتمَد.
 *  • **تاريخ الإنشاء** — الأقدم غالباً هو القديم المنسيّ.
 *
 *  والمحو يحمل `force` لأن الحساب نشطٌ بطبعه هنا: المقعد المتعارض
 *  شاغلوه نشطون. ويبقى تأكيد البريد والسبب. */
export function SeatHolderRow({
  holder,
  canPurge,
  theme,
}: {
  holder: {
    id: string;
    fullName: string;
    email: string;
    createdAt: string;
    everUsed: boolean;
    approvalStatus: string | null;
  };
  canPurge: boolean;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="rounded-xl bg-green-50 px-3 py-2.5 text-xs font-semibold text-green-800">
        {done}
      </div>
    );
  }

  const approval = holder.approvalStatus
    ? (APPROVAL_LABEL[holder.approvalStatus] ?? holder.approvalStatus)
    : "لا سجلّ ترشّح";
  const suspect = !holder.everUsed || holder.approvalStatus !== "approved";

  return (
    <div className="rounded-xl bg-white/80 p-3 ring-1 ring-black/5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-black/80">{holder.fullName}</p>
          <p className="break-all text-[11px] text-black/45" dir="ltr">
            {holder.email}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                holder.everUsed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
              }`}
            >
              {holder.everUsed ? "استُعمل" : "لم يُستعمل قطّ"}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                holder.approvalStatus === "approved"
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-900"
              }`}
            >
              {approval}
            </span>
            <span className="text-[10px] text-black/40">
              أُنشئ {formatDate(holder.createdAt)}
            </span>
          </div>
        </div>

        {canPurge && !open && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-xs font-bold ${
              suspect
                ? "bg-red-600 text-white"
                : "bg-red-50 text-red-800 ring-1 ring-red-300"
            }`}
          >
            حذف نهائي
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2.5 border-t border-black/5 pt-3">
          <p className="text-[11px] leading-relaxed text-red-900/80">
            يُزال الصفّ من قاعدة البيانات ويتحرّر البريد. ويبقى في الإكسل سجلٌّ بالاسم والدور
            وسبب الحذف — بلا البريد. والتذاكر تُفَكّ ولا تُحذف.
          </p>
          <input
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            dir="ltr"
            type="email"
            placeholder={holder.email}
            aria-label="اكتب بريد الحساب للتأكيد"
            className="min-h-11 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs outline-none focus:border-red-400"
          />
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="سبب الحذف (يُسجَّل في الإكسل)"
            aria-label="سبب الحذف"
            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs outline-none focus:border-red-400"
          />
          {error && <p className="text-xs font-semibold leading-relaxed text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length < 5 || !confirmEmail.trim()}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  // `force` لأن شاغل المقعد المتعارض نشطٌ بطبعه
                  const res = await permanentlyDeleteUserAction(
                    holder.id,
                    confirmEmail,
                    reason,
                    true
                  );
                  if (res.error) {
                    setError(res.error);
                    return;
                  }
                  setDone(
                    res.emailFreed
                      ? `حُذف ${holder.fullName} — وتحرّر بريده.`
                      : `حُذف ${holder.fullName} — والبريد ما زال محجوزاً في ${res.heldBy ?? "سجلٍّ آخر"}.`
                  );
                });
              }}
              className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              {pending ? "جارِ التنفيذ..." : "احذف نهائياً"}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
