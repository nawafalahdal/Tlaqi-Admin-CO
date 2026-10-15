"use client";

import { useState, useTransition } from "react";
import { decideCommitteeAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** طابورُ اللجان المنتظِرة — أمام المدير التنفيذي (والمؤسس).
 *
 *  والردُّ لا يُقبَل بلا سببٍ مكتوب، والواجهةُ تُظهر ذلك قبل الضغط لا
 *  بعده: الحقلُ يُفتَح ويُطلَب، فلا يُضغَط زرٌّ ثم يُرَدّ بخطأ. وهو
 *  الحرسُ نفسه المفروض في الخادم — الواجهةُ تُعلِنه لا تَنفرد به.
 */

export type PendingCommittee = {
  id: string;
  name: string;
  colorHex: string;
  leadTitle: string | null;
  requestedByName: string | null;
  parentName: string;
  parentColorHex: string;
};

export function CommitteeRequests({
  requests,
  theme,
}: {
  requests: PendingCommittee[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [done, setDone] = useState<string | null>(null);

  if (requests.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-black/45">
        لا اقتراحات لجان بانتظار قرارك. وقائدُ كل قسمٍ يقترح لجانَ قسمه من لوحته، فتَصلك هنا — ولا
        تُفتح لجنةٌ ولا يُدعى لها قائدٌ قبل اعتمادك.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {done && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p>
      )}
      {requests.map((r) => (
        <RequestRow key={r.id} request={r} theme={theme} onDone={setDone} />
      ))}
    </div>
  );
}

function RequestRow({
  request: r,
  theme,
  onDone,
}: {
  request: PendingCommittee;
  theme: ReturnType<typeof themeFromColor>;
  onDone: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  function decide(decision: "approved" | "rejected") {
    start(async () => {
      setError(null);
      const res = await decideCommitteeAction(r.id, decision, note);
      if (res.error) setError(res.error);
      else if (res.message) onDone(res.message);
    });
  }

  return (
    <div className="rounded-2xl border border-black/5 p-3.5">
      <div className="flex items-start gap-3">
        {/* اللونُ لونُ القسم، والإطارُ المتقطّعُ هو ما يقول «لجنة» */}
        <span
          className="mt-0.5 h-9 w-9 shrink-0 rounded-xl border-2 border-dashed"
          style={{ background: `${r.parentColorHex}2E`, borderColor: r.parentColorHex }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">
            لجنة {r.name}{" "}
            <span className="font-medium text-black/45">داخل {r.parentName}</span>
          </h3>
          <p className="mt-0.5 text-xs text-black/45">
            تأخذ لون «{r.parentName}» بإطارٍ متقطّعٍ يميّزها · مسمّى قائدها:{" "}
            {r.leadTitle?.trim() || `قائد لجنة ${r.name}`}
            {r.requestedByName ? ` · اقترحها ${r.requestedByName}` : ""}
          </p>
        </div>
      </div>

      {rejecting && (
        <label className="mt-3 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">سببُ الردّ — يقرؤه مقترِحُها</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            required
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            placeholder="مثال: نطاقُها يتقاطع مع لجنةٍ قائمة — ادمِجها فيها"
          />
        </label>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
        {!rejecting ? (
          <>
            <Button theme={theme} disabled={pending} onClick={() => decide("approved")}>
              {pending ? "جارٍ..." : "اعتمدها وافتحها"}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setRejecting(true)}>
              ردّها بسبب
            </Button>
          </>
        ) : (
          <>
            <Button
              theme={theme}
              disabled={pending || note.trim().length === 0}
              onClick={() => decide("rejected")}
            >
              {pending ? "جارٍ..." : "أرسل الردّ"}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setRejecting(false)}>
              إلغاء
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
