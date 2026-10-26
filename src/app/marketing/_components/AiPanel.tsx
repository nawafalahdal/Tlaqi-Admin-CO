"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
import type { AiStatus } from "@/lib/marketing/ai/registry";
import type { JobsView } from "@/lib/marketing/ai/view";
import { pollAiJobs } from "../actions";
import { ActionForm } from "./ActionForm";
import { Pill, Field, inputCls, areaCls } from "./bits";

/** لوحةُ الاقتراح — تقول الحقيقةَ عن حالة المزوّد قبل أي زرّ.
 *
 *  - **غيرُ مهيّأ أو معطّل:** تُعرض الحالةُ وسببُها، ولا زرَّ طلبٍ يُرسَم.
 *  - **المحاكاة:** معلَّمةٌ في رأس اللوحة وعلى كل طلب — ليست ذكاءً اصطناعياً.
 *  - **المتابعة:** ما دام طلبٌ في الانتظار أو جارياً تُسأل الحالةُ كل بضع ثوانٍ
 *    (`pollAiJobs`)، وهي التي تُشغّل الإعادةَ المجدولة حين يحين موعدها. */

type Data = { status: AiStatus["text"] } & JobsView;

export function AiPanel({ deliverableId, initial, image, workable }: { deliverableId: string; initial: Data; image: AiStatus["image"]; workable: boolean }) {
  const mk = useTranslations().mk;
  const L = mk.ai;
  const { locale } = useLocale();
  // ما جاء من المتابعة يغلب ما رسمه الخادم — حتى يرسم الخادمُ من جديد (بعد إجراءٍ)، فيغلب هو
  const [polled, setPolled] = useState<{ from: Data; data: Data } | null>(null);
  const data = polled && polled.from === initial ? polled.data : initial;

  const active = data.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const id = window.setInterval(async () => {
      const next = await pollAiJobs(deliverableId).catch(() => null);
      if (!stop && next) setPolled({ from: initial, data: next });
    }, 4000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [active, deliverableId, initial]);

  const s = data.status;
  const reason = s.reason ? (L.reasons as Record<string, string>)[s.reason] ?? s.reason : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/[0.08] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{L.title}</span>
        <Pill tone={s.state === "ready" ? "good" : "neutral"}>{L.states[s.state]}</Pill>
        {reason && <span className="text-xs text-black/55">{reason}</span>}
        {s.simulated && <Pill tone="review">{L.simulated}</Pill>}
      </div>
      <p className="text-xs leading-relaxed text-black/55">{L.hint}</p>

      {s.state === "ready" && data.canRequest && workable && (
        <ActionForm op="ai.request" submit={L.request} variant="outline" resetOnSuccess>
          <input type="hidden" name="deliverableId" value={deliverableId} />
          <Field label={L.instructions} hint={L.instructionsHint}>
            <textarea name="instructions" rows={2} maxLength={2000} className={areaCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={L.variants}>
              <select name="variants" defaultValue="2" className={inputCls}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label={L.language}>
              <select name="language" defaultValue={locale} className={inputCls}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
        </ActionForm>
      )}

      {data.jobs.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-black/5 pt-3">
          <span className="text-xs font-bold text-black/60">{L.jobs}</span>
          <ul className="flex flex-col gap-3">
            {data.jobs.map((j) => (
              <li key={j.id} className="rounded-lg bg-black/[0.03] p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Pill tone={j.status === "succeeded" ? "good" : j.status === "failed" ? "bad" : j.status === "cancelled" ? "neutral" : "review"}>{L.jobStatus[j.status]}</Pill>
                  {j.simulated && <Pill tone="review">{L.simulated}</Pill>}
                  {j.error && <span className="text-black/60">{(L.jobErrors as Record<string, string>)[j.error] ?? j.error}</span>}
                  {(j.status === "queued" || j.status === "running" || j.status === "failed") && j.attempts > 0 && (
                    <span className="text-black/50">{fmt(L.attempts, j.attempts, j.maxAttempts)}</span>
                  )}
                  {j.status === "queued" && j.attempts > 0 && <span className="text-black/50">{L.nextAttempt}</span>}
                  {j.model && <span className="text-black/40" dir="ltr">{fmt(L.model, j.model)}</span>}
                  {j.adopted && <Pill tone="good">{L.adopted}</Pill>}
                </div>
                {data.canRequest && workable && (j.status === "queued" || j.status === "running") && (
                  <div className="mt-2">
                    <ActionForm op="ai.cancel" submit={L.cancel} variant="ghost">
                      <input type="hidden" name="jobId" value={j.id} />
                    </ActionForm>
                  </div>
                )}
                {data.canRequest && workable && j.status === "failed" && j.retryable && s.state === "ready" && (
                  <div className="mt-2">
                    <ActionForm op="ai.retry" submit={L.retry} variant="outline">
                      <input type="hidden" name="jobId" value={j.id} />
                    </ActionForm>
                  </div>
                )}
                {j.status === "succeeded" && (
                  <ol className="mt-2 flex flex-col gap-2">
                    {j.variants.map((v, i) => (
                      <li key={i} className="rounded-lg border border-black/[0.08] bg-white p-2.5">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{v.text}</p>
                        {v.rationale && <p className="mt-1 text-[11px] text-black/50">{v.rationale}</p>}
                        {data.canRequest && workable && (
                          <div className="mt-2">
                            <ActionForm op="ai.adopt" submit={L.adopt} variant="outline">
                              <input type="hidden" name="jobId" value={j.id} />
                              <input type="hidden" name="variant" value={i} />
                              <label className="flex items-center gap-1.5 text-[11px] text-black/60">
                                <input type="checkbox" name="replaceEdited" />
                                {L.adoptReplace}
                              </label>
                            </ActionForm>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-black/5 pt-2 text-[11px] text-black/50">
        <span className="font-bold">{L.imageTitle}:</span> {image.state === "not_configured" ? L.imageState : L.states[image.state]}
      </p>
    </div>
  );
}
