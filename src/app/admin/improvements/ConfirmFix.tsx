"use client";

import { useActionState, useState } from "react";
import { confirmImprovementAction } from "@/app/improve/actions";

import { useTranslations } from "@/i18n/LocaleProvider";
/** شهادةُ صاحب الملاحظة — جرّبها فزالت، أو هي كما كانت.
 *
 *  **وهذا هو الحكمُ الذي يُميّز مركزَ التحسين عن طابورِ تذاكر:** من رأى
 *  العطبَ هو من يَشهد بزواله. فلا يُقال «أُصلح» ثم يُفتَح البابُ فيُرى
 *  كما كان — ولا يُغلَق على صاحبه ما لم يَشهد أنه أُغلق.
 */
export function ConfirmFix({ ticketId }: { ticketId: string }) {
  const L = useTranslations().rConfirmFix;
  const [result, action, pending] = useActionState(confirmImprovementAction, { error: null });
  const [rejecting, setRejecting] = useState(false);

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="verified" value="yes" />
          <button
            type="submit"
            disabled={pending}
            className="btn-brand rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          >{L.iTriedItIt}</button>
        </form>
        <button
          type="button"
          onClick={() => setRejecting((v) => !v)}
          className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold text-black/60 hover:bg-black/[0.04]"
        >{L.itSStillThe}</button>
      </div>

      {rejecting && (
        <form action={action} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="verified" value="no" />
          <textarea
            name="note"
            rows={2}
            placeholder={L.whatIsStillHappening}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <button
            type="submit"
            disabled={pending}
            className="self-start rounded-lg bg-black/[0.08] px-3 py-1.5 text-xs font-bold text-black/70 disabled:opacity-50"
          >{L.sendItBackTo}</button>
        </form>
      )}

      {result.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{result.error}</p>
      )}
    </div>
  );
}
