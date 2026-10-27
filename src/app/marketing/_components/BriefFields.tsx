import type { Dictionary } from "@/i18n";
import type { WorkPriority } from "@prisma/client";
import { Field, areaCls, inputCls, dateInput } from "./bits";

type Kpi = { name?: string | null; target?: string | null; unit?: string | null; source?: string | null };
type Brief = {
  name: string;
  description: string | null;
  objective: string | null;
  audience: string | null;
  keyMessage: string | null;
  channels: string[];
  deadline: Date | null;
  priority: WorkPriority;
  outcomes?: string | null;
  audienceSegments?: string | null;
  startDate?: Date | null;
  budgetAmount?: number | null;
  budgetNote?: string | null;
  kpis?: unknown;
  measurement?: string | null;
  references?: string | null;
  risks?: string | null;
};

const KPI_ROWS = 4;

/** حقولُ الموجز والخطة — نفسُها في الإنشاء والتعديل. التعديلُ يحفظ الحقولَ كلَّها معاً، فتُعرض كلُّها
 *  بقيمها الحاليّة. المسودةُ الناقصة تُحفظ؛ والتقديمُ للاعتماد يُردّ حتى تكتمل (`planMissing`).
 *  والميزانيةُ اختيارية: تُترك فارغةً ولا تُقدَّر. */
export function BriefFields({ mk, priorities, value }: { mk: Dictionary["mk"]; priorities: WorkPriority[]; value?: Brief }) {
  const f = mk.briefField;
  const kpis = (Array.isArray(value?.kpis) ? (value!.kpis as Kpi[]) : []).slice(0, KPI_ROWS);
  const area = (name: keyof Brief & string, label: string, rows = 2, max = 1500, wide = false) => (
    <Field label={label} className={wide ? "sm:col-span-2" : ""}>
      <textarea name={name} rows={rows} maxLength={max} defaultValue={(value?.[name] as string | null | undefined) ?? ""} className={areaCls} dir="auto" />
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={`${f.name} · ${mk.common.required}`} className="sm:col-span-2">
        <input name="name" required maxLength={160} defaultValue={value?.name} className={inputCls} />
      </Field>
      {area("description", f.description, 2, 2000, true)}
      {area("objective", f.objective, 2, 1000, true)}
      {area("outcomes", f.outcomes, 2, 1500, true)}
      {area("audience", f.audience, 2, 1000)}
      {area("audienceSegments", f.audienceSegments, 2, 1500)}
      {area("keyMessage", f.keyMessage, 2, 1000, true)}
      <Field label={f.channels} hint={mk.campaigns.channelsHint}>
        <input name="channels" dir="ltr" defaultValue={value?.channels.join(", ")} className={inputCls} />
      </Field>
      <Field label={f.priority}>
        <select name="priority" defaultValue={value?.priority ?? "normal"} className={inputCls}>
          {priorities.map((p) => (
            <option key={p} value={p}>{mk.priority[p]}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:col-span-2">
        <Field label={f.startDate} hint={mk.calendar.timezoneNote}>
          <input type="date" name="startDate" defaultValue={dateInput(value?.startDate ?? null)} className={inputCls} />
        </Field>
        <Field label={f.deadline}>
          <input type="date" name="deadline" defaultValue={dateInput(value?.deadline)} className={inputCls} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="text-xs font-bold text-black/70">{f.kpis}</legend>
        {Array.from({ length: KPI_ROWS }, (_, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input name={`kpi.name.${i}`} maxLength={120} placeholder={mk.calendar.kpi} aria-label={`${f.kpis} ${i + 1}`} defaultValue={kpis[i]?.name ?? ""} className={inputCls} dir="auto" />
            <input name={`kpi.target.${i}`} maxLength={60} placeholder={mk.calendar.kpiTarget} aria-label={`${f.kpis} ${i + 1} — ${mk.calendar.kpiTarget}`} defaultValue={kpis[i]?.target ?? ""} className={inputCls} dir="auto" />
            <input name={`kpi.unit.${i}`} maxLength={30} placeholder={mk.calendar.kpiUnit} aria-label={`${f.kpis} ${i + 1} — ${mk.calendar.kpiUnit}`} defaultValue={kpis[i]?.unit ?? ""} className={inputCls} dir="auto" />
            <input name={`kpi.source.${i}`} maxLength={200} placeholder={mk.calendar.kpiSource} aria-label={`${f.kpis} ${i + 1} — ${mk.calendar.kpiSource}`} defaultValue={kpis[i]?.source ?? ""} className={inputCls} dir="auto" />
          </div>
        ))}
      </fieldset>
      {area("measurement", f.measurement, 2, 1500, true)}
      <div className="grid grid-cols-2 gap-3 sm:col-span-2">
        <Field label={f.budget}>
          <input name="budgetAmount" inputMode="numeric" dir="ltr" defaultValue={value?.budgetAmount ?? ""} className={inputCls} />
        </Field>
        <Field label={f.budgetNote}>
          <input name="budgetNote" maxLength={500} defaultValue={value?.budgetNote ?? ""} className={inputCls} dir="auto" />
        </Field>
      </div>
      {area("references", f.references, 2, 2000)}
      {area("risks", f.risks, 2, 2000)}
    </div>
  );
}
