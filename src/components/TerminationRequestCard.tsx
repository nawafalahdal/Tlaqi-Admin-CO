"use client";

import { useState, useTransition } from "react";
import { submitTerminationAction, withdrawTerminationAction } from "@/app/admin/terminations/actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

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

const LABEL: Record<string, string> = {
  submitted: "مرفوع — ينتظر قرار مسؤولك",
  meeting_requested: "طلب مسؤولك لقاءً قبل أن يقرّر — وطلبك قائم",
  approved: "وُوفق عليه — تبقى على عملك حتى تاريخ الانتهاء",
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
        <h2 className="text-sm font-bold">طلب إنهاء فترة الإدارة في تَـــلاقِ</h2>
        <p className="mt-1.5 text-xs font-semibold" style={{ color: theme.accentDark }}>
          {LABEL[open.status] ?? open.status}
        </p>
        <dl className="mt-3 flex flex-col gap-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="text-black/45">التكليف</dt>
            <dd className="font-semibold">{open.assignmentLabel}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-black/45">رُفع</dt>
            <dd>{open.submittedAt}</dd>
          </div>
          {open.requestedEndDate && (
            <div className="flex gap-2">
              <dt className="text-black/45">تاريخ الانتهاء</dt>
              <dd className="font-semibold">{open.requestedEndDate}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/70">
          {open.reason}
        </p>
        {open.meetingNote && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ملاحظة مسؤولك: {open.meetingNote}
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
            {pending ? "يُسحَب..." : "اسحب طلبي"}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">طلب إنهاء فترة الإدارة في تَـــلاقِ</h2>
      <p className="mt-1 text-xs leading-relaxed text-black/55">
        إن أردت إنهاء فترتك، ارفع طلبك بنفسك ولا تنتظر أن يُقرَّر عنك. ويصل مسؤولك وحده.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-black/45">
        ورفعُ الطلب لا يُوقف عملك ولا يُعطّل حسابك: تبقى على تكليفك حتى يُقرّر مسؤولك وتحلّ
        المهلة. وقد يطلب لقاءً قبل أن يقرّر.
      </p>

      {!show ? (
        <Button theme={theme} variant="outline" className="mt-3" onClick={() => setShow(true)}>
          ارفع طلباً
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-black/70">سبب الطلب</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="اكتب سببك بكلماتك — يقرأه مسؤولك"
              className="rounded-xl border border-black/10 px-3 py-2 text-xs leading-relaxed"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-black/70">تاريخ انتهاء مقترح (اختياري)</span>
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
              {pending ? "يُرفَع..." : "ارفع الطلب"}
            </Button>
            <Button theme={theme} variant="outline" disabled={pending} onClick={() => setShow(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
