import type { Dictionary } from "@/i18n";
import type { WorkPriority } from "@prisma/client";
import { Field, areaCls, inputCls, dateInput } from "./bits";

type Brief = {
  name: string;
  description: string | null;
  objective: string | null;
  audience: string | null;
  keyMessage: string | null;
  channels: string[];
  deadline: Date | null;
  priority: WorkPriority;
};

/** حقولُ الموجز — نفسُها في الإنشاء والتعديل */
export function BriefFields({ mk, priorities, value }: { mk: Dictionary["mk"]; priorities: WorkPriority[]; value?: Brief }) {
  const f = mk.briefField;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={`${f.name} · ${mk.common.required}`} className="sm:col-span-2">
        <input name="name" required maxLength={160} defaultValue={value?.name} className={inputCls} />
      </Field>
      <Field label={f.objective} className="sm:col-span-2">
        <textarea name="objective" rows={2} maxLength={1000} defaultValue={value?.objective ?? ""} className={areaCls} />
      </Field>
      <Field label={f.audience}>
        <textarea name="audience" rows={2} maxLength={1000} defaultValue={value?.audience ?? ""} className={areaCls} />
      </Field>
      <Field label={f.keyMessage}>
        <textarea name="keyMessage" rows={2} maxLength={1000} defaultValue={value?.keyMessage ?? ""} className={areaCls} />
      </Field>
      <Field label={f.description} className="sm:col-span-2">
        <textarea name="description" rows={2} maxLength={2000} defaultValue={value?.description ?? ""} className={areaCls} />
      </Field>
      <Field label={f.channels} hint={mk.campaigns.channelsHint}>
        <input name="channels" dir="ltr" defaultValue={value?.channels.join(", ")} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={f.deadline}>
          <input type="date" name="deadline" defaultValue={dateInput(value?.deadline)} className={inputCls} />
        </Field>
        <Field label={f.priority}>
          <select name="priority" defaultValue={value?.priority ?? "normal"} className={inputCls}>
            {priorities.map((p) => (
              <option key={p} value={p}>{mk.priority[p]}</option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}
