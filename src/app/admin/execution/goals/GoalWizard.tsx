"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createGoalWizardAction } from "../actions";
import { useTranslations } from "@/i18n/LocaleProvider";

type Priority = "critical" | "high" | "normal" | "low";
type Milestone = {
  title: string;
  expectedResult: string;
  acceptanceCriteria: string;
  startDate: string;
  dueDate: string;
  ownerUserId: string;
};

const input =
  "min-h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30";
const area = `${input} py-2.5`;

/** حقلٌ بعنوانه وتلميحه — خارج المعالج عمداً: مكوّنٌ يُعرَّف داخل مكوّنٍ
 *  يُعاد إنشاؤه مع كل حرف، فيفقد الحقلُ تركيزه بعد كل ضغطة. */
function FieldBox({
  label,
  hint,
  children,
  opt,
  optional,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  opt?: boolean;
  optional: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-bold text-black/75">
        {label}
        {opt && <span className="font-medium text-black/35"> — {optional}</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-black/45">{hint}</span>}
    </label>
  );
}

function PersonSelect({
  value,
  onChange,
  leaders,
  nobody,
}: {
  value: string;
  onChange: (v: string) => void;
  leaders: { id: string; fullName: string }[];
  nobody: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">{nobody}</option>
      {leaders.map((l) => (
        <option key={l.id} value={l.id}>
          {l.fullName}
        </option>
      ))}
    </select>
  );
}

const EMPTY = {
  title: "",
  description: "",
  rationale: "",
  impact: "",
  successCriteria: "",
  baselineValue: "",
  targetValue: "",
  priority: "normal" as Priority,
  accountableUserId: "",
  ownerUserId: "",
  startDate: "",
  dueDate: "",
};

/** معالجُ إنشاء الهدف — خمسُ خطوات بدل نموذجٍ واحدٍ طويل.
 *
 *  **الحقولُ هي حقولُ النموذج نفسه** (`StrategicGoal` و`Milestone`)، والإرسالُ
 *  إلى `createGoal` و`createMilestone` بشروطهما — فالمعالجُ ترتيبٌ للقراءة لا
 *  قاعدةٌ جديدة. وما يُفحَص هنا (الإلزاميُّ والتواريخ) يُفحَص في الخادم ثانيةً.
 *
 *  **وما يُقال في خطوة المراجعة يُطابق ما سيقع:** من يملك الاعتماد يُنشئه
 *  معتمَداً، وقائدُ القسم يُرسله مقترحاً. والرؤيةُ هي قاعدةُ المنصة القائمة
 *  (القيادة كلّها) — لا خيارٌ في الواجهة لا يحرسه الخادم. */
export function GoalWizard({
  canApprove,
  leaders,
}: {
  canApprove: boolean;
  leaders: { id: string; fullName: string; role: string }[];
}) {
  const t = useTranslations().goalWizard;
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [f, setF] = useState(EMPTY);
  const [ms, setMs] = useState<Milestone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; milestoneErrors: string[] } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const nameOf = (id: string) => leaders.find((l) => l.id === id)?.fullName ?? "—";

  const msValid = (m: Milestone) =>
    m.title.trim() &&
    m.expectedResult.trim() &&
    m.acceptanceCriteria.trim() &&
    m.startDate &&
    m.dueDate &&
    m.dueDate > m.startDate &&
    (!f.dueDate || m.dueDate <= f.dueDate);

  // ما يُمنع به التقدّم في كل خطوة — والخادم يفحصه ثانيةً على كل حال
  function blocker(s: number): string | null {
    if (s === 0 && (!f.title.trim() || !f.description.trim() || !f.rationale.trim())) return t.required;
    if (s === 1 && !f.successCriteria.trim()) return t.required;
    if (s === 3) {
      if (!f.startDate || !f.dueDate) return t.required;
      if (f.dueDate <= f.startDate) return t.dueAfterStart;
      if (canApprove && ms.some((m) => !msValid(m))) return t.mInvalid;
    }
    return null;
  }

  function go(to: number) {
    if (to > step) {
      const b = blocker(step);
      if (b) return setError(b);
    }
    setError(null);
    setStep(to);
  }

  function reset() {
    setF(EMPTY);
    setMs([]);
    setStep(0);
    setDone(null);
    setError(null);
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await createGoalWizardAction({ ...f, milestones: canApprove ? ms : [] });
      if (!res.ok) return setError(res.error);
      setDone({ message: res.message, milestoneErrors: res.milestoneErrors });
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-brand ticket-cta__btn">
        ＋ {t.open}
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby="goal-wizard-title"
        className="confirm-dialog goal-wizard"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="goal-wizard-title" className="text-lg font-bold">
            {t.title}
          </h2>
          <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold text-black/50">
            ✕ {t.close}
          </button>
        </div>

        {done ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-bold text-green-800">
              {done.message}
            </p>
            {done.milestoneErrors.length > 0 && (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-bold">{t.milestoneFailed}</p>
                <ul className="mt-1 list-disc ps-5">
                  {done.milestoneErrors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={reset} className="wizard-btn-2">
                {t.another}
              </button>
              <Link href="/admin/execution/goals" className="btn-brand ticket-cta__btn" onClick={() => setOpen(false)}>
                {t.viewGoals}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ol className="mb-5 grid grid-cols-5 gap-1.5" aria-label={t.title}>
              {t.steps.map((s, i) => (
                <li key={s} aria-current={i === step ? "step" : undefined}>
                  <span
                    className="block h-1.5 rounded-full"
                    style={{ background: i <= step ? "var(--brand-action)" : "var(--hairline)" }}
                  />
                  <span className={`mt-1.5 block text-[11px] font-bold ${i === step ? "" : "text-black/40"}`}>
                    {i + 1}. {s}
                  </span>
                </li>
              ))}
            </ol>

            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-0.5">
              {step === 0 && (
                <>
                  <FieldBox optional={t.optional} label={t.goalTitle}>
                    <input value={f.title} onChange={set("title")} maxLength={140} placeholder={t.goalTitlePh} className={input} />
                  </FieldBox>
                  <FieldBox optional={t.optional} label={t.description}>
                    <textarea value={f.description} onChange={set("description")} rows={3} className={area} />
                  </FieldBox>
                  <FieldBox optional={t.optional} label={t.rationale} hint={t.rationaleHint}>
                    <textarea value={f.rationale} onChange={set("rationale")} rows={2} className={area} />
                  </FieldBox>
                  <FieldBox optional={t.optional} label={t.impact} opt>
                    <textarea value={f.impact} onChange={set("impact")} rows={2} className={area} />
                  </FieldBox>
                </>
              )}

              {step === 1 && (
                <>
                  <FieldBox optional={t.optional} label={t.criteria} hint={t.criteriaHint}>
                    <textarea value={f.successCriteria} onChange={set("successCriteria")} rows={2} className={area} />
                  </FieldBox>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldBox optional={t.optional} label={t.baseline} opt>
                      <input value={f.baselineValue} onChange={set("baselineValue")} className={input} />
                    </FieldBox>
                    <FieldBox optional={t.optional} label={t.target} opt>
                      <input value={f.targetValue} onChange={set("targetValue")} className={input} />
                    </FieldBox>
                  </div>
                  <FieldBox optional={t.optional} label={t.priority}>
                    <select value={f.priority} onChange={set("priority")} className={input}>
                      {(["critical", "high", "normal", "low"] as const).map((p) => (
                        <option key={p} value={p}>
                          {t.priorities[p]}
                        </option>
                      ))}
                    </select>
                  </FieldBox>
                </>
              )}

              {step === 2 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldBox optional={t.optional} label={t.accountable} hint={t.accountableHint}>
                    <PersonSelect leaders={leaders} nobody={t.nobody} value={f.accountableUserId} onChange={(v) => setF((p) => ({ ...p, accountableUserId: v }))} />
                  </FieldBox>
                  <FieldBox optional={t.optional} label={t.owner} hint={t.ownerHint}>
                    <PersonSelect leaders={leaders} nobody={t.nobody} value={f.ownerUserId} onChange={(v) => setF((p) => ({ ...p, ownerUserId: v }))} />
                  </FieldBox>
                </div>
              )}

              {step === 3 && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldBox optional={t.optional} label={t.startDate}>
                      <input type="date" value={f.startDate} onChange={set("startDate")} className={input} />
                    </FieldBox>
                    <FieldBox optional={t.optional} label={t.dueDate} hint={t.dueAfterStart}>
                      <input type="date" value={f.dueDate} min={f.startDate || undefined} onChange={set("dueDate")} className={input} />
                    </FieldBox>
                  </div>
                  <div>
                    <p className="text-sm font-bold">
                      {t.milestones} <span className="font-medium text-black/40">— {t.milestonesHint}</span>
                    </p>
                    {!canApprove ? (
                      <p className="mt-2 rounded-xl bg-black/[0.03] px-3.5 py-3 text-xs text-black/55">{t.milestonesLater}</p>
                    ) : (
                      <div className="mt-2 flex flex-col gap-2.5">
                        {ms.map((m, i) => {
                          const upd = (k: keyof Milestone) => (e: { target: { value: string } }) =>
                            setMs((list) => list.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
                          return (
                            <fieldset key={i} className="flex flex-col gap-2 rounded-xl border border-black/10 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <legend className="text-xs font-bold text-black/50">
                                  {t.milestones} {i + 1}
                                </legend>
                                <button
                                  type="button"
                                  onClick={() => setMs((list) => list.filter((_, j) => j !== i))}
                                  className="text-xs font-bold text-red-700"
                                >
                                  {t.removeMilestone}
                                </button>
                              </div>
                              <input value={m.title} onChange={upd("title")} placeholder={t.mTitle} aria-label={t.mTitle} className={input} />
                              <input value={m.expectedResult} onChange={upd("expectedResult")} placeholder={t.mResult} aria-label={t.mResult} className={input} />
                              <input value={m.acceptanceCriteria} onChange={upd("acceptanceCriteria")} placeholder={t.mCriteria} aria-label={t.mCriteria} className={input} />
                              <div className="grid gap-2 sm:grid-cols-3">
                                <input type="date" value={m.startDate} onChange={upd("startDate")} aria-label={t.mStart} className={input} />
                                <input type="date" value={m.dueDate} onChange={upd("dueDate")} max={f.dueDate || undefined} aria-label={t.mDue} className={input} />
                                <PersonSelect leaders={leaders} nobody={t.nobody}
                                  value={m.ownerUserId}
                                  onChange={(v) => setMs((list) => list.map((x, j) => (j === i ? { ...x, ownerUserId: v } : x)))}
                                />
                              </div>
                            </fieldset>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() =>
                            setMs((list) => [
                              ...list,
                              { title: "", expectedResult: "", acceptanceCriteria: "", startDate: f.startDate, dueDate: "", ownerUserId: f.ownerUserId },
                            ])
                          }
                          className="rounded-xl border-[1.5px] border-dashed border-black/15 py-2.5 text-sm font-bold"
                        >
                          ＋ {t.addMilestone}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {step === 4 && (
                <>
                  <dl className="rounded-2xl bg-black/[0.03] p-4 text-sm">
                    <dt className="text-xs font-bold text-black/45">{t.sumGoal}</dt>
                    <dd className="mb-2 text-base font-bold">{f.title}</dd>
                    {[
                      [t.sumRationale, f.rationale],
                      [t.sumCriteria, f.successCriteria],
                      [t.sumBaseTarget, f.baselineValue || f.targetValue ? `${f.baselineValue || "—"} ← ${f.targetValue || "—"}` : ""],
                      [t.sumPeople, `${f.accountableUserId ? nameOf(f.accountableUserId) : "—"} / ${f.ownerUserId ? nameOf(f.ownerUserId) : "—"}`],
                      [t.sumPeriod, `${f.startDate} ← ${f.dueDate}${canApprove && ms.length ? ` · ${t.sumMilestones.replace("{n}", String(ms.length))}` : ""}`],
                      [t.sumPriority, t.priorities[f.priority]],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3 border-t border-black/5 py-2">
                          <dt className="shrink-0 text-xs text-black/50">{k}</dt>
                          <dd className="text-end font-bold">{v}</dd>
                        </div>
                      ))}
                  </dl>
                  <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm leading-relaxed text-green-900">
                    <b>{t.whatHappens}</b> {canApprove ? t.happensApproved : t.happensProposed}
                  </p>
                  <p className="rounded-2xl bg-black/[0.04] px-4 py-3 text-sm leading-relaxed">
                    <b>{t.whoSees}</b> {t.whoSeesBody}
                  </p>
                </>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-black/40">{t.keepNote}</span>
              <div className="flex gap-2">
                {step > 0 && (
                  <button type="button" onClick={() => go(step - 1)} disabled={pending} className="wizard-btn-2">
                    {step === 4 ? t.edit : t.prev}
                  </button>
                )}
                {step < 4 ? (
                  <button key="next" type="button" onClick={() => go(step + 1)} className="btn-brand ticket-cta__btn">
                    {step === 3 ? t.review : t.next}
                  </button>
                ) : (
                  <button key="submit" type="button" onClick={submit} disabled={pending} className="btn-brand ticket-cta__btn">
                    {pending ? t.submitting : canApprove ? t.submit : t.submitPropose}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
