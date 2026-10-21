"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  createTaskAction,
  submitPlanAction,
  setCapacityAction,
  ensurePlanAction,
} from "@/app/admin/execution/actions";
import { Button } from "@/components/ui";
import { TaskCard, type TaskView } from "./TaskCard";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

/** خطةُ أسبوعِ القسم — يبنيها قائدُه ويرفعها للاعتماد.
 *
 *  **والجديدُ والمُرحَّلُ مفصولان في العرض** كما هما مفصولان في الحساب:
 *  فمن يقرأ الخطة يعرف أن أسبوعه ليس ثلاثَ مهامٍّ جديدة، بل ثلاثاً
 *  وخمساً مُرحَّلة. وهذا أولُ ما يُرى — لا في ذيل الصفحة.
 */
export function WeekPlanPanel({
  plan,
  periodId,
  departmentId,
  periodState,
  tasks,
  owners,
  goals,
  objectives,
  capacity,
  report,
  canPlan,
  canReview,
  theme,
  title,
  readOnlyNote,
}: {
  plan: { id: string; state: string; decisionNote: string | null } | null;
  periodId: string;
  departmentId: string;
  periodState: string;
  tasks: TaskView[];
  owners: { value: string; label: string }[];
  goals: { id: string; title: string }[];
  objectives: { id: string; title: string }[];
  capacity: number;
  report: {
    newPoints: number;
    carriedPoints: number;
    totalPoints: number;
    capacityPoints: number;
    overloaded: boolean;
    blockers: string[];
  } | null;
  canPlan: boolean;
  canReview: boolean;
  theme: ReturnType<typeof themeFromColor>;
  title: string;
  /** يُعرَض حين تكون الخطةُ للقراءة فقط — الأسبوعُ لم يُفتَح بعد */
  readOnlyNote?: string;
}) {
  const L = useTranslations().weekPlan;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cap, setCap] = useState(capacity);

  const carried = tasks.filter((t) => t.carryoverCount > 0);
  const fresh = tasks.filter((t) => t.carryoverCount === 0);
  const writable = periodState === "open" || periodState === "reopened";

  function run(fn: () => Promise<{ error: string | null; message?: string }>) {
    start(async () => {
      setError(null);
      setMessage(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else setMessage(res.message ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">{title}</h2>
        {plan && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              plan.state === "approved"
                ? "bg-emerald-100 text-emerald-900"
                : plan.state === "submitted"
                  ? "bg-amber-100 text-amber-900"
                  : plan.state === "returned"
                    ? "bg-red-50 text-red-700"
                    : "bg-black/[0.06] text-black/60"
            }`}
          >
            {L.planState[plan.state as keyof typeof L.planState] ?? L.planState.draft}
          </span>
        )}
      </div>

      {readOnlyNote && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {readOnlyNote}
        </p>
      )}
      {plan?.decisionNote && (
        <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/60">
          {L.decisionNote.replace("{note}", plan.decisionNote)}
        </p>
      )}

      {report && (
        <div className="rounded-xl bg-black/[0.03] p-3">
          <p className="text-xs font-semibold text-black/70">
            {L.load
              .replace("{total}", String(report.totalPoints))
              .replace("{cap}", String(report.capacityPoints))
              .replace("{new}", String(report.newPoints))
              .replace("{carried}", String(report.carriedPoints))}
          </p>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.07]">
            <div
              className={`h-full ${report.overloaded ? "bg-red-500" : "bg-emerald-500"}`}
              style={{
                width: `${Math.min(100, Math.round((100 * report.totalPoints) / Math.max(1, report.capacityPoints)))}%`,
              }}
              aria-hidden
            />
          </div>
          {report.blockers.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {report.blockers.map((b, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-amber-900">
                  • {b}
                </li>
              ))}
            </ul>
          )}
          {canPlan && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-black/55">{L.capacity}</label>
              <input
                type="number"
                min={1}
                max={200}
                value={cap}
                onChange={(e) => setCap(Number(e.target.value))}
                className="min-h-9 w-20 rounded-lg border border-black/10 bg-white px-2 text-sm"
              />
              <Button
                theme={theme}
                variant="outline"
                disabled={pending || !plan}
                onClick={() => plan && run(() => setCapacityAction(plan.id, cap))}
              >
                {L.setCapacity}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</p>
      )}

      {!plan ? (
        canPlan && (
          <div>
            <Button
              theme={theme}
              disabled={pending}
              onClick={() => run(() => ensurePlanAction(periodId, departmentId))}
            >
              {L.createPlan}
            </Button>
          </div>
        )
      ) : (
        <>
          {/* ── المُرحَّل أولاً: هو ما يَلتهم الأسبوع إن أُهمل */}
          {carried.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <h3 className="text-xs font-bold text-amber-900">
                {L.carried.replace("{n}", String(carried.length))}
              </h3>
              {carried.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  theme={theme}
                  can={{ work: writable && canPlan, review: canReview, carryPlan: canPlan }}
                />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-bold text-black/70">{L.fresh.replace("{n}", String(fresh.length))}</h3>
            {fresh.length === 0 ? (
              <p className="rounded-xl bg-black/[0.03] px-3 py-4 text-center text-xs text-black/45">
                {L.freshEmpty}
              </p>
            ) : (
              fresh.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  theme={theme}
                  can={{ work: writable && canPlan, review: canReview, carryPlan: false }}
                />
              ))
            )}
          </div>

          {canPlan && (
            <div className="border-t border-black/5 pt-3">
              {adding ? (
                <TaskForm
                  planId={plan.id}
                  owners={owners}
                  goals={goals}
                  objectives={objectives}
                  theme={theme}
                  onDone={() => setAdding(false)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button theme={theme} variant="outline" onClick={() => setAdding(true)}>
                    {L.add}
                  </Button>
                  {(plan.state === "draft" || plan.state === "returned") && (
                    <Button
                      theme={theme}
                      disabled={pending}
                      onClick={() => run(() => submitPlanAction(plan.id))}
                    >
                      {L.submit}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskForm({
  planId,
  owners,
  goals,
  objectives,
  theme,
  onDone,
}: {
  planId: string;
  owners: { value: string; label: string }[];
  goals: { id: string; title: string }[];
  objectives: { id: string; title: string }[];
  theme: ReturnType<typeof themeFromColor>;
  onDone: () => void;
}) {
  const t = useTranslations();
  const L = t.weekPlan;
  const [state, formAction, pending] = useActionState(createTaskAction, {
    error: null,
    success: false,
  });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) {
      ref.current?.reset();
      onDone();
    }
  }, [state.success, onDone]);

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3 rounded-xl bg-black/[0.03] p-3">
      <input type="hidden" name="planId" value={planId} />
      <p className="text-xs leading-relaxed text-black/55">
        {L.formHint}
      </p>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{L.title}</span>
        <input
          name="title"
          required
          maxLength={140}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{L.criteria}</span>
        <textarea
          name="acceptanceCriteria"
          required
          rows={2}
          placeholder={L.criteriaPlaceholder}
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.deliverable}</span>
          <input
            name="deliverable"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.owner}</span>
          <select
            name="owner"
            required
            defaultValue=""
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="" disabled>
              {L.choose}
            </option>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.due}</span>
          <input
            name="dueAt"
            type="date"
            required
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.weight}</span>
          <input
            name="weight"
            type="number"
            min={1}
            max={20}
            defaultValue={1}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.priority}</span>
          <select
            name="priority"
            defaultValue="normal"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="critical">{t.task.priority.critical}</option>
            <option value="high">{t.task.priority.high}</option>
            <option value="normal">{t.task.priority.normal}</option>
            <option value="low">{t.task.priority.low}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.goal}</span>
          <select
            name="goalId"
            defaultValue=""
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="">—</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {objectives.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.objective}</span>
          <select
            name="objectiveId"
            defaultValue=""
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="">—</option>
            {objectives.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? L.adding : L.addSubmit}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
