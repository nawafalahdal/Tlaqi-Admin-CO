"use client";

import { useState, useTransition } from "react";
import { decideDepartmentRequestAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

/** طابورُ طلبات إنشاء الأقسام — أمام المؤسس وحده.
 *
 *  والردُّ لا يُقبَل بلا سببٍ مكتوب، والحقلُ يُطلَب قبل الضغط لا بعده —
 *  وهو الحرسُ نفسُه المفروض في الخادم (`decideDepartmentRequest`). */

export type PendingDepartment = {
  id: string;
  name: string;
  colorHex: string;
  leadershipOnly: boolean;
  requestedByName: string | null;
  requestedAt: string | null;
};

export function DepartmentRequests({
  requests,
  theme,
}: {
  requests: PendingDepartment[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p>}
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
  request: PendingDepartment;
  theme: ReturnType<typeof themeFromColor>;
  onDone: (message: string) => void;
}) {
  const dict = useTranslations();
  const t = dict.deptAdmin;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  function decide(decision: "approved" | "rejected") {
    start(async () => {
      setError(null);
      const res = await decideDepartmentRequestAction(r.id, decision, note);
      if (res.error) setError(res.error);
      else if (res.message) onDone(res.message);
    });
  }

  return (
    <div className="rounded-2xl border border-black/5 p-3.5">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 h-9 w-9 shrink-0 rounded-xl ring-1 ring-inset ring-black/10"
          style={{ background: r.colorHex }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">
            {r.name}
            {r.leadershipOnly && <span className="ms-2 text-xs font-semibold text-black/45">{t.exceptionalShort}</span>}
          </h3>
          <p className="mt-0.5 text-xs text-black/45">
            {r.requestedByName ? `${t.requestedBy}: ${r.requestedByName}` : ""}
            {r.requestedAt ? ` · ${r.requestedAt}` : ""}
          </p>
        </div>
      </div>

      {rejecting && (
        <label className="mt-3 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.rejectReasonLabel}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            required
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            placeholder={t.rejectPlaceholder}
          />
        </label>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
        {!rejecting ? (
          <>
            <Button theme={theme} disabled={pending} onClick={() => decide("approved")}>
              {pending ? "…" : t.approveBuild}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setRejecting(true)}>
              {t.rejectWithReason}
            </Button>
          </>
        ) : (
          <>
            <Button theme={theme} disabled={pending || note.trim().length === 0} onClick={() => decide("rejected")}>
              {pending ? "…" : t.sendReject}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setRejecting(false)}>
              {dict.common.cancel}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
