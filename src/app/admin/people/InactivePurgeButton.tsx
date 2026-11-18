"use client";

import { useState, useTransition } from "react";
import { permanentlyDeleteMemberAction as permanentlyDeleteMemberAction__server } from "./actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslations } from "@/i18n/LocaleProvider";
import { guardAction } from "@/lib/actionGuard";

// فشلُ نقل الإجراء (نسخةٌ سابقة أو انقطاع) يُعاد خطأً في مكانه لا صفحةَ خطأ (`lib/actionGuard`)
const permanentlyDeleteMemberAction = guardAction(permanentlyDeleteMemberAction__server);

/** **حذفٌ نهائيٌّ لسجلٍّ متوقفٍ أو مرفوض** — للمؤسس وحده (طلبُ المؤسس، 18 نوفمبر 2026).
 *
 *  كان «المتوقفون والمرفوضون» جدولاً يُقرأ بلا طريق: السجلُّ لا يقبل دخولاً، لكنه يحجز بريدَ صاحبه ويبقى في الأعداد.
 *  والإجراءُ نفسُه طريقُ الحذف الواحد (`permanentlyDeleteAccount`): الشاهدةُ في الشيت أولاً، وتُفَكّ التذاكر ولا تُحذف،
 *  ويتحرّر البريد. والبريدُ مكتوباً كاملاً وسببٌ — فلا يقع بنقرةٍ في المكان الخطأ. و`force` لا يُرسَل: السجلُّ متوقفٌ
 *  أو مرفوض، فشرطُ «النشط» الذي يختصره غيرُ قائم — ومن له حسابٌ قياديٌّ نشطٌ بالبريد نفسه يرفضه الخادمُ باسمه. */
export function InactivePurgeButton({ member }: { member: { id: string; fullName: string; email: string } }) {
  const t = useTranslations().stuck;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return <span className="text-xs font-semibold text-green-800">{t.purgeDone}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex min-h-9 items-center rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-800 ring-1 ring-red-300 hover:bg-red-100"
      >
        {t.purgeTitle}
      </button>
      <ConfirmDialog
        open={open}
        title={`${t.purgeTitle} — ${member.fullName}`}
        confirmLabel={t.purgeConfirm}
        pending={pending}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          if (!email.trim() || reason.trim().length < 5) {
            setError(t.purgeMissing);
            return;
          }
          setError(null);
          startTransition(async () => {
            const res = await permanentlyDeleteMemberAction(member.id, email, reason, false);
            if (res.error) {
              setError(res.error);
              return;
            }
            setOpen(false);
            setDone(true);
          });
        }}
        body={
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-red-900/80">{t.purgeWarning}</p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-black/70">{t.typeEmail}</span>
              <input
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                dir="ltr"
                type="email"
                autoComplete="off"
                placeholder={member.email}
                className="min-h-11 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm text-black outline-none focus:border-red-400"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-black/70">{t.reasonPlaceholder}</span>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                rows={2}
                maxLength={300}
                className="rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm text-black outline-none focus:border-red-400"
              />
            </label>
          </div>
        }
      />
    </>
  );
}
