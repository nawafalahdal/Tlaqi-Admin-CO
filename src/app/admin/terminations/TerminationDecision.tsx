"use client";

import { useState, useTransition } from "react";
import { decideTerminationAction } from "./actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

type Req = {
  id: string;
  status: string;
  memberName: string;
  memberEmail: string;
  assignmentLabel: string;
  reason: string;
  submittedAt: string;
  requestedEndDate: string | null;
  requestedEndIso: string;
  meetingNote: string | null;
};

/** قرار المسؤول: موافقةٌ بتاريخ، أو رفضٌ بتفسير، أو طلبُ لقاء.
 *
 *  والخيارات الثلاثة معروضةٌ معاً: مسؤولٌ يرى زرَّي موافقةٍ ورفضٍ فقط
 *  يقرّر على عجلٍ في أمرٍ يستحقّ حواراً. */
export function TerminationDecision({
  requests,
  theme,
}: {
  requests: Req[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>(
    Object.fromEntries(requests.map((r) => [r.id, r.requestedEndIso]))
  );
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, start] = useTransition();

  function decide(r: Req, decision: "approve" | "reject" | "request_meeting") {
    setMsg(null);
    start(async () => {
      const res = await decideTerminationAction(r.id, decision, notes[r.id], dates[r.id]);
      setMsg(
        res.error
          ? { kind: "err", text: res.error }
          : {
              kind: "ok",
              text:
                decision === "approve"
                  ? "وُوفق — ويُنفَّذ الخروج عند حلول التاريخ"
                  : decision === "reject"
                    ? "رُفض الطلب وأُبلِغ صاحبه بالتفسير"
                    : "طُلب اللقاء — والطلب قائمٌ كما هو",
            }
      );
    });
  }

  if (requests.length === 0) {
    return <Card className="p-6 text-center text-sm text-black/40">لا طلبات إنهاءٍ معلّقة</Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}

      {requests.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">{r.memberName}</span>
            <span className="text-xs text-black/45">{r.assignmentLabel}</span>
            {r.status === "meeting_requested" && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                طُلب لقاء — لم يُحسم
              </span>
            )}
            {r.status === "approved" && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                وُوفق — ينتظر حلول التاريخ
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-black/40" dir="ltr">
            {r.memberEmail}
          </p>
          <p className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/70">
            {r.reason}
          </p>
          <p className="mt-2 text-xs text-black/40">
            رُفع {r.submittedAt}
            {r.requestedEndDate ? ` · التاريخ المقترح ${r.requestedEndDate}` : ""}
          </p>
          {r.meetingNote && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ما قيل في طلب اللقاء: {r.meetingNote}
            </p>
          )}

          {r.status !== "approved" && (
            <>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-black/55">تاريخ الانتهاء عند الموافقة</span>
                  <input
                    type="date"
                    value={dates[r.id] ?? ""}
                    onChange={(e) => setDates((d) => ({ ...d, [r.id]: e.target.value }))}
                    className="min-h-9 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs"
                  />
                </label>
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
                  <span className="text-black/55">تفسير الرفض / ملاحظة</span>
                  <input
                    type="text"
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="مطلوب عند الرفض"
                    className="min-h-9 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button theme={theme} disabled={busy} onClick={() => decide(r, "approve")}>
                  موافقة
                </Button>
                <Button
                  theme={theme}
                  variant="outline"
                  disabled={busy}
                  onClick={() => decide(r, "request_meeting")}
                >
                  أطلب لقاءً أولاً
                </Button>
                <Button
                  theme={theme}
                  variant="outline"
                  disabled={busy}
                  onClick={() => decide(r, "reject")}
                >
                  رفض
                </Button>
              </div>
              <p className="mt-2 text-xs text-black/40">
                طلبُ اللقاء ليس موافقةً ولا رفضاً — يبقى الطلب قائماً وتقرّر بعده.
              </p>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
