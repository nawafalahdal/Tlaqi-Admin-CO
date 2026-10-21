"use client";

import { brandInk } from "@/lib/brand";
import { useState, useTransition } from "react";
import { submitTerminationAction, withdrawTerminationAction } from "@/app/admin/terminations/actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

type Open = {
  id: string;
  status: string;
  reason: string;
  assignmentLabel: string;
  submittedAt: string;
  requestedEndDate: string | null;
  decisionNote: string | null;
  meetingNote: string | null;
};

/** «طلب إنهاء فترة الإدارة في تَـــلاقِ» — من جهة صاحبه.
 *
 *  ويُنصّ له على أن الرفع لا يُعطّله: من يظنّ الطلب خروجاً فورياً لا
 *  يرفعه وهو يحتاجه، أو يرفعه فيُفاجأ. */
export function TerminationRequestCard({
  open,
  theme,
}: {
  open: Open | null;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const L = useTranslations().termCard;
  const [reason, setReason] = useState("");
  const [endDate, setEndDate] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      const res = await submitTerminationAction(reason, endDate || undefined);
      if (res.error) setErr(res.error);
      else {
        setReason("");
        setEndDate("");
        setShow(false);
      }
    });
  }

  function withdraw() {
    if (!open) return;
    setErr(null);
    start(async () => {
      const res = await withdrawTerminationAction(open.id);
      if (res.error) setErr(res.error);
    });
  }

  if (open) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-bold">{L.title}</h2>
        <p className="mt-1.5 text-xs font-semibold" style={{ color: brandInk(theme) }}>
          {L.status[open.status as keyof typeof L.status] ?? open.status}
        </p>
        <dl className="mt-3 flex flex-col gap-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="text-black/45">{L.assignment}</dt>
            <dd className="font-semibold">{open.assignmentLabel}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-black/45">{L.submitted}</dt>
            <dd>{open.submittedAt}</dd>
          </div>
          {open.requestedEndDate && (
            <div className="flex gap-2">
              <dt className="text-black/45">{L.endDate}</dt>
              <dd className="font-semibold">{open.requestedEndDate}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/70">
          {open.reason}
        </p>
        {open.meetingNote && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {L.managerNote.replace("{note}", open.meetingNote)}
          </p>
        )}
        {open.decisionNote && (
          <p className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-black/70">
            {open.decisionNote}
          </p>
        )}
        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
        {(open.status === "submitted" || open.status === "meeting_requested") && (
          <Button theme={theme} variant="outline" className="mt-3" disabled={pending} onClick={withdraw}>
            {pending ? L.withdrawing : L.withdraw}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">{L.title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/55">
        {L.introA}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-black/45">
        {L.introB}
      </p>

      {!show ? (
        <Button theme={theme} variant="outline" className="mt-3" onClick={() => setShow(true)}>
          {L.open}
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-black/70">{L.reason}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder={L.reasonPlaceholder}
              className="rounded-xl border border-black/10 px-3 py-2 text-xs leading-relaxed"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-black/70">{L.proposedEnd}</span>
            <input
              type="date"
              value={endDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setEndDate(e.target.value)}
              className="min-h-9 w-fit rounded-lg border border-black/10 px-2.5 py-1.5 text-xs"
            />
          </label>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
          <div className="flex gap-2">
            <Button theme={theme} disabled={pending} onClick={submit}>
              {pending ? L.submitting : L.submit}
            </Button>
            <Button theme={theme} variant="outline" disabled={pending} onClick={() => setShow(false)}>
              {L.cancel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
