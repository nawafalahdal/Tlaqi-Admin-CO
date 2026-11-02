import type { CommitteeKind } from "@prisma/client";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { Field, inputCls, textareaCls, dayInput } from "./bits";

export type CommitteeValues = {
  name: string;
  description: string | null;
  purpose: string | null;
  scope: string | null;
  responsibilities: string | null;
  expectedOutputs: string | null;
  kpis: string | null;
  committeeKind: CommitteeKind | null;
  startDate: Date | null;
  endDate: Date | null;
};

/** حقولُ هويّة اللجنة — في الإنشاء وفي الإعدادات، بالحدود نفسِها التي يفرضها الخادم */
export function CommitteeFields({ L, v }: { L: Dictionary["org"]; v?: CommitteeValues }) {
  const F = L.form;
  const kind = v?.committeeKind ?? "permanent";
  return (
    <div className="flex flex-col gap-4">
      <Field label={F.name} required>
        <input name="name" required maxLength={80} defaultValue={v?.name ?? ""} placeholder={F.namePh} className={inputCls} />
      </Field>
      <Field label={F.purpose} hint={F.purposeHint} required>
        <textarea name="purpose" required maxLength={2000} defaultValue={v?.purpose ?? ""} className={textareaCls} />
      </Field>
      <Field label={F.description}>
        <textarea name="description" maxLength={2000} defaultValue={v?.description ?? ""} className={textareaCls} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={F.scope}>
          <textarea name="scope" maxLength={2000} defaultValue={v?.scope ?? ""} className={textareaCls} />
        </Field>
        <Field label={F.responsibilities}>
          <textarea name="responsibilities" maxLength={2000} defaultValue={v?.responsibilities ?? ""} className={textareaCls} />
        </Field>
        <Field label={F.expectedOutputs}>
          <textarea name="expectedOutputs" maxLength={2000} defaultValue={v?.expectedOutputs ?? ""} className={textareaCls} />
        </Field>
        <Field label={F.kpis}>
          <textarea name="kpis" maxLength={2000} defaultValue={v?.kpis ?? ""} className={textareaCls} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium text-black/70">{F.kind}</legend>
        <div className="flex flex-wrap gap-4">
          {(["permanent", "temporary"] as const).map((k) => (
            <label key={k} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="radio" name="kind" value={k} defaultChecked={kind === k} className="h-4 w-4" />
              {L.kinds[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={F.startDate}>
          <input type="date" name="startDate" defaultValue={dayInput(v?.startDate)} className={inputCls} />
        </Field>
        <Field label={F.endDate} hint={F.endHint}>
          <input type="date" name="endDate" defaultValue={dayInput(v?.endDate)} className={inputCls} />
        </Field>
      </div>
    </div>
  );
}
