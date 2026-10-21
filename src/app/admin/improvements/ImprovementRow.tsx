"use client";

import { useActionState, useState } from "react";
import type { ImprovementKind, ImprovementState } from "@prisma/client";
import { advanceImprovementAction } from "@/app/improve/actions";

import { useTranslations } from "@/i18n/LocaleProvider";
/** أزرارُ نقل الملاحظة في مسارها — ما يُنتقَل إليه فقط.
 *
 *  **والواجهةُ تُغذَّى بالحرس الذي يَفرضه الخادم:** لو عُرض كلُّ انتقالٍ
 *  ثم رُدّ أكثرُه لصار الصندوقُ بابَ رفضٍ لا بابَ عمل. فما يُرسَم هو ما
 *  يَقبله `advanceImprovement` من هذه الحالة بعينها.
 *
 *  والإغلاقُ وحده يَفتح حقلَ السبب قبل أن يُرسَل: ملاحظةٌ تُغلَق بلا
 *  كلمةٍ تُقرأ تجاهلاً، والخادمُ يَرفضها كذلك.
 */
// أسماءُ الخطوات من القاموس (`next`) — هنا الانتقالاتُ ومفاتيحُ أسمائها
type NextLabel = "triage" | "start" | "closeWithReason" | "fixed" | "backToTriage" | "close" | "backToWork" | "reopen";

const NEXT: Record<ImprovementState, readonly { to: ImprovementState; label: NextLabel }[]> = {
  new: [
    { to: "triaged", label: "triage" },
    { to: "in_progress", label: "start" },
    { to: "closed", label: "closeWithReason" },
  ],
  triaged: [
    { to: "in_progress", label: "start" },
    { to: "closed", label: "closeWithReason" },
  ],
  in_progress: [
    { to: "awaiting_user", label: "fixed" },
    { to: "triaged", label: "backToTriage" },
    { to: "closed", label: "closeWithReason" },
  ],
  awaiting_user: [{ to: "closed", label: "closeWithReason" }],
  resolved: [
    { to: "closed", label: "close" },
    { to: "in_progress", label: "backToWork" },
  ],
  closed: [{ to: "in_progress", label: "reopen" }],
};

export function ImprovementRow({
  ticketId,
  state,
  kind,
}: {
  ticketId: string;
  state: ImprovementState;
  kind: ImprovementKind;
}) {
  const L = useTranslations().rImprRow;
  const [result, action, pending] = useActionState(advanceImprovementAction, { error: null });
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");

  const options = NEXT[state];
  if (options.length === 0) return null;

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      {/* الفكرةُ تُحوَّل عملاً: الزرُّ يَفتح لوحةَ التنفيذ بعنوانها جاهزاً،
          فلا تُنسَخ باليد ولا تُفقَد في النقل */}
      {kind === "idea" && (state === "new" || state === "triaged") && (
        <a
          href="/admin/execution"
          className="mb-2 inline-block rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-black/65 hover:bg-black/[0.04]"
        >{L.turnItIntoA}</a>
      )}

      <div className="flex flex-wrap gap-2">
        {options.map((o) =>
          o.to === "closed" ? (
            <button
              key={o.to}
              type="button"
              onClick={() => setClosing((v) => !v)}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-black/60 hover:bg-black/[0.04]"
            >
              {L.next[o.label]}
            </button>
          ) : (
            <form key={o.to} action={action}>
              <input type="hidden" name="ticketId" value={ticketId} />
              <input type="hidden" name="to" value={o.to} />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-black/70 hover:bg-black/[0.04] disabled:opacity-50"
              >
                {L.next[o.label]}
              </button>
            </form>
          )
        )}
      </div>

      {closing && (
        <form action={action} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="to" value="closed" />
          <textarea
            name="note"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={L.whyIsItBeing}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <button
            type="submit"
            disabled={pending || reason.trim().length === 0}
            className="self-start rounded-lg bg-black/[0.08] px-3 py-1.5 text-xs font-bold text-black/70 disabled:opacity-40"
          >{L.closeIt}</button>
        </form>
      )}

      {result.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{result.error}</p>
      )}
    </div>
  );
}
