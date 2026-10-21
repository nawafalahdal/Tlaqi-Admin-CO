"use client";

import { useState, useTransition } from "react";
import {
  updateTaskStateAction,
  reviewTaskAction,
  changeDeadlineAction,
  waiveTaskAction,
  recordCarryoverPlanAction,
} from "@/app/admin/execution/actions";
import { SubmitWork } from "./SubmitWork";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

/** بطاقةُ مهمّة — واحدةٌ تُعرَض لثلاثة: صاحبُها، وقائدُ قسمها، والمُراجِع.
 *
 *  **والقدراتُ تُمرَّر لا تُستنتَج في المتصفّح:** الخادمُ يقرّر من يرى
 *  أيَّ زرّ ويُمرّره في `can`، والإجراءُ نفسُه يَفحص الصلاحيةَ ثانيةً.
 *  فالزرُّ المخفيُّ راحةٌ للعين، والحرسُ في الخادم.
 *
 *  **والتاريخُ يُعرَض كما وقع:** الموعدُ الأصليُّ يُكتَب إلى جانب
 *  المعتمَد حين يختلفان، وعددُ الترحيلات يُقال صريحاً. فمن يقرأ
 *  البطاقةَ يعرف أن هذا الالتزام مُدِّد ورُحِّل، لا يَراه التزاماً
 *  جديداً نظيفاً.
 */

export type TaskView = {
  id: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string;
  deliverable: string | null;
  execState: string;
  priority: string;
  weight: number;
  dueAt: string;
  originalDueAt: string;
  carryoverCount: number;
  consecutiveCarryover: number;
  carryReason: string | null;
  correctivePlan: string | null;
  blockedReason: string | null;
  ownerName: string | null;
  departmentName: string | null;
  verifiedByName: string | null;
  reportedByName: string | null;
  waivedReason: string | null;
  overdue: boolean;
  countdown: string;
  lastSubmission: {
    id: string;
    note: string;
    evidenceUrl: string | null;
    evidenceFileName: string | null;
    submittedAt: string;
    submittedByName: string;
  } | null;
  lastReviewNote: string | null;
};

const STATE_TONE: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-900",
  submitted: "bg-amber-100 text-amber-900",
  blocked: "bg-red-50 text-red-700",
  returned: "bg-red-50 text-red-700",
  incomplete: "bg-red-50 text-red-700",
  waived: "bg-black/[0.06] text-black/55",
  cancelled: "bg-black/[0.06] text-black/55",
  superseded: "bg-black/[0.06] text-black/55",
  deferred: "bg-black/[0.06] text-black/55",
};

export function TaskCard({
  task,
  theme,
  can,
}: {
  task: TaskView;
  theme: ReturnType<typeof themeFromColor>;
  can: {
    /** صاحبُها أو قائدُ قسمها: يُحدِّث الحالةَ ويَرفع التسليم */
    work: boolean;
    /** المُراجِع: يتحقّق ويَردّ ويُمدِّد ويُسقِط */
    review: boolean;
    /** قائدُ القسم: يُقِرّ سببَ الترحيل وخطةَ تصحيحه */
    carryPlan: boolean;
  };
}) {
  const L = useTranslations().task;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<
    null | "submit" | "block" | "review" | "deadline" | "waive" | "carry"
  >(null);
  const [note, setNote] = useState("");
  const [note2, setNote2] = useState("");
  const [date, setDate] = useState("");

  function run(fn: () => Promise<{ error: string | null }>) {
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setPanel(null);
        setNote("");
        setNote2("");
      }
    });
  }

  const dueDiffers = task.originalDueAt.slice(0, 10) !== task.dueAt.slice(0, 10);

  return (
    <div
      className={`rounded-2xl border p-3.5 ${
        task.overdue ? "border-red-200 bg-red-50" : "border-black/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold leading-snug">{task.title}</h4>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                STATE_TONE[task.execState] ?? "bg-black/[0.06] text-black/60"
              }`}
            >
              {L.state[task.execState as keyof typeof L.state] ?? task.execState}
            </span>
            {task.carryoverCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                {L.carried.replace("{n}", String(task.carryoverCount))}
                {task.consecutiveCarryover > 1 ? L.consecutive.replace("{n}", String(task.consecutiveCarryover)) : ""}
              </span>
            )}
            {task.overdue && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                {L.overdue}
              </span>
            )}
          </div>

          <p className="mt-1 text-xs leading-relaxed text-black/55">
            <span className="font-semibold">{L.criteria}</span> {task.acceptanceCriteria}
            {task.deliverable ? L.deliverable.replace("{d}", task.deliverable) : ""}
          </p>

          <p className="mt-1 text-[11px] text-black/45">
            {task.ownerName ?? L.noOwner}
            {task.departmentName ? ` · ${task.departmentName}` : ""} · {L.weight.replace("{n}", String(task.weight))} ·{" "}
            {L.priority[task.priority as keyof typeof L.priority] ?? task.priority} · {task.countdown}
            {dueDiffers && (
              <>
                {" · "}
                <span className="font-semibold">
                  {L.dueChanged.replace("{a}", task.originalDueAt.slice(0, 10)).replace("{b}", task.dueAt.slice(0, 10))}
                </span>
              </>
            )}
          </p>

          {task.blockedReason && (
            <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              {L.blocker.replace("{r}", task.blockedReason)}
            </p>
          )}
          {task.execState === "returned" && task.lastReviewNote && (
            <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              {L.returnedNote.replace("{r}", task.lastReviewNote)}
            </p>
          )}
          {task.waivedReason && (
            <p className="mt-1.5 rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-xs text-black/60">
              {L.waivedNote.replace("{r}", task.waivedReason)}
            </p>
          )}
          {task.carryoverCount > 0 && (
            <p className="mt-1.5 text-xs leading-relaxed text-black/55">
              {task.carryReason ? (
                <>
                  <span className="font-semibold">{L.carryReason}</span> {task.carryReason} ·{" "}
                  <span className="font-semibold">{L.corrective}</span> {task.correctivePlan}
                </>
              ) : (
                <span className="font-semibold text-amber-900">
                  {L.carryMissing}
                </span>
              )}
            </p>
          )}
          {task.lastSubmission && (
            <div className="mt-2 rounded-xl bg-black/[0.03] px-3 py-2">
              <p className="text-[11px] font-bold text-black/60">
                {L.lastSubmission.replace("{name}", task.lastSubmission.submittedByName)}{" "}
                {task.lastSubmission.submittedAt.slice(0, 10)}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-black/70">
                {task.lastSubmission.note}
              </p>
              {task.lastSubmission.evidenceUrl && (
                <a
                  href={task.lastSubmission.evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs font-bold underline"
                >
                  {L.openLink}
                </a>
              )}
              {task.lastSubmission.evidenceFileName && (
                <a
                  href={`/api/execution/evidence/${task.lastSubmission.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs font-bold underline"
                >
                  {L.openFile.replace("{name}", task.lastSubmission.evidenceFileName)}
                </a>
              )}
            </div>
          )}
          {task.verifiedByName && (
            <p className="mt-1.5 text-[11px] font-semibold text-emerald-800">
              {L.verifiedBy.replace("{name}", task.verifiedByName)}
            </p>
          )}
        </div>
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {/* ── الأزرار: لكلٍّ ما يملكه */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
        {can.work && !["verified", "waived", "cancelled", "superseded", "deferred"].includes(task.execState) && (
          <>
            {task.execState !== "in_progress" && (
              <Button
                theme={theme}
                variant="outline"
                disabled={pending}
                onClick={() => run(() => updateTaskStateAction(task.id, "in_progress"))}
              >
                {L.start}
              </Button>
            )}
            <Button theme={theme} onClick={() => setPanel(panel === "submit" ? null : "submit")}>
              {task.execState === "submitted" ? L.resubmit : L.submit}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setPanel(panel === "block" ? null : "block")}>
              {L.declareBlock}
            </Button>
          </>
        )}

        {can.review && task.execState === "submitted" && (
          <Button theme={theme} onClick={() => setPanel(panel === "review" ? null : "review")}>
            {L.review}
          </Button>
        )}
        {can.review && !["waived", "cancelled", "superseded"].includes(task.execState) && (
          <>
            <Button
              theme={theme}
              variant="outline"
              onClick={() => setPanel(panel === "deadline" ? null : "deadline")}
            >
              {L.extend}
            </Button>
            {task.execState !== "verified" && (
              <Button theme={theme} variant="ghost" onClick={() => setPanel(panel === "waive" ? null : "waive")}>
                {L.waive}
              </Button>
            )}
          </>
        )}
        {can.carryPlan && task.carryoverCount > 0 && !task.carryReason && (
          <Button theme={theme} onClick={() => setPanel(panel === "carry" ? null : "carry")}>
            {L.confirmCarry}
          </Button>
        )}
      </div>

      {/* ── اللوحات */}
      {panel === "submit" && (
        <div className="mt-3">
          <SubmitWork taskId={task.id} theme={theme} onDone={() => setPanel(null)} />
        </div>
      )}

      {panel === "block" && (
        <Panel
          theme={theme}
          label={L.blockPrompt}
          value={note}
          onChange={setNote}
          pending={pending}
          submitLabel={L.blockSubmit}
          onSubmit={() => run(() => updateTaskStateAction(task.id, "blocked", note))}
          onCancel={() => setPanel(null)}
        />
      )}

      {panel === "review" && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3">
          <p className="text-xs leading-relaxed text-black/60">
            {L.reviewHint}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={L.decisionNote}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending}
              onClick={() => run(() => reviewTaskAction(task.id, "verified", note))}
            >
              {L.verify}
            </Button>
            <Button
              theme={theme}
              variant="outline"
              disabled={pending || !note.trim()}
              onClick={() => run(() => reviewTaskAction(task.id, "returned", note))}
            >
              {L.return}
            </Button>
            <Button
              theme={theme}
              variant="ghost"
              disabled={pending || !note.trim()}
              onClick={() => run(() => reviewTaskAction(task.id, "incomplete", note))}
            >
              {L.incomplete}
            </Button>
            <Button
              theme={theme}
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => reviewTaskAction(task.id, "flagged", note))}
            >
              {L.flag}
            </Button>
          </div>
        </div>
      )}

      {panel === "deadline" && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3">
          <p className="text-xs leading-relaxed text-black/60">
            {L.deadlineHint}
          </p>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={L.extendReason}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !date || !note.trim()}
              onClick={() => run(() => changeDeadlineAction(task.id, date, note))}
            >
              {L.extendSubmit}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setPanel(null)}>
              {L.cancel}
            </Button>
          </div>
        </div>
      )}

      {panel === "waive" && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3">
          <p className="text-xs leading-relaxed text-black/60">
            <strong>{L.waiveStrong}</strong>
            {L.waiveRest}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={L.reasonRequired}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["waive", L.waiveKinds.waive],
                ["defer", L.waiveKinds.defer],
                ["cancel", L.waiveKinds.cancel],
                ["supersede", L.waiveKinds.supersede],
              ] as const
            ).map(([kind, label]) => (
              <Button
                key={kind}
                theme={theme}
                variant={kind === "waive" ? "solid" : "outline"}
                disabled={pending || !note.trim()}
                onClick={() => run(() => waiveTaskAction(task.id, kind, note))}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {panel === "carry" && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-amber-50 p-3">
          <p className="text-xs leading-relaxed text-amber-900">
            {L.carryHint}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={L.carryWhy}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <textarea
            value={note2}
            onChange={(e) => setNote2(e.target.value)}
            rows={2}
            placeholder={L.carryPlan}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !note.trim() || !note2.trim()}
              onClick={() => run(() => recordCarryoverPlanAction(task.id, note, note2))}
            >
              {L.carrySubmit}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setPanel(null)}>
              {L.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({
  theme,
  label,
  value,
  onChange,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  theme: ReturnType<typeof themeFromColor>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const L = useTranslations().task;
  return (
    <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3">
      <p className="text-xs leading-relaxed text-black/60">{label}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
      />
      <div className="flex flex-wrap gap-2">
        <Button theme={theme} disabled={pending || !value.trim()} onClick={onSubmit}>
          {submitLabel}
        </Button>
        <Button theme={theme} variant="outline" onClick={onCancel}>
          {L.cancel}
        </Button>
      </div>
    </div>
  );
}
