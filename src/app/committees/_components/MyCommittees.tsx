import Link from "next/link";
import { Card } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import type { myCommittees } from "@/lib/org/queries";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { fmt } from "@/i18n/fmt";
import { taskStatusAction } from "../actions";
import { ActionForm } from "./ActionForm";
import { Chip, StatusChip, fmtWhen } from "./bits";

type Data = Awaited<ReturnType<typeof myCommittees>>;

/** «لجاني» في صفحة العضو: اللجانُ التي هو فيها، ومهامُّه المفتوحة فيها —
 *  وتحديثُ حالتها من هنا (والخادمُ يتحقّق أنه المكلَّف) */
export function MyCommittees({ data, L, theme }: { data: Data; L: Dictionary["org"]; theme: ReturnType<typeof themeFromColor> }) {
  if (!data.committees.length && !data.tasks.length) return null;
  const M = L.mine;
  return (
    <section id="committees" className="scroll-mt-24">
      <Card className="flex flex-col gap-4 p-4 sm:p-6">
        <h2 className="text-base font-bold">{M.title}</h2>
        {data.committees.length > 0 && (
          <ul className="flex flex-col gap-2">
            {data.committees.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-black/5 px-3.5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/committees/${c.id}`} className="flex flex-wrap items-center gap-2 text-sm font-bold hover:underline">
                    <span className="inline-block h-3 w-3 rounded-[3px]" style={{ border: `1.5px dashed ${c.parent?.colorHex ?? "#999"}` }} aria-hidden />
                    {c.name}
                    {c.isLead && <Chip tone="ok">{L.members.leadBadge}</Chip>}
                  </Link>
                  <p className="text-xs text-black/50">
                    {c.parent?.name}
                    {" · "}
                    {L.detail.lead}: {c.leadMember?.fullName ?? L.noLead}
                    {c.responsibility && ` · ${c.responsibility}`}
                  </p>
                </div>
                {c.committeeStatus && <StatusChip status={c.committeeStatus} label={L.statuses[c.committeeStatus]} />}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">{M.tasks}</h3>
          {data.tasks.length === 0 ? (
            <p className="text-xs text-black/50">{M.noTasks}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.tasks.map((t) => (
                <li key={t.id} className={`flex flex-col gap-2 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between ${t.overdue ? "border-red-200 bg-red-50/40" : "border-black/5"}`}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {t.title}
                      {t.overdue && <Chip tone="danger">{L.tasks.overdue}</Chip>}
                    </p>
                    <p className="text-xs text-black/50">
                      <Link href={`/committees/${t.committee.id}?tab=tasks`} className="hover:underline">
                        {t.committee.name}
                      </Link>
                      {t.dueAt && ` · ${fmt(L.tasks.due, fmtWhen(t.dueAt, false))}`}
                      {` · ${L.priority[t.priority]}`}
                    </p>
                  </div>
                  <ActionForm action={taskStatusAction} submits={[{ label: L.tasks.setStatus, variant: "outline" }]} pendingLabel={L.overview.saving} theme={theme} compact className="flex items-center gap-2">
                    <input type="hidden" name="committeeId" value={t.committee.id} />
                    <input type="hidden" name="taskId" value={t.id} />
                    <select name="status" defaultValue={t.status} aria-label={L.tasks.setStatus} className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs">
                      {(["todo", "in_progress", "done"] as const).map((s) => (
                        <option key={s} value={s}>
                          {L.taskStatus[s]}
                        </option>
                      ))}
                    </select>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}
