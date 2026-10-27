import { BRIEF_REQUIRED, BRIEF_OPTIONAL, BRAND_DEFAULTS } from "@/lib/marketing/designBrief";
import { FINAL_ITEMS } from "@/lib/marketing/review";
import { fmt } from "@/i18n/fmt";
import { ActionForm } from "../../../../_components/ActionForm";
import { Pill, Section, Field, inputCls, areaCls, nameOf, when, Muted } from "../../../../_components/bits";
import { BrandAssets, type Ctx } from "./sections";

/** موجزُ التصميم والفحصُ النهائي — كلاهما شرطٌ يفرضه الخادم (`requireBriefComplete`، `publicationBlockers`)؛
 *  والنموذجُ يُرسَم لصاحب المسؤولية في الحالة التي تقبله الخدمة وحدها. */

const LONG = new Set(["layout", "contrastNotes", "imagery", "visualReferences", "secondaryText"]);

export function DesignBriefSection({ mk, locale, d, has, gaps }: Ctx & { gaps: string[] }) {
  const L = mk.designBrief;
  const b = d.designBrief;
  const closed = d.status === "published";
  const canEdit = (has("coordinator") || has("designer")) && !closed;
  const value = (k: string): string => {
    const v = b ? (b as unknown as Record<string, string | null>)[k] : null;
    if (v) return v;
    return (BRAND_DEFAULTS as Record<string, string>)[k] ?? "";
  };
  const label = (k: string) => (L.fields as Record<string, string>)[k] ?? k;
  const sep = locale === "ar" ? "، " : ", ";

  return (
    <Section id="brief" title={L.title} hint={L.hint}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-black/60" dir="auto">{fmt(L.dimensions, d.width, d.height)}</p>
        {gaps.length === 0 ? (
          <p className="text-sm font-semibold text-emerald-700">{L.complete}</p>
        ) : (
          <p className="text-xs text-amber-900">{fmt(L.missing, gaps.map(label).join(sep))}</p>
        )}
        {canEdit ? (
          <ActionForm op="brief.design" submit={L.save}>
            <input type="hidden" name="deliverableId" value={d.id} />
            <p className="text-[11px] leading-relaxed text-black/50">{L.defaultsHint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[...BRIEF_REQUIRED, ...BRIEF_OPTIONAL].map((k) =>
                k === "direction" ? (
                  <Field key={k} label={`${label(k)} · ${mk.common.required}`}>
                    <select name={k} defaultValue={value(k) || "rtl"} className={inputCls}>
                      <option value="rtl">{L.directionOptions.rtl}</option>
                      <option value="ltr">{L.directionOptions.ltr}</option>
                    </select>
                  </Field>
                ) : k === "externalLink" ? (
                  <Field key={k} label={label(k)} hint={L.linkNote} className="sm:col-span-2">
                    <input name={k} type="url" dir="ltr" placeholder="https://" defaultValue={value(k)} className={inputCls} />
                  </Field>
                ) : (
                  <Field key={k} label={(BRIEF_REQUIRED as readonly string[]).includes(k) ? `${label(k)} · ${mk.common.required}` : label(k)} className={LONG.has(k) ? "sm:col-span-2" : ""}>
                    {LONG.has(k) ? (
                      <textarea name={k} rows={2} maxLength={1000} defaultValue={value(k)} className={areaCls} dir="auto" />
                    ) : (
                      <input name={k} maxLength={1000} defaultValue={value(k)} className={inputCls} dir="auto" />
                    )}
                  </Field>
                )
              )}
            </div>
          </ActionForm>
        ) : b ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[...BRIEF_REQUIRED, ...BRIEF_OPTIONAL].map((k) => (
              <div key={k}>
                <dt className="text-xs font-bold text-black/55">{label(k)}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap" dir="auto">{value(k) || mk.common.none}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Muted>{L.readOnly}</Muted>
        )}
        <BrandAssets mk={mk} />
      </div>
    </Section>
  );
}

export function FinalCheckSection({ mk, d, workable, has }: Ctx) {
  const L = mk.finalCheck;
  const content = d.contentVersions.find((v) => v.id === d.currentContentVersionId);
  const design = d.designVersions.find((v) => v.id === d.currentDesignVersionId);
  const canRecord = has("publisher") && workable && d.status === "ready_to_publish" && !!content && !!design;
  const label = (k: string) => (L.items as Record<string, string>)[k] ?? k;

  return (
    <Section id="final-check" title={L.title} hint={L.hint}>
      {canRecord ? (
        <ActionForm op="final.record" submit={L.record}>
          <input type="hidden" name="deliverableId" value={d.id} />
          <input type="hidden" name="contentVersionId" value={content!.id} />
          <input type="hidden" name="designVersionId" value={design!.id} />
          <p className="text-xs text-black/60">{fmt(L.onPair, content!.number, design!.number)}</p>
          <ul className="flex flex-col divide-y divide-black/[0.06]">
            {FINAL_ITEMS.map((k) => (
              <li key={k} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-3">
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input type="checkbox" name={`item.${k}`} />
                  {label(k)}
                </label>
                <input name={`note.${k}`} maxLength={500} placeholder={L.itemNote} aria-label={`${label(k)} — ${L.itemNote}`} className={`${inputCls} sm:max-w-72`} />
              </li>
            ))}
          </ul>
          <Field label={L.note} hint={L.noteHint}>
            <textarea name="note" rows={2} maxLength={1000} className={areaCls} />
          </Field>
        </ActionForm>
      ) : (
        d.finalChecks.length === 0 && <Muted>{L.notYet}</Muted>
      )}
      {d.finalChecks.length > 0 && (
        <details className="mt-3" open={!canRecord}>
          <summary className="cursor-pointer text-sm font-bold">{L.history} ({d.finalChecks.length})</summary>
          <ol className="mt-2 flex flex-col gap-2">
            {d.finalChecks.map((f) => {
              const items = Array.isArray(f.items) ? (f.items as { key: string; passed: boolean; note?: string | null; auto?: boolean }[]) : [];
              return (
                <li key={f.id} className="rounded-xl border border-black/[0.08] p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-black/55">
                    <Pill tone={f.passed ? "good" : "bad"}>{f.passed ? L.passed : L.failed}</Pill>
                    {f.returnedTo && <Pill tone="review">{(L.returnedTo as Record<string, string>)[f.returnedTo] ?? f.returnedTo}</Pill>}
                    <span>{fmt(L.onPair, f.contentVersion.number, f.designVersion.number)}</span>
                    <span>{fmt(mk.common.by, nameOf(f.publisher))}</span>
                    <span>{when(f.createdAt)}</span>
                    {f.invalidatedAt && <Pill>{fmt(mk.common.invalidated, when(f.invalidatedAt))}</Pill>}
                  </p>
                  {f.note && <p className="mt-1 text-sm">{f.note}</p>}
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {items.map((i) => (
                      <li key={i.key} className="text-xs text-black/65">
                        {i.passed ? "✓" : "✕"} {label(i.key)}
                        {i.auto ? ` — ${i.passed ? L.autoOk : L.autoFail}` : i.note ? ` — ${i.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </Section>
  );
}
