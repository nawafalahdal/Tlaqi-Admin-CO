"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CertificateFrameBox, CertificateSheet } from "@/components/certificates/CertificateSheet";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
import { gx } from "@/lib/gender";
import { orgCalendarDate } from "@/lib/anniversary";
import {
  applyDerived,
  buildView,
  CERTIFICATE_TYPES,
  DERIVED_KEYS,
  durationBetween,
  FIELD_SPECS,
  fieldEdits,
  longDateAr,
  missingFields,
  occasionFor,
  TYPE_INFO,
  type CertificateFields,
  type CertificateType,
  type FieldKey,
} from "@/lib/certificateTypes";
import type { RecipientDetails } from "@/lib/certificateRegistry";
import { issueCertificateAction, loadCertificateRecipientAction } from "./actions";

export type RecipientOption = { id: string; name: string; dept: string; role: string };

const TYPE_KEY: Record<CertificateType, string> = {
  appreciation: "typeAppreciation",
  achievement: "typeAchievement",
  appointment: "typeAppointment",
  leadership: "typeLeadership",
  membership: "typeMembership",
  final: "typeFinal",
};

/** **إصدار شهادة يدوياً** — الواجهةُ المعتمدة (لوحة «ops-issue»): ستُّ خطوات،
 *  ومعاينةٌ حيّة بالقالب نفسه الذي تصدر به، وفحوصٌ قبل الإرسال.
 *
 *  الواجهةُ تُرشد ولا تحكم: كلُّ فحصٍ هنا يُعاد في الخادم (`issueCertificate`) —
 *  السلسلةُ والأهليةُ والحقولُ والإصدارُ المبكر ولا تكرار. وما عُدِّل يدوياً يُرسَل
 *  كما هو، والخادمُ يقيسه على الأصل ويسجّله. */
export function IssueWorkspace({
  recipients,
  role,
  initialMemberId,
  initialType,
}: {
  recipients: RecipientOption[];
  role: string;
  initialMemberId?: string;
  initialType?: CertificateType;
}) {
  const t = useTranslations();
  const T = t.rIssueDesk;
  const router = useRouter();
  const [memberId, setMemberId] = useState<string | null>(initialMemberId ?? null);
  const [details, setDetails] = useState<RecipientDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<CertificateType>(initialType ?? "appreciation");
  const [fieldsByType, setFieldsByType] = useState<Partial<Record<CertificateType, CertificateFields>>>({});
  const [touched, setTouched] = useState<Partial<Record<CertificateType, FieldKey[]>>>({});
  const [early, setEarly] = useState({ on: false, reason: "", reference: "" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [result, setResult] = useState<{ number: string; id: string; delivered: boolean; reason?: string } | null>(null);
  const [issuing, startIssue] = useTransition();
  const printRef = useRef<HTMLDivElement>(null);

  /** يقرأ بيانات المستلِم من الخادم — بالسلسلة نفسها */
  function load(id: string) {
    startLoad(async () => {
      const res = await loadCertificateRecipientAction(id);
      if (!res.ok) return setLoadError(res.reason);
      setDetails(res);
      setFieldsByType(res.defaults);
    });
  }

  function pick(id: string) {
    setMemberId(id);
    setDetails(null);
    setLoadError(null);
    setResult(null);
    setFieldsByType({});
    setTouched({});
    setEarly({ on: false, reason: "", reference: "" });
    load(id);
  }

  // من «بانتظار التكريم»: يُفتح النموذج بصاحبها ونوعها (والمكوّنُ يُبنى من جديد لكل رابط)
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialMemberId) return;
    opened.current = true;
    load(initialMemberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? recipients.filter((r) => r.name.toLowerCase().includes(q)) : recipients;
    return list.slice(0, 8);
  }, [query, recipients]);

  const gender = details?.facts.gender ?? null;
  const fields = details ? (fieldsByType[type] ?? details.defaults[type]) : null;
  const touchedSet = useMemo(() => new Set(touched[type] ?? []), [touched, type]);

  function setField(key: FieldKey, value: string) {
    if (!details || !fields) return;
    const nextTouched = DERIVED_KEYS[type].includes(key) ? new Set([...touchedSet, key]) : touchedSet;
    const next = applyDerived(type, { ...fields, [key]: value }, gender, nextTouched);
    setFieldsByType((m) => ({ ...m, [type]: next }));
    if (nextTouched !== touchedSet) setTouched((m) => ({ ...m, [type]: [...nextTouched] }));
  }

  function resetFields() {
    if (!details) return;
    setFieldsByType((m) => ({ ...m, [type]: details.defaults[type] }));
    setTouched((m) => ({ ...m, [type]: [] }));
  }

  const isAppreciation = type === "appreciation";
  const needsEarly = !!details && isAppreciation && !details.facts.completedThreeMonths;
  const blocked = details?.blocked[type] ?? null;
  const signers = details ? (type === "leadership" ? details.signers.leadership : details.signers.other) : null;
  const edits = details && fields ? fieldEdits(type, details.defaults[type], fields, gender) : [];
  const missing = fields ? missingFields(type, fields) : [];
  const duplicate = !!details && !!fields && details.issuedOccasions.includes(occasionFor(type, fields));
  const earlyIncomplete = needsEarly && (!early.on || early.reason.trim().length < 5 || early.reference.trim().length < 2);
  const missingSig = signers ? signers.pair.filter((s) => !s.signatureId) : [];
  const canIssue = !!details && !blocked && !duplicate && missing.length === 0 && !earlyIncomplete && !issuing && !result;

  const view =
    details && fields && signers
      ? buildView(type, fields, {
          colorHex: details.recipient.colorHex,
          number: details.nextNumbers[type],
          issuedAt: new Date().toISOString(),
          signers: signers.pair.map((s) => ({ title: s.title, name: s.name, signatureImage: s.signatureImage })),
        })
      : null;

  /** «تنزيل PDF للمعاينة» — نافذةُ الطباعة للمعاينة وحدها، ورقةً A4 عرضيّة بعلامة «معاينة»:
   *  تُحفظ PDF من المتصفّح، ولا تُحسب شهادةً صادرة (لا رقم مثبَّت، ولا سجل، ولا بريد). */
  function printPreview() {
    const el = printRef.current;
    if (!el) return;
    // نسخةٌ ثابتة من الورقة في أعلى الصفحة، وكلُّ ما سواها يُخفى عند الطباعة —
    // فتخرج صفحةً واحدة A4 عرضيّة لا تتكرّر ولا تحمل الواجهة معها
    const root = document.createElement("div");
    root.id = "cert-print-root";
    root.innerHTML = el.innerHTML;
    const style = document.createElement("style");
    style.textContent = `
      @page { size: A4 landscape; margin: 0; }
      @media screen { #cert-print-root { display: none; } }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        body > *:not(#cert-print-root) { display: none !important; }
        #cert-print-root { display: block; width: 297mm; height: 210mm; overflow: hidden; }
        #cert-print-root > div { width: 297mm !important; border-radius: 0 !important; }
      }`;
    document.head.appendChild(style);
    document.body.appendChild(root);
    const done = () => {
      root.remove();
      style.remove();
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  function issue() {
    if (!details || !fields) return;
    setIssueError(null);
    startIssue(async () => {
      const res = await issueCertificateAction({
        memberId: details.recipient.id,
        type,
        fields,
        early: needsEarly ? { reason: early.reason, reference: early.reference } : null,
      });
      if (!res.ok) return setIssueError(res.reason);
      setConfirmOpen(false);
      setResult({ number: res.number, id: res.id, delivered: res.delivered, reason: res.reason });
      router.refresh();
    });
  }

  const chip = (k: CertificateType) => (T as Record<string, string>)[TYPE_KEY[k]];
  const firstName = details?.recipient.name.trim().split(/\s+/)[0] ?? "";
  const status = !details
    ? ""
    : details.recipient.stepDownAt
      ? T.closing
      : details.recipient.isActive
        ? gx(gender, T.activeM, T.activeF)
        : T.inactive;

  return (
    <section id="issue" className="flex flex-col gap-3 scroll-mt-20">
      <div>
        <h2 className="text-lg font-bold">{T.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-black/60">
          {fmt(T.lead, (T as Record<string, string>)[`audience_${role}`] ?? "—")}
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* الخطوات */}
        <div className="min-w-0 rounded-2xl border border-hairline bg-white p-4 sm:p-5">
          <Step n="١" title={T.s1} first>
            {details || loading || memberId ? (
              <div className="flex items-center gap-3 rounded-xl border border-black/15 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-white"
                  style={{ background: "#C34900" }}
                >
                  {details?.recipient.initial ?? "…"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{details?.recipient.name ?? T.loading}</p>
                  {details && (
                    <p className="truncate text-xs text-black/55">
                      {[
                        details.recipient.jobTitle,
                        details.recipient.departmentName,
                        status,
                        fmt(gx(gender, T.joinedM, T.joinedF), longDateAr(details.recipient.joinedAt)),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="wizard-btn-2 !min-h-9 !px-3 !text-xs"
                  onClick={() => {
                    setMemberId(null);
                    setDetails(null);
                    setResult(null);
                    setLoadError(null);
                  }}
                >
                  {T.change}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={T.searchRecipient}
                  aria-label={T.searchRecipient}
                  className="min-h-11 rounded-xl border border-black/15 bg-white px-3 text-sm"
                />
                <ul className="flex flex-col divide-y divide-black/5 rounded-xl border border-black/10">
                  {matches.length === 0 && <li className="px-3 py-2.5 text-sm text-black/55">{T.noMatch}</li>}
                  {matches.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => pick(r.id)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-sm hover:bg-black/[0.03]"
                      >
                        <span className="font-bold">{r.name}</span>
                        <span className="text-xs text-black/55">{[r.role, r.dept].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {loadError && <p className="mt-2 text-sm font-bold text-red-700">{loadError}</p>}
          </Step>

          <Step n="٢" title={T.s2}>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={T.s2}>
              {CERTIFICATE_TYPES.map((k) => {
                const on = k === type;
                const why = details?.blocked[k] ?? null;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={why ?? undefined}
                    onClick={() => {
                      setType(k);
                      setResult(null);
                      setIssueError(null);
                    }}
                    className={`rounded-full border px-3.5 py-1.5 text-sm ${
                      on ? "border-transparent font-bold btn-brand" : "border-black/20"
                    } ${why && !on ? "opacity-50" : ""}`}
                  >
                    {chip(k)}
                  </button>
                );
              })}
            </div>
            {blocked && <p className="mt-2 text-sm font-bold text-amber-800">{blocked}</p>}
          </Step>

          <Step n="٣" title={T.s3}>
            <div className="grid grid-cols-2 gap-2.5">
              {(["classic", "editorial"] as const).map((tpl) => {
                const on = TYPE_INFO[type].template === tpl;
                return (
                  <div
                    key={tpl}
                    aria-current={on ? "true" : undefined}
                    className={`rounded-xl p-1.5 text-center text-xs ${
                      on ? "border-2 border-[#C34900] font-bold" : "border border-hairline text-black/55 opacity-60"
                    }`}
                  >
                    <TemplateThumb kind={tpl} color={details?.recipient.colorHex ?? "#341D2B"} />
                    <span className="mt-1 block">{tpl === "classic" ? T.tplClassic : T.tplEditorial}</span>
                    <small className="block font-normal text-black/55">
                      {tpl === "classic" ? T.tplClassicTypes : T.tplEditorialTypes}
                    </small>
                  </div>
                );
              })}
            </div>
          </Step>

          <Step n="٤" title={T.s4}>
            {!details || !fields ? (
              <p className="text-sm text-black/55">{T.pickFirst}</p>
            ) : (
              <>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {FIELD_SPECS[type].map((spec) => {
                    const value = String(fields[spec.key] ?? "");
                    const edit = edits.find((e) => e.key === spec.key);
                    const id = `cert-${type}-${spec.key}`;
                    return (
                      <div key={spec.key} className={spec.input === "textarea" ? "sm:col-span-2" : ""}>
                        <label htmlFor={id} className="mb-1 block text-xs text-black/55">
                          {spec.label}
                          {spec.required ? " *" : ""}
                        </label>
                        {spec.input === "textarea" ? (
                          <textarea
                            id={id}
                            value={value}
                            maxLength={400}
                            onChange={(e) => setField(spec.key, e.target.value)}
                            className="min-h-20 w-full resize-y rounded-xl border border-black/20 bg-white px-3 py-2 text-sm leading-relaxed"
                          />
                        ) : (
                          <input
                            id={id}
                            type={spec.input === "date" ? "date" : "text"}
                            value={value}
                            maxLength={120}
                            onChange={(e) => setField(spec.key, e.target.value)}
                            className="min-h-11 w-full rounded-xl border border-black/20 bg-white px-3 text-sm"
                          />
                        )}
                        {edit && (
                          <p className="mt-1 text-[11px] font-semibold text-[#C34900]">
                            {spec.key === "duration" && details.actual[type]
                              ? fmt(T.editedDuration, details.actual[type]!)
                              : T.edited}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <div>
                    <span className="mb-1 block text-xs text-black/55">{T.number}</span>
                    <div className="flex min-h-11 items-center rounded-xl border border-black/10 bg-black/[0.02] px-3 text-sm">
                      <bdi dir="ltr">{details.nextNumbers[type]}</bdi>
                    </div>
                    <p className="mt-1 text-[11px] text-black/50">{T.numberHint}</p>
                  </div>
                </div>
                {edits.length > 0 && (
                  <button type="button" onClick={resetFields} className="mt-2 text-xs font-bold underline underline-offset-2">
                    {T.resetFields}
                  </button>
                )}
              </>
            )}
          </Step>

          <Step n="٥" title={T.s5}>
            {!signers ? (
              <p className="text-sm text-black/55">{T.pickFirst}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {signers.pair.map((s) => (
                  <li key={s.seat} className="flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2.5 text-sm">
                    <span>
                      {s.title}
                      {s.name !== "—" ? <span className="text-black/55"> ({s.name})</span> : null} —{" "}
                      <b>{s.signatureId ? T.sigApproved : T.sigMissing}</b>
                    </span>
                    {s.signatureId ? (
                      <span className="shrink-0 text-xs font-bold text-green-800">{T.sigOk}</span>
                    ) : (
                      <span className="shrink-0 text-xs font-bold text-amber-800">{T.sigMissingNote}</span>
                    )}
                  </li>
                ))}
                {signers.superseded.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2.5 text-sm line-through opacity-50"
                  >
                    <span>
                      {s.title} ({s.name}) — {T.sigVoid}
                    </span>
                    <span className="shrink-0 text-xs font-bold text-red-800">{T.sigVoidNote}</span>
                  </li>
                ))}
              </ul>
            )}
          </Step>

          <Step n="٦" title={T.s6}>
            {!isAppreciation ? (
              <p className="text-sm text-black/55">{T.earlyNA}</p>
            ) : !details ? (
              <p className="text-sm text-black/55">{T.pickFirst}</p>
            ) : !needsEarly ? (
              <p className="text-sm text-black/55">{T.earlyNotNeeded}</p>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2.5 font-bold">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={early.on}
                    onChange={(e) => setEarly((x) => ({ ...x, on: e.target.checked }))}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 ${
                      early.on ? "bg-[#C34900]" : "bg-black/20"
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all ${
                        early.on ? "start-[23px]" : "start-[3px]"
                      }`}
                    />
                  </span>
                  {T.earlyToggle}
                </label>
                <p className="mt-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
                  {fmt(T.earlyBox, durationBetween(details.facts.assignmentStart.slice(0, 10), todayIso()))}
                </p>
                {early.on && (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="early-reason" className="mb-1 block text-xs text-black/55">
                        {T.earlyReason} *
                      </label>
                      <textarea
                        id="early-reason"
                        value={early.reason}
                        maxLength={300}
                        placeholder={T.earlyReasonPh}
                        onChange={(e) => setEarly((x) => ({ ...x, reason: e.target.value }))}
                        className="min-h-16 w-full resize-y rounded-xl border border-black/25 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="early-ref" className="mb-1 block text-xs text-black/55">
                        {T.earlyReference} *
                      </label>
                      <input
                        id="early-ref"
                        value={early.reference}
                        maxLength={120}
                        placeholder={T.earlyReferencePh}
                        onChange={(e) => setEarly((x) => ({ ...x, reference: e.target.value }))}
                        className="min-h-11 w-full rounded-xl border border-black/25 bg-white px-3 text-sm"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </Step>
        </div>

        {/* المعاينة قبل الإرسال */}
        <div className="min-w-0 rounded-2xl border border-hairline bg-white p-4 sm:p-5 lg:sticky lg:top-4">
          <h3 className="mb-2.5 text-[15px] font-bold">{T.previewTitle}</h3>
          {view ? (
            <div ref={printRef} className="overflow-hidden rounded-xl border border-hairline">
              <CertificateFrameBox rounded={false}>
                <CertificateSheet view={view} watermark={T.watermark} />
              </CertificateFrameBox>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-black/15 px-3 py-10 text-center text-sm text-black/50">
              {loading ? T.loading : T.pickFirst}
            </p>
          )}

          {details && fields && !result && (
            <ul className="mt-3.5 flex flex-col divide-y divide-hairline text-[13px] leading-relaxed">
              {blocked || duplicate ? (
                <Check tone="bad">{blocked ?? T.cDup}</Check>
              ) : (
                <Check tone="ok">{fmt(T.cNoDup, chip(type), firstName)}</Check>
              )}
              {isAppreciation &&
                (needsEarly ? <Check tone="warn">{earlyIncomplete ? T.earlyRequired : T.cEarly}</Check> : <Check tone="ok">{T.cOnTime}</Check>)}
              {missingSig.length === 0 ? (
                <Check tone="ok">{T.cSigOk}</Check>
              ) : (
                <Check tone="warn">{fmt(T.cSigMissing, missingSig.map((s) => s.title).join("، "))}</Check>
              )}
              {edits.length > 0 && <Check tone="warn">{fmt(T.cEdits, edits.map((e) => e.field).join("، "))}</Check>}
              {missing.length > 0 && <Check tone="bad">{fmt(T.cMissing, missing.join("، "))}</Check>}
              <Check tone="ok">
                {fmt(T.cEmail, "⁨" + details.recipient.emailMasked + "⁩")}
              </Check>
            </ul>
          )}

          {result ? (
            <div role="status" className="mt-4 rounded-xl border border-hairline px-3 py-3 text-sm">
              <p className={`font-bold ${result.delivered ? "text-green-800" : "text-amber-800"}`}>
                {fmt(result.delivered ? T.doneTitle : T.doneUndelivered, result.number)}
              </p>
              <button
                type="button"
                className="wizard-btn-2 mt-2.5 !min-h-9 !px-3 !text-xs"
                onClick={() => {
                  setResult(null);
                  setMemberId(null);
                  setDetails(null);
                  setQuery("");
                }}
              >
                {T.another}
              </button>
            </div>
          ) : (
            <div className="mt-4 flex gap-2.5">
              <button type="button" className="wizard-btn-2 !min-h-11" onClick={printPreview} disabled={!view}>
                {T.pdf}
              </button>
              <button
                type="button"
                className="btn-brand min-h-11 flex-1 rounded-xl px-4 font-bold disabled:opacity-45"
                disabled={!canIssue}
                onClick={() => {
                  setIssueError(null);
                  setConfirmOpen(true);
                }}
              >
                {T.issue}
              </button>
            </div>
          )}
          {issueError && !confirmOpen && <p className="mt-2 text-sm font-bold text-red-700">{issueError}</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="brand"
        title={fmt(T.confirmTitle, chip(type))}
        body={details ? fmt(T.confirmBody, chip(type), details.recipient.name) : undefined}
        confirmLabel={T.issue}
        pending={issuing}
        error={issueError}
        onConfirm={issue}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}

/** اليومُ بتقويم المنظمة — كما يقيسه الخادم */
function todayIso() {
  const c = orgCalendarDate(new Date());
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

function Step({ n, title, first, children }: { n: string; title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? "pb-4" : "border-t border-hairline py-4 last:pb-0"}>
      <h3 className="mb-2.5 flex items-center gap-2 text-[15px] font-bold">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs"
          style={{ background: "#341D2B", color: "#EEF6DF" }}
        >
          {n}
        </span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Check({ tone, children }: { tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const bg = tone === "ok" ? "#2F7A52" : tone === "warn" ? "#C34900" : "#9A2E1C";
  return (
    <li className="flex gap-2 py-2 first:pt-0">
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs text-white"
        style={{ background: bg }}
      >
        {tone === "ok" ? "✓" : tone === "warn" ? "!" : "×"}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** مصغّرُ القالب — رسمٌ تخطيطيّ لا صورة: الإطارُ المزدوج، أو الشريطُ الداكن بخطّه */
function TemplateThumb({ kind, color }: { kind: "classic" | "editorial"; color: string }) {
  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-md bg-[#FFFDF9]" style={{ aspectRatio: "1123 / 794" }}>
      {kind === "classic" ? (
        <>
          <span className="absolute inset-[6%] rounded-sm border-[3px]" style={{ borderColor: color }} />
          <span className="absolute left-1/2 top-[30%] h-[6%] w-[34%] -translate-x-1/2 rounded bg-[#341D2B]/25" />
          <span className="absolute left-1/2 top-[45%] h-[10%] w-[50%] -translate-x-1/2 rounded bg-[#341D2B]/60" />
          <span className="absolute left-1/2 top-[62%] h-[4%] w-[60%] -translate-x-1/2 rounded bg-[#341D2B]/20" />
          <span className="absolute bottom-[14%] left-1/2 h-[14%] w-[10%] -translate-x-1/2 rounded-full" style={{ background: color }} />
        </>
      ) : (
        <>
          <span className="absolute inset-x-0 top-0 h-[22%] bg-[#341D2B]" />
          <span className="absolute inset-x-0 top-[22%] h-[1.5%] bg-[#C34900]" />
          <span className="absolute right-[8%] top-[34%] h-[7%] w-[34%] rounded bg-[#341D2B]/50" />
          <span className="absolute right-[8%] top-[48%] h-[10%] w-[52%] rounded bg-[#341D2B]/70" />
          <span className="absolute right-[8%] top-[62%] h-[5%] w-[40%] rounded bg-[#C34900]/70" />
          <span className="absolute inset-x-[8%] top-[72%] h-[1%] bg-[#341D2B]" />
        </>
      )}
    </div>
  );
}
