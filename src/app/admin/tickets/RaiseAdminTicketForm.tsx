"use client";

import { useActionState, useMemo, useState } from "react";
import { raiseAdminTicketAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

export type TicketTargetOption = { value: string; label: string; group: string };

/** نموذج رفع تذكرة — بخطوات مرتّبة.
 *
 *  كان الكلّ قائمةً واحدة طويلة تخلط الأقسام بالأشخاص بالأعضاء، فيبحث
 *  رافع التذكرة في عشرات الأسماء ليجد وجهته. والترتيب الطبيعي للسؤال
 *  هو: إلى أين أولاً، ثم إلى مَن بالضبط، ثم ما الموضوع.
 *
 *  فصارت الخطوات: الوجهة (قسم / حساب إداري / عضو) ← تحديدها ← العنوان
 *  ← التفاصيل ← رابط إن وُجد. وكل خطوة تُظهر ما قبلها مختصراً فيُرى
 *  المسار كلّه، ويُعاد لأي خطوة بضغطة.
 */
export function RaiseAdminTicketForm({
  targets,
  theme,
}: {
  targets: TicketTargetOption[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const dict = useTranslations();
  const t = dict.ticketsPage;
  const [state, formAction, pending] = useActionState(raiseAdminTicketAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [handledSuccess, setHandledSuccess] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [attachLink, setAttachLink] = useState(false);

  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) {
      setOpen(false);
      setGroup(null);
      setTarget("");
      setAttachLink(false);
    }
  }

  const groups = useMemo(() => Array.from(new Set(targets.map((o) => o.group))), [targets]);
  const inGroup = useMemo(
    () => (group ? targets.filter((o) => o.group === group) : []),
    [targets, group]
  );
  const chosen = targets.find((o) => o.value === target) ?? null;

  if (!open) {
    return (
      <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
        {t.raiseTitle}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      {/* ١ — الوجهة */}
      <Step n="١" label={t.stepDestination} done={Boolean(group)}>
        {group && (
          <ChangeButton label={group} onClick={() => { setGroup(null); setTarget(""); }} change={t.change} />
        )}
        {!group && (
          <div className="grid gap-2 sm:grid-cols-3">
            {groups.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className="min-h-11 rounded-xl border border-black/10 px-4 py-3 text-start text-sm font-semibold text-black/75 transition hover:border-black/25 hover:bg-black/[0.02]"
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </Step>

      {/* ٢ — من بالضبط */}
      {group && (
        <Step n="٢" label={t.stepWho} done={Boolean(target)}>
          {chosen ? (
            <ChangeButton label={chosen.label} onClick={() => setTarget("")} change={t.change} />
          ) : (
            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {inGroup.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setTarget(o.value)}
                  className="min-h-11 rounded-xl border border-black/10 px-4 py-2.5 text-start text-sm text-black/75 transition hover:border-black/25 hover:bg-black/[0.02]"
                >
                  {o.label}
                </button>
              ))}
              {inGroup.length === 0 && (
                <p className="py-3 text-sm text-black/40">{t.noTargets}</p>
              )}
            </div>
          )}
          <input type="hidden" name="target" value={target} />
        </Step>
      )}

      {/* ٣ و ٤ — العنوان والتفاصيل */}
      {target && (
        <>
          <Step n="٣" label={t.stepSubject} done={false}>
            <input
              name="subject"
              required
              maxLength={120}
              placeholder={t.subjectPlaceholder}
              className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
            />
          </Step>

          <Step n="٤" label={t.stepDetails} done={false}>
            <textarea
              name="description"
              required
              rows={4}
              placeholder={t.detailsPlaceholder}
              className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            />
          </Step>

          {/* ٥ — الرابط خيار صريح: أكثر التذاكر بلا رابط، فلا يُفرض حقل
              فارغ على كل رافع */}
          <Step n="٥" label={t.stepLink} done={false}>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={attachLink}
                onChange={(e) => setAttachLink(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                <span className="font-medium text-black/75">{t.attachLink}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-black/45">
                  {t.attachLinkHint}
                </span>
              </span>
            </label>
            {attachLink && (
              <input
                name="linkUrl"
                type="url"
                required
                dir="ltr"
                placeholder="https://..."
                className="mt-2.5 min-h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
              />
            )}
          </Step>

          <p className="text-xs leading-relaxed text-black/40">{t.slaHint}</p>
        </>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending || !target}>
          {pending ? t.raising : t.raiseSubmit}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function Step({
  n,
  label,
  done,
  children,
}: {
  n: string;
  label: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? "bg-emerald-100 text-emerald-700" : "bg-black/[0.06] text-black/50"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-sm font-semibold text-black/70">{label}</p>
        {children}
      </div>
    </div>
  );
}

/** ما اختير يُعرض مختصراً مع زرّ تغييره — فلا يُعاد الملء من أوله */
function ChangeButton({
  label,
  onClick,
  change,
}: {
  label: string;
  onClick: () => void;
  change: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[0.03] px-3.5 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-black/80">{label}</span>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 text-xs font-semibold text-black/50 underline underline-offset-2 hover:text-black/75"
      >
        {change}
      </button>
    </div>
  );
}
