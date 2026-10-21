"use client";

import { useActionState, useState } from "react";
import { proposeObjectiveAction } from "../../execution/actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
export type ObjectiveRow = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  goalTitle: string | null;
  decisionNote: string | null;
  verified: number;
  total: number;
};

// أسماءُ الحالات من القاموس (`status`) — هنا ألوانُها وحدها
const STATUS: Record<string, { cls: string }> = {
  proposed: { cls: "bg-amber-50 text-amber-900" },
  approved: { cls: "bg-emerald-50 text-emerald-800" },
  active: { cls: "bg-emerald-50 text-emerald-800" },
  at_risk: { cls: "bg-red-50 text-red-700" },
  done: { cls: "bg-emerald-100 text-emerald-900" },
  missed: { cls: "bg-red-50 text-red-700" },
  rejected: { cls: "bg-red-50 text-red-700" },
  cancelled: { cls: "bg-black/5 text-black/55" },
};

/** أهدافُ القسم — الطبقةُ بين هدف المنظمة ومهمّة العضو.
 *
 *  كان الخادمُ يقبل اقتراحَ هدف القسم (`proposeObjective`) ويعتمده
 *  التنفيذي من صفحة الأهداف، ولم يكن في الواجهة موضعٌ يُقترَح منه —
 *  فبقيت خانةُ «هدف القسم» في نموذج المهمّة فارغةً أبداً. وهنا الموضع.
 *
 *  والتقدّمُ ما تحقّق منه التنفيذي (`verified`) من مهامّه، لا ما قيل إنه
 *  أُنجز. ويظهر الهدفُ في نموذج المهمّة بعد اعتماده وحده. */
export function ObjectivesPanel({
  departmentId,
  objectives,
  goals,
  canPropose,
  theme,
}: {
  departmentId: string;
  objectives: ObjectiveRow[];
  goals: { id: string; title: string }[];
  canPropose: boolean;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const L = useTranslations().rDeptObjectives;
  const [state, formAction, pending] = useActionState(proposeObjectiveAction, {
    error: null,
    success: false,
  });
  // النموذجُ مفتوحٌ منذ نتيجةٍ بعينها، ويُغلَق وحده حين تأتي بعدها نتيجةُ نجاح —
  // حالةٌ مشتقّة لا تأثيرٌ يكتب حالةً بعد الرسم
  const [openedAt, setOpenedAt] = useState<typeof state | null>(null);
  const open = openedAt !== null && !(state.success && state !== openedAt);
  const setOpen = (v: boolean) => setOpenedAt(v ? state : null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">{L.departmentObjectives}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-black/50">{L.theDepartmentLeadProposes}</p>
        </div>
        {canPropose && !open && (
          <Button theme={theme} type="button" onClick={() => setOpen(true)}>{L.proposeADepartmentObjective}</Button>
        )}
      </div>

      {state.success && state.message && !open && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          ✓ {state.message}
        </p>
      )}

      {open && (
        <form action={formAction} className="flex flex-col gap-3 rounded-xl bg-black/[0.03] p-3">
          <input type="hidden" name="departmentId" value={departmentId} />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{L.objectiveTitle}</span>
            <input
              name="title"
              required
              maxLength={140}
              className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{L.descriptionOptional}</span>
            <textarea
              name="description"
              rows={2}
              maxLength={1000}
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{L.whenItCountsAs}</span>
            <textarea
              name="acceptanceCriteria"
              rows={2}
              maxLength={1000}
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-black/70">{L.servesAnOrganisationGoal}</span>
              <select name="goalId" className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm">
                <option value="">{L.notLinkedToAn}</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-black/70">{L.dueDateOptional}</span>
              <input
                type="date"
                name="dueDate"
                className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
              />
            </label>
          </div>
          <p className="text-xs leading-relaxed text-black/55">{L.whenSentTheProposal}</p>
          {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button theme={theme} type="submit" disabled={pending}>
              {pending ? L.working : L.sendTheProposal}
            </Button>
            <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>{L.cancel}</Button>
          </div>
        </form>
      )}

      {objectives.length === 0 ? (
        <p className="rounded-xl bg-black/[0.03] px-3 py-3 text-xs text-black/50">{L.noDepartmentObjectivesYet}{canPropose ? L.proposeTheFirstObjective : "."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {objectives.map((o) => {
            const s = {
              label: L.status[o.status as keyof typeof L.status] ?? o.status,
              cls: STATUS[o.status]?.cls ?? "bg-black/5 text-black/60",
            };
            const pct = o.total > 0 ? Math.round((o.verified / o.total) * 100) : 0;
            return (
              <li key={o.id} className="rounded-xl border border-black/[0.08] bg-white px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold">{o.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>{s.label}</span>
                </div>
                <p className="mt-1 text-[11px] text-black/50">
                  {o.goalTitle ? fmt(L.serves, o.goalTitle) : L.notLinkedToAn2}
                  {o.dueDate ? fmt(L.due, o.dueDate) : ""}
                  {fmt(L.ofTasksVerified, o.verified, o.total)}
                </p>
                {o.total > 0 && (
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={fmt(L.progressOf, o.title)}
                  >
                    <div className="h-full" style={{ width: `${pct}%`, background: theme.fill }} />
                  </div>
                )}
                {o.status === "rejected" && o.decisionNote && (
                  <p className="mt-1.5 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">
                    {fmt(L.reasonForReturn, o.decisionNote)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
