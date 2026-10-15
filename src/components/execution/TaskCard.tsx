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

export const STATE_LABEL: Record<string, string> = {
  not_started: "لم تبدأ",
  in_progress: "قيد التنفيذ",
  submitted: "بانتظار التحقّق",
  verified: "متحقَّقٌ منها",
  returned: "رُدَّت للتصحيح",
  incomplete: "غير مكتملة",
  blocked: "معوَّقة",
  waived: "أُسقطت بقرار",
  cancelled: "أُلغيت",
  superseded: "حلّ محلَّها غيرُها",
  deferred: "أُجّلت",
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

const PRIORITY_LABEL: Record<string, string> = {
  critical: "حرجة",
  high: "عالية",
  normal: "عادية",
  low: "منخفضة",
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
              {STATE_LABEL[task.execState] ?? task.execState}
            </span>
            {task.carryoverCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                مُرحَّلة ×{task.carryoverCount}
                {task.consecutiveCarryover > 1 ? ` (${task.consecutiveCarryover} متتالية)` : ""}
              </span>
            )}
            {task.overdue && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                متأخّرة
              </span>
            )}
          </div>

          <p className="mt-1 text-xs leading-relaxed text-black/55">
            <span className="font-semibold">معيار الإنجاز:</span> {task.acceptanceCriteria}
            {task.deliverable ? ` · المُسلَّم: ${task.deliverable}` : ""}
          </p>

          <p className="mt-1 text-[11px] text-black/45">
            {task.ownerName ?? "بلا صاحب"}
            {task.departmentName ? ` · ${task.departmentName}` : ""} · وزن {task.weight} ·{" "}
            {PRIORITY_LABEL[task.priority] ?? task.priority} · {task.countdown}
            {dueDiffers && (
              <>
                {" · "}
                <span className="font-semibold">
                  الموعد الأصلي {task.originalDueAt.slice(0, 10)} ← المعتمَد{" "}
                  {task.dueAt.slice(0, 10)}
                </span>
              </>
            )}
          </p>

          {task.blockedReason && (
            <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              المعوّق: {task.blockedReason}
            </p>
          )}
          {task.execState === "returned" && task.lastReviewNote && (
            <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              رُدَّت: {task.lastReviewNote}
            </p>
          )}
          {task.waivedReason && (
            <p className="mt-1.5 rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-xs text-black/60">
              سببُ الإسقاط: {task.waivedReason} — ولا تُحتسَب إنجازاً
            </p>
          )}
          {task.carryoverCount > 0 && (
            <p className="mt-1.5 text-xs leading-relaxed text-black/55">
              {task.carryReason ? (
                <>
                  <span className="font-semibold">سببُ الترحيل:</span> {task.carryReason} ·{" "}
                  <span className="font-semibold">التصحيح:</span> {task.correctivePlan}
                </>
              ) : (
                <span className="font-semibold text-amber-900">
                  مُرحَّلةٌ بلا سببٍ وخطةِ تصحيح — ولا تُعتمَد خطةُ الأسبوع قبل إقرارهما
                </span>
              )}
            </p>
          )}
          {task.lastSubmission && (
            <div className="mt-2 rounded-xl bg-black/[0.03] px-3 py-2">
              <p className="text-[11px] font-bold text-black/60">
                آخر تسليم — {task.lastSubmission.submittedByName} ·{" "}
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
                  افتح دليلَ الرابط ←
                </a>
              )}
              {task.lastSubmission.evidenceFileName && (
                <a
                  href={`/api/execution/evidence/${task.lastSubmission.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs font-bold underline"
                >
                  افتح الملف المرفوع ({task.lastSubmission.evidenceFileName}) ←
                </a>
              )}
            </div>
          )}
          {task.verifiedByName && (
            <p className="mt-1.5 text-[11px] font-semibold text-emerald-800">
              تحقّق منها {task.verifiedByName}
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
                ابدأ العمل
              </Button>
            )}
            <Button theme={theme} onClick={() => setPanel(panel === "submit" ? null : "submit")}>
              {task.execState === "submitted" ? "أعِد التسليم" : "ارفع التسليم"}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setPanel(panel === "block" ? null : "block")}>
              أعلِن معوّقاً
            </Button>
          </>
        )}

        {can.review && task.execState === "submitted" && (
          <Button theme={theme} onClick={() => setPanel(panel === "review" ? null : "review")}>
            راجِع التسليم
          </Button>
        )}
        {can.review && !["waived", "cancelled", "superseded"].includes(task.execState) && (
          <>
            <Button
              theme={theme}
              variant="outline"
              onClick={() => setPanel(panel === "deadline" ? null : "deadline")}
            >
              مدِّد الموعد
            </Button>
            {task.execState !== "verified" && (
              <Button theme={theme} variant="ghost" onClick={() => setPanel(panel === "waive" ? null : "waive")}>
                أسقِط الالتزام
              </Button>
            )}
          </>
        )}
        {can.carryPlan && task.carryoverCount > 0 && !task.carryReason && (
          <Button theme={theme} onClick={() => setPanel(panel === "carry" ? null : "carry")}>
            أقِرّ سببَ الترحيل
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
          label="ما الذي يُعوِّقها؟ — ولا تُعلَن متوقّفةً بلا سبب"
          value={note}
          onChange={setNote}
          pending={pending}
          submitLabel="أعلِن المعوّق"
          onSubmit={() => run(() => updateTaskStateAction(task.id, "blocked", note))}
          onCancel={() => setPanel(null)}
        />
      )}

      {panel === "review" && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3">
          <p className="text-xs leading-relaxed text-black/60">
            اطّلِع على الدليل أعلاه ثم قرِّر. والردُّ وعدمُ الاكتمال لا يقعان بلا سببٍ مكتوب،
            والتسليمُ السابق يبقى محفوظاً.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="ملاحظةُ القرار"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending}
              onClick={() => run(() => reviewTaskAction(task.id, "verified", note))}
            >
              تحقّقتُ منها
            </Button>
            <Button
              theme={theme}
              variant="outline"
              disabled={pending || !note.trim()}
              onClick={() => run(() => reviewTaskAction(task.id, "returned", note))}
            >
              ردٌّ للتصحيح
            </Button>
            <Button
              theme={theme}
              variant="ghost"
              disabled={pending || !note.trim()}
              onClick={() => run(() => reviewTaskAction(task.id, "incomplete", note))}
            >
              غير مكتملة
            </Button>
            <Button
              theme={theme}
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => reviewTaskAction(task.id, "flagged", note))}
            >
              للنقاش
            </Button>
          </div>
        </div>
      )}

      {panel === "deadline" && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3">
          <p className="text-xs leading-relaxed text-black/60">
            الموعدُ الأصليُّ يبقى محفوظاً ويُقاس به التأخّر — والتمديدُ لا يُبيّض تأخّراً وقع.
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
            placeholder="سببُ التمديد — إلزامي"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !date || !note.trim()}
              onClick={() => run(() => changeDeadlineAction(task.id, date, note))}
            >
              مدِّد بقرارك
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setPanel(null)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {panel === "waive" && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-black/[0.03] p-3">
          <p className="text-xs leading-relaxed text-black/60">
            <strong>المُسقَطُ لا يُحتسَب إنجازاً</strong> — يُعرَض وحده في التقرير، ويبقى
            التزامُه التاريخيُّ مكتوباً.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="السبب — إلزامي"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["waive", "أسقِط"],
                ["defer", "أجِّل"],
                ["cancel", "ألغِ"],
                ["supersede", "استُبدلت"],
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
            الترحيلُ التزامٌ يُعاد إقرارُه: اكتب لماذا لم تكتمل، وكيف ستكتمل هذا الأسبوع.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="سببُ عدم الاكتمال"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <textarea
            value={note2}
            onChange={(e) => setNote2(e.target.value)}
            rows={2}
            placeholder="خطةُ التصحيح — ما الذي يختلف هذا الأسبوع؟"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !note.trim() || !note2.trim()}
              onClick={() => run(() => recordCarryoverPlanAction(task.id, note, note2))}
            >
              أقِرّهما
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setPanel(null)}>
              إلغاء
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
          إلغاء
        </Button>
      </div>
    </div>
  );
}
