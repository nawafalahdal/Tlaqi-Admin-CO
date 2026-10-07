"use client";

import { useState, useTransition } from "react";
import { reopenCandidateTestAction, purgeCandidateAction } from "./actions";
import { Button, Card } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

export type StuckCandidate = {
  id: string;
  fullName: string;
  email: string;
  scope: string;
  stage: string;
  testScore: number | null;
  warningsCount: number;
  reopenCount: number;
  canReopen: boolean;
};

/** بطاقة مرشّح عالق: تُظهر كل ما يُبنى عليه القرار قبل اتخاذه — نتيجته،
 *  وعدد تنبيهاته، وكم مرة أُعيد له الاختبار — ثم تتيح الإجراءين. */
export function StuckCandidateRow({
  candidate,
  canPurge,
  theme,
}: {
  candidate: StuckCandidate;
  canPurge: boolean;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const dict = useTranslations();
  const t = dict.stuck;
  const [panel, setPanel] = useState<"none" | "reopen" | "purge">("none");
  const [meetingHeld, setMeetingHeld] = useState(false);
  const [note, setNote] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runReopen() {
    setError(null);
    startTransition(async () => {
      const res = await reopenCandidateTestAction(candidate.id, meetingHeld, note);
      if (res.error) setError(res.error);
      else {
        setDone(t.reopenDone);
        setPanel("none");
      }
    });
  }

  function runPurge() {
    setError(null);
    startTransition(async () => {
      const res = await purgeCandidateAction(candidate.id, confirmEmail, reason);
      if (res.error) setError(res.error);
      else setDone(t.purgeDone);
    });
  }

  if (done) {
    return (
      <Card className="p-4">
        <p className="text-sm font-semibold text-emerald-700">{done}</p>
        <p className="mt-1 text-xs text-black/45">{candidate.email}</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{candidate.fullName}</p>
          <p className="mt-0.5 break-all text-xs text-black/45">{candidate.email}</p>
          <p className="mt-0.5 text-xs text-black/45">{candidate.scope}</p>
        </div>
        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-semibold text-black/70">
          {candidate.stage}
        </span>
      </div>

      {/* معطيات القرار مجتمعة: لا يُحذف أحد ولا يُعاد اختباره على غير بيّنة */}
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-black/5 pt-3 text-xs">
        <Stat label={t.score} value={candidate.testScore === null ? "—" : `${candidate.testScore}%`} />
        <Stat
          label={t.warnings}
          value={`${candidate.warningsCount} / 3`}
          alarm={candidate.warningsCount >= 3}
        />
        <Stat label={t.reopens} value={String(candidate.reopenCount)} />
      </dl>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {panel === "none" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidate.canReopen && (
            <Button theme={theme} variant="outline" onClick={() => setPanel("reopen")}>
              {t.reopenTitle}
            </Button>
          )}
          {canPurge && (
            <button
              type="button"
              onClick={() => setPanel("purge")}
              className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              {t.purgeTitle}
            </button>
          )}
        </div>
      )}

      {panel === "reopen" && (
        <div className="mt-3 flex flex-col gap-3 border-t border-black/5 pt-3">
          <p className="text-xs leading-relaxed text-black/50">{t.reopenHint}</p>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={meetingHeld}
              onChange={(e) => setMeetingHeld(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="font-medium text-black/70">{t.meetingHeld}</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t.notePlaceholder}
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button theme={theme} onClick={runReopen} disabled={pending || !meetingHeld}>
              {pending ? t.working : t.reopenConfirm}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setPanel("none")}>
              {dict.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {panel === "purge" && (
        <div className="mt-3 flex flex-col gap-3 border-t border-black/5 pt-3">
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
            {t.purgeWarning}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t.reasonPlaceholder}
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.typeEmail}</span>
            <input
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              dir="ltr"
              placeholder={candidate.email}
              className="min-h-11 rounded-xl border border-black/10 px-3.5 text-sm outline-none focus:border-black/30"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runPurge}
              disabled={pending || confirmEmail.trim().toLowerCase() !== candidate.email.toLowerCase()}
              className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pending ? t.working : t.purgeConfirm}
            </button>
            <Button theme={theme} variant="outline" onClick={() => setPanel("none")}>
              {dict.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, alarm }: { label: string; value: string; alarm?: boolean }) {
  return (
    <div>
      <dt className="text-black/40">{label}</dt>
      <dd className={`mt-0.5 font-bold ${alarm ? "text-red-700" : "text-black/75"}`}>{value}</dd>
    </div>
  );
}
