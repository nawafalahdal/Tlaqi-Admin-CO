import type { Dictionary } from "@/i18n";
import { prisma } from "@/lib/prisma";
import type { MkActor } from "@/lib/marketing/access";
import { campaignCalendar, recommendPublishHour, CONTENT_TYPES, PUBLISH_BASES } from "@/lib/marketing/schedule";
import { fmt } from "@/i18n/fmt";
import { ActionForm } from "../../_components/ActionForm";
import { Pill, Section, Field, inputCls, nameOf, when, dateInput, dateTimeInput, Muted, deliverableTone } from "../../_components/bits";

type Mk = Dictionary["mk"];

/** تقويمُ النشر: كلُّ قطعةٍ بمواعيدها الأربعة بالدقيقة وبتوقيت الرياض، ومسؤوليها، وما يُرصد عليها.
 *
 *  - **قبل الاعتماد** يعدّلها المنسّق بحرّية (ويُبطل ذلك الخطةَ المقدَّمة).
 *  - **تحت التنفيذ** يعدّل قائدُ التسويق وحده المواعيدَ والمسؤولين، بسببٍ مكتوبٍ يُسجَّل بأصله وجديده؛
 *    والنطاقُ لا يُعرض للتعديل — كما في الخادم (`updatePieceSchedule`).
 *  - **التوصيةُ بوقت النشر** تُعرض بأساسها: من نتائج سابقة إن كفت، وإلا «تقدير» صريح. */
export async function CalendarTab({ mk, actor, campaignId }: { mk: Mk; actor: MkActor; campaignId: string }) {
  const L = mk.calendar;
  const cal = await campaignCalendar(actor, campaignId);
  if (!cal) return <Muted>{mk.errors.not_found}</Muted>;
  const canEdit = cal.editable || cal.amendable;
  const team = canEdit
    ? await prisma.marketingCampaignMember.findMany({
        where: { campaignId, role: { in: ["writer", "designer"] }, member: { active: true } },
        select: { role: true, memberId: true, member: { select: { user: { select: { fullName: true } }, member: { select: { fullName: true } }, nameSnapshot: true } } },
      })
    : [];
  const platforms = [...new Set(cal.rows.map((r) => r.platform))];
  const recs = new Map(canEdit ? await Promise.all(platforms.map(async (p) => [p, await recommendPublishHour(p)] as const)) : []);
  const people = (role: "writer" | "designer") => team.filter((t) => t.role === role);
  const field = (f: string) => (L.fieldsMap as Record<string, string>)[f] ?? f;
  const show = (f: string, v: string | null) => {
    if (!v) return L.none;
    if (f.endsWith("At") || f === "startDate" || f === "deadline") return when(v);
    return v;
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title={L.title} hint={L.hint}>
        <p className="mb-3 flex flex-wrap gap-x-4 text-xs text-black/60">
          <span>{L.campaignDates}: {when(cal.campaign.startDate, false)} — {when(cal.campaign.deadline, false)}</span>
          <span dir="ltr">{cal.campaign.timezone}</span>
        </p>
        {cal.editable && <p className="mb-3 text-xs text-black/55">{L.planningHint}</p>}
        {cal.amendable && <p className="mb-3 text-xs text-black/55">{L.amendHint}</p>}
        {!canEdit && <p className="mb-3 text-xs text-black/55">{L.lockedHint}</p>}
        {cal.amendable && (
          <details className="mb-4 rounded-xl border border-black/[0.08] p-3">
            <summary className="cursor-pointer text-sm font-bold">{L.campaignDates}</summary>
            <div className="mt-3">
              <ActionForm op="campaign.dates" submit={L.save}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={L.start}>
                    <input type="date" name="startDate" defaultValue={dateInput(cal.campaign.startDate)} className={inputCls} />
                  </Field>
                  <Field label={L.end}>
                    <input type="date" name="deadline" required defaultValue={dateInput(cal.campaign.deadline)} className={inputCls} />
                  </Field>
                </div>
                <Field label={L.reason}>
                  <input name="reason" required minLength={5} maxLength={500} className={inputCls} />
                </Field>
              </ActionForm>
            </div>
          </details>
        )}
        {cal.rows.length === 0 ? (
          <Muted>{L.empty}</Muted>
        ) : (
          <ol className="flex flex-col gap-3">
            {cal.rows.map((r) => {
              const rec = recs.get(r.platform);
              return (
                <li key={r.id} className="rounded-xl border border-black/[0.08] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold" dir="auto">{r.title}</span>
                    <Pill tone={deliverableTone(r.status)}>{mk.deliverableStatus[r.status]}</Pill>
                    <span className="text-xs text-black/55" dir="ltr">{r.platform}</span>
                    {r.contentType && <span className="text-xs text-black/55">{(L.contentTypes as Record<string, string>)[r.contentType] ?? r.contentType}</span>}
                    {r.issues.map((i) => (
                      <Pill key={i} tone="bad">{L.issuesMap[i]}</Pill>
                    ))}
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    {([["contentDue", r.contentDueAt], ["designDue", r.designDueAt], ["reviewDue", r.reviewDueAt], ["publishAt", r.publishAt]] as const).map(([k, v]) => (
                      <div key={k}>
                        <dt className="font-bold text-black/55">{L[k]}</dt>
                        <dd>{when(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-black/60">
                    <span>{L.writer}: {r.writer ? nameOf(r.writer) : L.none}</span>
                    <span>{L.designer}: {r.designer ? nameOf(r.designer) : L.none}</span>
                    {r.publishBasis && <span>{L.basis}: {(L.basisMap as Record<string, string>)[r.publishBasis] ?? r.publishBasis}</span>}
                    {r.topic && <span dir="auto">{L.topic}: {r.topic}</span>}
                  </p>
                  {canEdit && r.status !== "published" && (
                    <details className="mt-3 border-t border-black/5 pt-2">
                      <summary className="cursor-pointer text-sm font-bold">{cal.editable ? L.edit : L.amend}</summary>
                      <div className="mt-3">
                        <ActionForm op="piece.schedule" submit={L.save}>
                          <input type="hidden" name="deliverableId" value={r.id} />
                          {cal.editable && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label={L.type}>
                                <select name="contentType" defaultValue={r.contentType ?? ""} className={inputCls}>
                                  <option value="">{L.none}</option>
                                  {CONTENT_TYPES.map((t) => (
                                    <option key={t} value={t}>{L.contentTypes[t]}</option>
                                  ))}
                                </select>
                              </Field>
                              <Field label={L.topic}>
                                <input name="topic" maxLength={300} defaultValue={r.topic ?? ""} className={inputCls} dir="auto" />
                              </Field>
                              <Field label={L.message} className="sm:col-span-2">
                                <input name="message" maxLength={1000} defaultValue={r.message ?? ""} className={inputCls} dir="auto" />
                              </Field>
                              <Field label={L.cta}>
                                <input name="cta" maxLength={200} defaultValue={r.cta ?? ""} className={inputCls} dir="auto" />
                              </Field>
                              <Field label={L.kpi}>
                                <input name="kpi" maxLength={300} defaultValue={r.kpi ?? ""} className={inputCls} dir="auto" />
                              </Field>
                            </div>
                          )}
                          <div className="grid gap-3 sm:grid-cols-2">
                            {(["writer", "designer"] as const).map((role) => (
                              <Field key={role} label={L[role]}>
                                <select name={`${role}Id`} defaultValue={(role === "writer" ? r.writerId : r.designerId) ?? ""} className={inputCls}>
                                  <option value="">{L.none}</option>
                                  {people(role).map((p) => (
                                    <option key={p.memberId} value={p.memberId}>{nameOf(p.member)}</option>
                                  ))}
                                </select>
                              </Field>
                            ))}
                            {([["contentDueAt", "contentDue", r.contentDueAt], ["designDueAt", "designDue", r.designDueAt], ["reviewDueAt", "reviewDue", r.reviewDueAt], ["publishAt", "publishAt", r.publishAt]] as const).map(([name, k, v]) => (
                              <Field key={name} label={`${L[k]} · ${L.timezoneNote}`}>
                                <input type="datetime-local" name={name} defaultValue={dateTimeInput(v)} className={inputCls} />
                              </Field>
                            ))}
                            <Field label={L.basis} hint={rec ? (rec.basis === "history" ? fmt(L.recommendHistory, rec.samples, rec.hour) : fmt(L.recommendEstimate, rec.hour)) : undefined}>
                              <select name="publishBasis" defaultValue={r.publishBasis ?? ""} className={inputCls}>
                                <option value="">{L.none}</option>
                                {PUBLISH_BASES.map((b) => (
                                  <option key={b} value={b}>{L.basisMap[b]}</option>
                                ))}
                              </select>
                            </Field>
                            {cal.editable && (
                              <Field label={L.basisNote}>
                                <input name="publishBasisNote" maxLength={300} defaultValue={r.publishBasisNote ?? ""} className={inputCls} dir="auto" />
                              </Field>
                            )}
                          </div>
                          {cal.amendable && (
                            <Field label={L.reason}>
                              <input name="reason" required minLength={5} maxLength={500} className={inputCls} />
                            </Field>
                          )}
                        </ActionForm>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section title={L.changes}>
        {cal.changes.length === 0 ? (
          <Muted>{L.noChanges}</Muted>
        ) : (
          <ol className="flex flex-col gap-2">
            {cal.changes.map((c) => {
              const piece = cal.rows.find((r) => r.id === c.deliverableId);
              return (
                <li key={c.id} className="rounded-lg bg-black/[0.03] p-2.5 text-xs">
                  <p className="font-bold" dir="auto">
                    {piece ? `${piece.title} — ` : ""}
                    {fmt(L.changeLine, field(c.field), show(c.field, c.fromValue), show(c.field, c.toValue))}
                  </p>
                  <p className="mt-0.5 text-black/60" dir="auto">{c.reason}</p>
                  <p className="mt-0.5 text-black/50">{fmt(L.changeBy, c.changedByName, c.approvedByName)} · {when(c.createdAt)}</p>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}
