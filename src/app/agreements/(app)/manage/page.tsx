import Link from "next/link";
import { redirect } from "next/navigation";
import type { AgreementKind } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { agreementContext, agreementsRoster, personRecord, parseSubject, AGREEMENT_STATUS_LABEL, type AgreementStatus } from "@/lib/governance/agreements";
import { AGREEMENT_KIND_LABEL, AGREEMENT_ASSETS, DEFAULT_AGREEMENTS, LAWYER_REVIEW_FLAG } from "@/lib/governance/agreementTexts";
import { ActionForm } from "@/app/committees/_components/ActionForm";
import { Chip, Field, inputCls, textareaCls, fmtWhen } from "@/app/committees/_components/bits";
import {
  draftFromDefaultAction,
  saveDraftAction,
  publishAction,
  requestSignatureAction,
  cancelRequirementAction,
  grantAssetAction,
  revokeAssetAction,
  reportIncidentAction,
  reviewIncidentAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const KINDS: AgreementKind[] = ["marketing", "technical"];
const TONE: Record<AgreementStatus, "ok" | "warn" | "neutral" | "danger"> = { signed: "ok", pending: "warn", needs_update: "warn", not_sent: "neutral", ended: "neutral", cancelled: "danger" };
const INCIDENT_LABEL: Record<string, string> = { reported: "مُبلَّغ", under_review: "قيد المراجعة البشرية", closed: "مغلق" };

/** **إدارةُ الاتفاقيات** — الإصداراتُ ونشرُها، ومن وقّع ومن لم يوقّع بحالاته، وطلبُ التوقيع وإعادتُه، ومنحُ الأصول
 *  وسحبُها، وبلاغاتُ الإخلال بمراجعةٍ بشرية، وسجلُّ كل شخص. الاطّلاعُ لمن له «الاتفاقيات (اطّلاع)»، والإجراءاتُ لمن له
 *  «الاتفاقيات (إدارة)» — والخادمُ يفحص ذلك ثانيةً في كل إجراء. */
export default async function ManageAgreementsPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fagreements%2Fmanage");
  const ctx = await agreementContext(session);
  if (!ctx.canView) redirect("/agreements");
  const sp = await searchParams;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const [templates, roster, grants, incidents, events] = await Promise.all([
    prisma.agreementTemplate.findMany({ orderBy: [{ kind: "asc" }, { version: "desc" }], include: { _count: { select: { signatures: true } } } }),
    agreementsRoster(),
    prisma.assetAccessGrant.findMany({ orderBy: { grantedAt: "desc" }, take: 200 }),
    prisma.agreementIncident.findMany({ orderBy: { reportedAt: "desc" }, take: 100 }),
    prisma.orgAuditEvent.findMany({ where: { scope: "agreement" }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const subject = sp.person ? parseSubject(sp.person) : null;
  const person = subject ? await personRecord(subject) : null;
  const personName = person ? roster.find((r) => r.key === sp.person)?.name ?? person.signatures[0]?.signerAccountName ?? "—" : null;
  const M = ctx.canManage;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="إدارة الاتفاقيات"
        description="اتفاقية قادة وفريق التسويق، واتفاقية الفريق التقني: الإصدارات، والتوقيعات، والوصول المرتبط بها، والبلاغات — وكلُّ إجراءٍ في سجل الحوكمة."
        back={<Link href="/agreements" className="mb-2 inline-flex text-xs font-bold text-black/55 hover:underline">← اتفاقياتي</Link>}
      />
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">{LAWYER_REVIEW_FLAG}</p>

      {/* ── الإصدارات */}
      <section className="grid gap-4 lg:grid-cols-2">
        {KINDS.map((k) => {
          const list = templates.filter((t) => t.kind === k);
          const active = list.find((t) => t.status === "active");
          const draft = list.find((t) => t.status === "draft");
          return (
            <Card key={k} className="flex flex-col gap-3 p-5">
              <h2 className="text-base font-bold">{AGREEMENT_KIND_LABEL[k]}</h2>
              {active ? (
                <div className="text-sm">
                  <p>
                    الإصدار السارى: <b>{active.version}</b> — {active.titleAr}
                  </p>
                  <p className="text-xs text-black/55">
                    نشره {active.publishedByName} · {fmtWhen(active.publishedAt)} · {active._count.signatures} توقيعاً
                  </p>
                  <p dir="ltr" className="break-all text-[11px] text-black/45">SHA-256: {active.bodyHash}</p>
                  {active.changeNote && <p className="text-xs text-black/60">ما تغيّر: {active.changeNote}</p>}
                  <Link href={`/agreements/${k}`} className="text-xs font-semibold underline">قراءة النص</Link>
                </div>
              ) : (
                <p className="text-sm text-black/60">لا إصدارَ سارياً — لا بوابةَ توقيعٍ على الوصول حتى يُنشر إصدار.</p>
              )}
              {M && !draft && (
                <ActionForm action={draftFromDefaultAction} theme={theme} compact pendingLabel="يُنشأ…" submits={[{ label: active ? "إصدارٌ جديد (مسودّة من النص المقترح)" : "إنشاء مسودّة من النص المقترح", variant: "outline" }]}>
                  <input type="hidden" name="kind" value={k} />
                  <p className="text-xs text-black/55">النص المقترح: {DEFAULT_AGREEMENTS[k].clauses} بنداً — يُعدَّل قبل النشر.</p>
                </ActionForm>
              )}
              {M && draft && (
                <details className="rounded-xl border border-hairline p-3" open={!active}>
                  <summary className="cursor-pointer text-sm font-semibold">مسودّة الإصدار {draft.version} — تعديل ونشر</summary>
                  <div className="mt-3 flex flex-col gap-4">
                    <ActionForm action={saveDraftAction} theme={theme} pendingLabel="يُحفظ…" submits={[{ label: "حفظ المسودّة", variant: "outline" }]}>
                      <input type="hidden" name="templateId" value={draft.id} />
                      <Field label="العنوان" required>
                        <input name="titleAr" required defaultValue={draft.titleAr} className={inputCls} />
                      </Field>
                      <Field label="العنوان بالإنجليزية">
                        <input name="titleEn" dir="ltr" defaultValue={draft.titleEn ?? ""} className={inputCls} />
                      </Field>
                      <Field label="النص" required>
                        <textarea name="body" required defaultValue={draft.body} className={`${textareaCls} min-h-96`} />
                      </Field>
                      <Field label="ما تغيّر">
                        <input name="changeNote" defaultValue={draft.changeNote ?? ""} className={inputCls} />
                      </Field>
                    </ActionForm>
                    <ActionForm
                      action={publishAction}
                      theme={theme}
                      pendingLabel="يُنشر…"
                      submits={[{ label: "نشر الإصدار" }]}
                      confirm={{ title: "نشر الإصدار", body: "يُجمَّد النصُّ وبصمتُه، ويتقاعد السارى. ومن وقّع السابق يصير «يحتاج تحديثاً» ولا يدخل الوصولَ الحساس حتى يوقّع الجديد.", confirmLabel: "نشر" }}
                    >
                      <input type="hidden" name="templateId" value={draft.id} />
                      <Field label="ملاحظة النشر (ما تغيّر ولماذا)" required>
                        <input name="note" required minLength={3} className={inputCls} />
                      </Field>
                    </ActionForm>
                  </div>
                </details>
              )}
              {list.filter((t) => t.status === "retired").length > 0 && (
                <p className="text-xs text-black/50">
                  إصداراتٌ سابقة محفوظة: {list.filter((t) => t.status === "retired").map((t) => `${t.version} (${t._count.signatures} توقيعاً)`).join("، ")}
                </p>
              )}
            </Card>
          );
        })}
      </section>

      {/* ── الأشخاص وحالاتهم */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-black/70">من وقّع ومن لم يوقّع ({roster.length})</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-black/55">
                <th className="p-3 text-start">الشخص</th>
                {KINDS.map((k) => <th key={k} className="p-3 text-start">{AGREEMENT_KIND_LABEL[k]}</th>)}
                <th className="p-3 text-start">السجل</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.key} className="border-b border-hairline align-top">
                  <td className="p-3">
                    <b>{r.name}</b>
                    <span dir="ltr" className="block text-xs text-black/50">{r.email}</span>
                  </td>
                  {KINDS.map((k) => {
                    const st = r[k];
                    const req = r.requirements.find((q) => q.kind === k && !q.cancelledAt && !q.endedAt);
                    return (
                      <td key={k} className="p-3">
                        <Chip tone={TONE[st.status]}>{AGREEMENT_STATUS_LABEL[st.status]}</Chip>
                        {st.signedVersion && <span className="ms-1 text-xs text-black/50">(وقّع {st.signedVersion})</span>}
                        {M && st.status !== "signed" && st.activeVersion && (
                          <ActionForm action={requestSignatureAction} theme={theme} compact className="mt-2 flex flex-col gap-1" pendingLabel="يُرسل…" submits={[{ label: st.status === "needs_update" ? "طلب إعادة التوقيع" : st.status === "pending" ? "تذكير" : "طلب التوقيع", variant: "outline" }]}>
                            <input type="hidden" name="kind" value={k} />
                            <input type="hidden" name="subject" value={r.key} />
                          </ActionForm>
                        )}
                        {M && req && st.status !== "signed" && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] text-red-700">إلغاء الطلب</summary>
                            <ActionForm action={cancelRequirementAction} theme={theme} compact className="mt-1 flex flex-col gap-1" pendingLabel="…" submits={[{ label: "إلغاء", variant: "outline" }]}>
                              <input type="hidden" name="requirementId" value={req.id} />
                              <input name="reason" required minLength={3} placeholder="السبب" aria-label="سبب الإلغاء" className={inputCls} />
                            </ActionForm>
                          </details>
                        )}
                      </td>
                    );
                  })}
                  <td className="p-3">
                    <Link href={`/agreements/manage?person=${encodeURIComponent(r.key)}`} className="text-xs font-semibold underline">سجلّ المساءلة</Link>
                  </td>
                </tr>
              ))}
              {!roster.length && (
                <tr><td colSpan={4} className="p-4 text-center text-sm text-black/55">لا طلباتِ توقيعٍ ولا توقيعاتٍ بعد.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
        {M && (
          <Card className="p-4">
            <ActionForm action={requestSignatureAction} theme={theme} className="grid gap-2 sm:grid-cols-4" pendingLabel="يُرسل…" submits={[{ label: "طلب التوقيع" }]}>
              <input name="email" type="email" required dir="ltr" placeholder="بريد الحساب" aria-label="بريد الحساب" className={inputCls} />
              <select name="kind" required aria-label="الاتفاقية" className={inputCls}>
                {KINDS.map((k) => <option key={k} value={k}>{AGREEMENT_KIND_LABEL[k]}</option>)}
              </select>
              <input name="reason" placeholder="السبب (اختياري)" aria-label="السبب" className={`${inputCls} sm:col-span-2`} />
            </ActionForm>
          </Card>
        )}
      </section>

      {/* ── سجلُّ المساءلة لشخص */}
      {person && (
        <Card className="flex flex-col gap-3 p-5" id="person">
          <h2 className="text-base font-bold">سجلّ المساءلة — {personName}</h2>
          <p className="text-sm">
            {KINDS.map((k) => `${AGREEMENT_KIND_LABEL[k]}: ${AGREEMENT_STATUS_LABEL[person.statuses[k].status]}`).join(" · ")}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-black/55">التوقيعات</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {person.signatures.map((s) => (
                  <li key={s.id}>
                    {AGREEMENT_KIND_LABEL[s.kind]} — الإصدار {s.version} · {fmtWhen(s.signedAt)} ·{" "}
                    <Link href={`/agreements/signed/${s.id}`} className="underline">النسخة</Link>
                  </li>
                ))}
                {!person.signatures.length && <li className="text-black/50">لا توقيعات.</li>}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-black/55">الوصول الممنوح</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {person.grants.map((g) => (
                  <li key={g.id}>
                    {g.assetLabel} — {g.revokedAt ? `سُحب ${fmtWhen(g.revokedAt)} (${g.revokeReason})` : `منذ ${fmtWhen(g.grantedAt)}`}
                  </li>
                ))}
                {!person.grants.length && <li className="text-black/50">لا وصول ممنوح.</li>}
              </ul>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-black/55">البلاغات</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {person.incidents.map((i) => <li key={i.id}>{INCIDENT_LABEL[i.status]} — {i.description.slice(0, 160)}</li>)}
              {!person.incidents.length && <li className="text-black/50">لا بلاغات.</li>}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-black/55">الأحداث</p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-black/70">
              {person.events.map((e) => <li key={e.id}>{fmtWhen(e.createdAt)} — {e.actorName}: {e.action}{e.result === "denied" ? " (مرفوضة)" : ""}{e.note ? ` — ${e.note}` : ""}</li>)}
            </ul>
          </div>
        </Card>
      )}

      {/* ── الأصول */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-black/70">الوصول إلى الأصول (يُمنح بعد التوقيع وحده)</h2>
        {M && (
          <Card className="p-4">
            <ActionForm action={grantAssetAction} theme={theme} className="grid gap-2 sm:grid-cols-4" pendingLabel="يُمنح…" submits={[{ label: "منح الوصول" }]}>
              <input name="email" type="email" required dir="ltr" placeholder="بريد الحساب" aria-label="بريد الحساب" className={inputCls} />
              <select name="kind" required aria-label="الفئة" className={inputCls}>
                {KINDS.map((k) => <option key={k} value={k}>{AGREEMENT_KIND_LABEL[k]}</option>)}
              </select>
              <select name="asset" required aria-label="الأصل" className={`${inputCls} sm:col-span-2`}>
                {KINDS.flatMap((k) => AGREEMENT_ASSETS[k].map((a) => <option key={`${k}:${a.key}`} value={a.key}>{AGREEMENT_KIND_LABEL[k]} — {a.label}</option>))}
              </select>
            </ActionForm>
            <p className="mt-2 text-xs text-black/55">
              المنصةُ تسجّل المنحَ وتمنعه قبل التوقيع؛ أما الوصولُ الفعليُّ في الأنظمة الخارجية (المستودع، الخوادم، حسابات التواصل) فيُمنح ويُسحب يدوياً من تلك الأنظمة وفق هذا السجل.
            </p>
          </Card>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-white p-3">
              <b>{g.holderName}</b> — {g.assetLabel}
              <span className="text-xs text-black/50">منحه {g.grantedByName} · {fmtWhen(g.grantedAt)}</span>
              {g.revokedAt ? (
                <Chip tone="neutral">سُحب: {g.revokeReason}</Chip>
              ) : (
                M && (
                  <ActionForm action={revokeAssetAction} theme={theme} compact className="ms-auto flex gap-1" pendingLabel="…" submits={[{ label: "سحب", variant: "outline" }]}>
                    <input type="hidden" name="grantId" value={g.id} />
                    <input name="reason" required minLength={3} placeholder="السبب" aria-label="سبب السحب" className={inputCls} />
                  </ActionForm>
                )
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── البلاغات */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-black/70">بلاغات الإخلال — مراجعةٌ بشرية، لا حكمَ آلي</h2>
        <Card className="p-4">
          <ActionForm action={reportIncidentAction} theme={theme} className="grid gap-2 sm:grid-cols-2" pendingLabel="يُسجَّل…" submits={[{ label: "تسجيل بلاغ", variant: "outline" }]}>
            <input name="email" type="email" required dir="ltr" placeholder="بريد الشخص المعنيّ" aria-label="بريد الشخص" className={inputCls} />
            <select name="kind" required aria-label="الاتفاقية" className={inputCls}>
              {KINDS.map((k) => <option key={k} value={k}>{AGREEMENT_KIND_LABEL[k]}</option>)}
            </select>
            <textarea name="description" required minLength={10} placeholder="ما الذي حدث؟" aria-label="الوصف" className={`${textareaCls} sm:col-span-2`} />
            <input name="evidence" placeholder="الأدلة أو الروابط (اختياري)" aria-label="الأدلة" className={`${inputCls} sm:col-span-2`} />
          </ActionForm>
        </Card>
        <ul className="flex flex-col gap-2 text-sm">
          {incidents.map((i) => (
            <li key={i.id} className="rounded-xl border border-hairline bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b>{i.subjectName}</b> — {AGREEMENT_KIND_LABEL[i.kind]}
                <Chip tone={i.status === "closed" ? "neutral" : "warn"}>{INCIDENT_LABEL[i.status]}</Chip>
                <span className="text-xs text-black/50">أبلغ {i.reportedByName} · {fmtWhen(i.reportedAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-line">{i.description}</p>
              {i.reviewNote && <p className="mt-1 text-xs text-black/60">المراجعة ({i.reviewedByName}): {i.reviewNote}{i.outcome ? ` — النتيجة: ${i.outcome}` : ""}</p>}
              {M && i.status !== "closed" && (
                <ActionForm action={reviewIncidentAction} theme={theme} compact className="mt-2 grid gap-1 sm:grid-cols-3" pendingLabel="…" submits={[...(i.status === "reported" ? [{ label: "بدء المراجعة", name: "to", value: "under_review", variant: "outline" as const }] : []), { label: "إغلاق بنتيجة", name: "to", value: "closed", variant: "outline" }]}>
                  <input type="hidden" name="incidentId" value={i.id} />
                  <input name="note" required minLength={5} placeholder="ملاحظة المراجعة" aria-label="ملاحظة المراجعة" className={inputCls} />
                  <input name="outcome" placeholder="النتيجة (عند الإغلاق)" aria-label="النتيجة" className={inputCls} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── السجل */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-black/70">آخر عمليات الاتفاقيات</h2>
        <ul className="flex flex-col gap-1 text-xs text-black/70">
          {events.map((e) => (
            <li key={e.id}>
              {fmtWhen(e.createdAt)} — {e.actorName}: {e.action}
              {e.result === "denied" ? " (مرفوضة)" : ""}
              {e.note ? ` — ${e.note}` : ""}
            </li>
          ))}
        </ul>
        <Link href="/senior/log?scope=agreement" className="text-xs font-semibold underline">السجل الكامل في سجل الحوكمة</Link>
      </section>
    </div>
  );
}
