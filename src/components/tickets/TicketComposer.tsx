"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";
import { NavGlyph } from "../icons";

export type TicketTarget = {
  /** `dept:<id>` أو `user:<id>` أو `member:<id>` — كما يقرؤها إجراءُ الخادم */
  value: string;
  label: string;
  /** سطرٌ ثانٍ: الصفة أو القسم */
  sub?: string;
  group: string;
  /** لونُ القسم — للأقسام وحدها — وحبرٌ يُقرأ عليه (البيجُ لا يحمل أبيض) */
  color?: string;
  colorInk?: string;
};

type RaiseState = { error: string | null; success: boolean };
type RaiseAction = (prev: RaiseState, formData: FormData) => Promise<RaiseState>;

type Step = 0 | 1 | 2;

/** مُنشئُ التذاكر — أوّلُ ما في المنصة وأكثرُه استعمالاً.
 *
 *  ثلاثُ خطوات: **الوجهة ← الطلب ← المراجعة**. كلُّ خطوةٍ تسأل سؤالاً
 *  واحداً، وما اختير يبقى ظاهراً ويُعدَّل بنقرة. والنموذجُ لا يُرسَل إلا من
 *  خطوة المراجعة: Enter في حقلٍ ينقل إلى ما بعده، فلا تُرفع تذكرةٌ ناقصة
 *  بضغطةٍ عجلى.
 *
 *  والمكوّنُ لا يعرف من يرفع: الإجراءُ (العضو أو الإداري) يأتيه من الصفحة،
 *  والوجهاتُ محسوبةٌ على الخادم لدور صاحبها. والخادمُ يبقى الحَكَم. */
export function TicketComposer({
  action,
  targets,
  allowLink,
  mineHref,
  stageDays,
}: {
  action: RaiseAction;
  targets: TicketTarget[];
  /** إرفاقُ الرابط — لمن يقبله إجراؤه وحده */
  allowLink: boolean;
  mineHref: string;
  stageDays: number;
}) {
  const L = useTranslations().composer;
  const [state, formAction, pending] = useActionState(action, { error: null, success: false });

  const [step, setStep] = useState<Step>(0);
  const groups = useMemo(() => Array.from(new Set(targets.map((o) => o.group))), [targets]);
  const [group, setGroup] = useState(groups[0] ?? "");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [withLink, setWithLink] = useState(false);
  const [link, setLink] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  // كلُّ ردٍّ من الخادم كائنٌ جديد — فيُقارَن الردُّ نفسُه لا قيمةُ `success`:
  // تذكرتان ناجحتان متتاليتان قيمتهما واحدة، ولكلٍّ منهما شاشةُ نجاحها
  const [showSuccess, setShowSuccess] = useState(false);
  const [seenState, setSeenState] = useState(state);
  const detailsRef = useRef<HTMLTextAreaElement>(null);

  if (state !== seenState) {
    setSeenState(state);
    if (state.success) setShowSuccess(true);
  }

  const chosen = targets.find((o) => o.value === target) ?? null;
  const q = query.trim().toLowerCase();
  const visible = targets.filter(
    (o) =>
      (q ? true : o.group === group) &&
      (!q || o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q))
  );

  const subjectOk = subject.trim().length >= 3;
  const detailsOk = details.trim().length > 0;
  const linkOk = !withLink || /^https:\/\/\S+\.\S+/.test(link.trim());

  function go(next: Step) {
    if (next >= 1 && !chosen) return setHint(L.needTarget);
    if (next >= 2) {
      if (!subjectOk) return setHint(L.needSubject);
      if (!detailsOk) return setHint(L.needDetails);
      if (!linkOk) return setHint(L.needLink);
    }
    setHint(null);
    setStep(next);
  }

  function reset() {
    setStep(0);
    setTarget("");
    setSubject("");
    setDetails("");
    setWithLink(false);
    setLink("");
    setQuery("");
    setHint(null);
    setShowSuccess(false);
  }

  const steps = [L.stepTarget, L.stepRequest, L.stepReview];

  return (
    <div className="composer">
      <div className="composer__main">
        {showSuccess && chosen ? (
          <div className="composer__success" role="status">
            <span className="composer__success-icon" aria-hidden="true">
              <NavGlyph name="check" />
            </span>
            <h2 className="text-xl font-bold">{L.successTitle}</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-black/60">
              {L.successBody.replace("{to}", chosen.label)}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link href={mineHref} className="btn-brand composer__btn">
                {L.successMine}
              </Link>
              <button type="button" onClick={reset} className="composer__btn composer__btn--ghost">
                {L.successAnother}
              </button>
            </div>
          </div>
        ) : (
          <form
            action={formAction}
            onSubmit={(e) => {
              // لا إرسالَ إلا من المراجعة، ولا تذكرةَ ناقصة
              if (step !== 2 || !chosen || !subjectOk || !detailsOk || !linkOk) e.preventDefault();
            }}
          >
            {/* المسار: ثلاثُ مراحل، والمنجزُ منها يُعاد إليه بنقرة */}
            <ol className="composer__steps" aria-label={L.pageTitle}>
              {steps.map((label, i) => {
                const state_ = i < step ? "done" : i === step ? "current" : "todo";
                return (
                  <li key={label} className="composer__step" data-state={state_}>
                    <button
                      type="button"
                      disabled={i > step}
                      onClick={() => setStep(i as Step)}
                      aria-current={i === step ? "step" : undefined}
                      className="composer__step-btn"
                    >
                      <span className="composer__step-dot" aria-hidden="true">
                        {i < step ? <NavGlyph name="check" /> : i + 1}
                      </span>
                      <span className="composer__step-label">{label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* ١ — الوجهة */}
            {step === 0 && (
              <section className="composer__panel" aria-labelledby="c-target">
                <h2 id="c-target" className="composer__title">{L.targetTitle}</h2>
                <p className="composer__hint">{L.targetHint}</p>

                <div className="composer__search">
                  <NavGlyph name="search" className="composer__search-icon" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    placeholder={L.searchPlaceholder}
                    aria-label={L.searchPlaceholder}
                  />
                </div>

                {!q && groups.length > 1 && (
                  <div role="tablist" className="composer__tabs">
                    {groups.map((g) => (
                      <button
                        key={g}
                        type="button"
                        role="tab"
                        aria-selected={group === g}
                        onClick={() => setGroup(g)}
                        className="composer__tab"
                      >
                        {g}
                        <span className="composer__tab-count">
                          {targets.filter((o) => o.group === g).length}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div role="radiogroup" aria-label={L.targetTitle} className="composer__targets">
                  {visible.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={target === o.value}
                      onClick={() => {
                        setTarget(o.value);
                        setHint(null);
                      }}
                      onDoubleClick={() => {
                        setTarget(o.value);
                        setHint(null);
                        setStep(1);
                      }}
                      className="composer__target"
                    >
                      <span
                        className="composer__avatar"
                        aria-hidden="true"
                        style={o.color ? { background: o.color, color: o.colorInk ?? "#fff" } : undefined}
                      >
                        {o.value.startsWith("dept:") ? (
                          <NavGlyph name="departments" />
                        ) : (
                          o.label.trim().slice(0, 1)
                        )}
                      </span>
                      <span className="min-w-0 flex-1 text-start">
                        <span className="block truncate text-sm font-semibold">{o.label}</span>
                        {o.sub && <span className="block truncate text-xs text-black/50">{o.sub}</span>}
                      </span>
                      <span className="composer__radio" aria-hidden="true">
                        <NavGlyph name="check" />
                      </span>
                    </button>
                  ))}
                  {visible.length === 0 && (
                    <p className="composer__empty">{L.noResults.replace("{q}", query.trim())}</p>
                  )}
                </div>
              </section>
            )}

            {/* ٢ — الطلب */}
            {step === 1 && chosen && (
              <section className="composer__panel" aria-labelledby="c-request">
                <h2 id="c-request" className="composer__title">{L.requestTitle}</h2>
                <ChosenTarget target={chosen} label={L.reviewTo} edit={L.edit} onEdit={() => setStep(0)} />

                <label className="composer__field">
                  <span className="composer__label">
                    {L.subjectLabel}
                    <span className="composer__count">{subject.length}/120</span>
                  </span>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter ينقل إلى التفاصيل لا يُرسل
                      if (e.key === "Enter") {
                        e.preventDefault();
                        detailsRef.current?.focus();
                      }
                    }}
                    maxLength={120}
                    autoFocus
                    placeholder={L.subjectPlaceholder}
                    className="composer__input"
                  />
                </label>

                <label className="composer__field">
                  <span className="composer__label">
                    {L.detailsLabel}
                    <span className="composer__count">{details.length}/4000</span>
                  </span>
                  <textarea
                    ref={detailsRef}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    maxLength={4000}
                    rows={6}
                    placeholder={L.detailsPlaceholder}
                    className="composer__input composer__textarea"
                  />
                </label>

                {allowLink && (
                  <div className="composer__field">
                    <label className="composer__switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={withLink}
                        onChange={(e) => setWithLink(e.target.checked)}
                      />
                      <span className="composer__switch-track" aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-semibold">{L.linkToggle}</span>
                        <span className="block text-xs text-black/50">{L.linkHint}</span>
                      </span>
                    </label>
                    {withLink && (
                      <div className="composer__search mt-2">
                        <NavGlyph name="link" className="composer__search-icon" />
                        <input
                          type="url"
                          dir="ltr"
                          value={link}
                          onChange={(e) => setLink(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                          placeholder="https://"
                          aria-label={L.linkToggle}
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* ٣ — المراجعة */}
            {step === 2 && chosen && (
              <section className="composer__panel" aria-labelledby="c-review">
                <h2 id="c-review" className="composer__title">{L.reviewTitle}</h2>
                <dl className="composer__review">
                  <ReviewRow label={L.reviewTo} onEdit={() => setStep(0)} edit={L.edit}>
                    {chosen.label}
                    {chosen.sub && <span className="text-black/50"> — {chosen.sub}</span>}
                  </ReviewRow>
                  <ReviewRow label={L.reviewSubject} onEdit={() => setStep(1)} edit={L.edit}>
                    {subject.trim()}
                  </ReviewRow>
                  <ReviewRow label={L.reviewDetails} onEdit={() => setStep(1)} edit={L.edit}>
                    <span className="whitespace-pre-wrap">{details.trim()}</span>
                  </ReviewRow>
                  {withLink && link.trim() && (
                    <ReviewRow label={L.reviewLink} onEdit={() => setStep(1)} edit={L.edit}>
                      <span dir="ltr" className="break-all">{link.trim()}</span>
                    </ReviewRow>
                  )}
                </dl>
              </section>
            )}

            {/* ما يصل إلى الخادم — قيمٌ مضبوطة لا حقولٌ تختفي مع خطوتها */}
            <input type="hidden" name="target" value={target} />
            <input type="hidden" name="subject" value={subject.trim()} />
            <input type="hidden" name="description" value={details.trim()} />
            {allowLink && withLink && <input type="hidden" name="linkUrl" value={link.trim()} />}

            {(hint || state.error) && (
              <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
                {hint ?? state.error}
              </p>
            )}

            <div className="composer__actions">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => go((step - 1) as Step)}
                  className="composer__btn composer__btn--ghost"
                >
                  {L.back}
                </button>
              )}
              {/* مفتاحان مختلفان عمداً: لو أعاد React استعمالَ الزرّ نفسه لصار
                  «التالي» زرَّ إرسالٍ قبل أن يُنهي المتصفّحُ نقرته — فتُرفع
                  التذكرةُ والمستخدمُ لم يرَ المراجعة بعد */}
              {step < 2 ? (
                <button key="next" type="button" onClick={() => go((step + 1) as Step)} className="btn-brand composer__btn">
                  {L.next}
                </button>
              ) : (
                <button key="submit" type="submit" disabled={pending} className="btn-brand composer__btn">
                  <NavGlyph name="send" className="composer__btn-icon" />
                  {pending ? L.submitting : L.submit}
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* المسارُ الذي تسلكه التذكرة — كما هو في محرّك التصعيد، لا وعداً */}
      <aside className="composer__aside">
        <div className="composer__card">
          <h3 className="composer__aside-title">
            <NavGlyph name="clock" /> {L.journeyTitle}
          </h3>
          <ol className="composer__journey">
            {(["department", "lead_escalation", "ceo_escalation", "founder_escalation"] as const).map(
              (s, i, all) => (
                <li key={s}>
                  <span className="composer__journey-dot" aria-hidden="true">{i + 1}</span>
                  <span>
                    <span className="block text-sm font-semibold">{L.stages[s]}</span>
                    <span className="block text-xs text-black/50">
                      {i === all.length - 1
                        ? L.journeyFinal
                        : stageDays === 2
                          ? L.journeyDue2
                          : L.journeyDueN.replace("{n}", String(stageDays))}
                    </span>
                  </span>
                </li>
              )
            )}
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-black/50">{L.journeyAuto}</p>
        </div>
        <div className="composer__card">
          <h3 className="composer__aside-title">{L.tipsTitle}</h3>
          <ul className="composer__tips">
            <li>{L.tip1}</li>
            <li>{L.tip2}</li>
            {allowLink && <li>{L.tip3}</li>}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function ChosenTarget({
  target,
  label,
  edit,
  onEdit,
}: {
  target: TicketTarget;
  label: string;
  edit: string;
  onEdit: () => void;
}) {
  return (
    <div className="composer__chosen">
      <span className="text-xs font-semibold text-black/45">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {target.label}
        {target.sub && <span className="font-normal text-black/50"> — {target.sub}</span>}
      </span>
      <button type="button" onClick={onEdit} className="composer__link">
        {edit}
      </button>
    </div>
  );
}

function ReviewRow({
  label,
  edit,
  onEdit,
  children,
}: {
  label: string;
  edit: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="composer__review-row">
      <dt className="text-xs font-semibold text-black/45">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm leading-relaxed">{children}</dd>
      <button type="button" onClick={onEdit} className="composer__link">
        {edit}
      </button>
    </div>
  );
}
