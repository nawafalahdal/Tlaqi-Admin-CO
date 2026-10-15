"use client";

import { useActionState, useState } from "react";
import type { ImprovementKind, ImprovementState } from "@prisma/client";
import { advanceImprovementAction } from "@/app/improve/actions";

/** أزرارُ نقل الملاحظة في مسارها — ما يُنتقَل إليه فقط.
 *
 *  **والواجهةُ تُغذَّى بالحرس الذي يَفرضه الخادم:** لو عُرض كلُّ انتقالٍ
 *  ثم رُدّ أكثرُه لصار الصندوقُ بابَ رفضٍ لا بابَ عمل. فما يُرسَم هو ما
 *  يَقبله `advanceImprovement` من هذه الحالة بعينها.
 *
 *  والإغلاقُ وحده يَفتح حقلَ السبب قبل أن يُرسَل: ملاحظةٌ تُغلَق بلا
 *  كلمةٍ تُقرأ تجاهلاً، والخادمُ يَرفضها كذلك.
 */
const NEXT: Record<ImprovementState, readonly { to: ImprovementState; label: string }[]> = {
  new: [
    { to: "triaged", label: "صنّفها" },
    { to: "in_progress", label: "ابدأ العمل" },
    { to: "closed", label: "أغلقها بسبب" },
  ],
  triaged: [
    { to: "in_progress", label: "ابدأ العمل" },
    { to: "closed", label: "أغلقها بسبب" },
  ],
  in_progress: [
    { to: "awaiting_user", label: "أُصلحت — ليُجرّبها صاحبُها" },
    { to: "triaged", label: "أعِدها للتصنيف" },
    { to: "closed", label: "أغلقها بسبب" },
  ],
  awaiting_user: [{ to: "closed", label: "أغلقها بسبب" }],
  resolved: [
    { to: "closed", label: "أغلقها" },
    { to: "in_progress", label: "أعِدها للعمل" },
  ],
  closed: [{ to: "in_progress", label: "أعِد فتحها" }],
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
        >
          حوِّلها مهمّةً في لوحة التنفيذ ←
        </a>
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
              {o.label}
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
                {o.label}
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
            placeholder="لماذا تُغلَق؟ — صاحبُ الملاحظة يقرؤه"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <button
            type="submit"
            disabled={pending || reason.trim().length === 0}
            className="self-start rounded-lg bg-black/[0.08] px-3 py-1.5 text-xs font-bold text-black/70 disabled:opacity-40"
          >
            أغلِقها
          </button>
        </form>
      )}

      {result.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{result.error}</p>
      )}
    </div>
  );
}
