import type { ReactNode } from "react";
import Link from "next/link";
import type { themeFromColor } from "@/lib/brand";
import type { OrgActor } from "@/lib/org/actor";
import type { committeeDetail } from "@/lib/org/queries";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { fmt } from "@/i18n/fmt";
import {
  submitCommitteeAction,
  changeCommitteeStatusAction,
  updateCommitteeAction,
  appointLeadAction,
  addMembersAction,
  removeMemberAction,
  committeeResponsibilityAction,
  proposeChangeAction,
  decideProposalAction,
  createTaskAction,
  taskStatusAction,
  updateTaskAction,
  scheduleMeetingAction,
  cancelMeetingAction,
  recordMeetingAction,
  addDecisionAction,
  submitReportAction,
  reviewReportAction,
} from "../actions";
import { ActionForm, PeoplePicker } from "../_components/ActionForm";
import { CommitteeFields } from "../_components/CommitteeFields";
import {
  Chip,
  Field,
  Prose,
  Section,
  Stat,
  inputCls,
  textareaCls,
  fmtDay,
  fmtWhen,
  riyadhDayInput,
} from "../_components/bits";

type Detail = NonNullable<Awaited<ReturnType<typeof committeeDetail>>>;
type Ctx = { d: Detail; actor: OrgActor; L: Dictionary["org"]; theme: ReturnType<typeof themeFromColor> };

const FROZEN = new Set(["closed", "archived"]);
const isActive = (d: Detail) => d.committee.committeeStatus === "approved";
const isFrozen = (d: Detail) => FROZEN.has(d.committee.committeeStatus!);

function Hidden({ d }: { d: Detail }) {
  return <input type="hidden" name="committeeId" value={d.committee.id} />;
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: ReactNode }) {
  const cls = tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-black/[0.04] text-black/70";
  return <p className={`rounded-xl px-3.5 py-2.5 text-sm ${cls}`}>{children}</p>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-black/45">{children}</p>;
}

function Meta({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-black/5 py-1.5">
          <dt className="text-black/55">{k}</dt>
          <dd className="text-end font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  نظرة عامة
// ═════════════════════════════════════════════════════════════════════

export function OverviewTab({ d, L, theme }: Ctx) {
  const c = d.committee;
  const T = L.detail;
  // والحسابُ القياديُّ القديم مجمَّدٌ لا يقود — فاللجنةُ بلا قائدٍ حتى يُحوَّل أو يُعيَّن غيرُه
  const leadless = !c.leadMember?.isActive && (c.committeeStatus === "approved" || c.committeeStatus === "suspended");
  return (
    <div className="flex flex-col gap-6">
      {isFrozen(d) && <Banner tone="info">{T.frozen}</Banner>}
      {!isFrozen(d) && !isActive(d) && <Banner tone="info">{T.inactive}</Banner>}
      {leadless && <Banner tone="warn">{T.leadless}</Banner>}
      {c.statusNote && (
        <Banner tone="info">
          {T.statusNote}: {c.statusNote}
        </Banner>
      )}

      <Meta
        items={[
          [T.department, c.parent?.name ?? "—"],
          [T.kind, c.committeeKind ? L.kinds[c.committeeKind] : L.kinds.permanent],
          [T.created, fmtWhen(c.createdAt, false)],
          [T.start, fmtDay(c.startDate)],
          [T.end, c.endDate ? fmtDay(c.endDate) : L.openEnded],
          [T.lead, c.leadMember?.fullName ?? (d.actingLeadName ? fmt(L.actingLead, d.actingLeadName) : c.legacyLeadName ? fmt(L.legacyLead, c.legacyLeadName) : L.noLead)],
          [T.requestedBy, c.requestedByName ?? "—"],
          [T.decidedBy, c.decidedByName ? `${c.decidedByName} · ${fmtWhen(c.decidedAt, false)}` : "—"],
        ]}
      />
      {c.decisionNote && (
        <Banner tone="info">
          {T.decisionNote}: {c.decisionNote}
        </Banner>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Section title={L.form.purpose}>
          <Prose>{c.purpose}</Prose>
        </Section>
        <Section title={L.form.description}>
          <Prose>{c.description}</Prose>
        </Section>
        <Section title={L.form.scope}>
          <Prose>{c.scope}</Prose>
        </Section>
        <Section title={L.form.responsibilities}>
          <Prose>{c.responsibilities}</Prose>
        </Section>
        <Section title={L.form.expectedOutputs}>
          <Prose>{c.expectedOutputs}</Prose>
        </Section>
        <Section title={L.form.kpis}>
          <Prose>{c.kpis}</Prose>
        </Section>
      </div>

      {/* الإرسالُ للاعتماد لقائد القسم ونائبه المفوَّض — والرئيسُ والمؤسس يعتمدان ولا يرسلان */}
      {d.role.propose && (c.committeeStatus === "draft" || c.committeeStatus === "rejected") && (
        <div className="flex flex-col gap-2 rounded-2xl border border-black/5 p-4">
          <p className="text-xs text-black/55">{T.submitHint}</p>
          <ActionForm action={submitCommitteeAction} submits={[{ label: T.submitForApproval }]} pendingLabel={T.submitting} theme={theme}>
            <Hidden d={d} />
          </ActionForm>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  الأعضاء
// ═════════════════════════════════════════════════════════════════════

export function MembersTab({ d, L, theme }: Ctx) {
  const M = L.members;
  const c = d.committee;
  const active = d.memberships.filter((m) => m.active);
  const former = d.memberships.filter((m) => !m.active);
  const canEditResp = (d.role.manage || d.role.lead) && !isFrozen(d);
  const canManage = d.role.manage && !isFrozen(d);
  const pending = d.proposals.filter((p) => p.status === "pending");
  const past = d.proposals.filter((p) => p.status !== "pending");
  const leadPool = [...active.map((m) => ({ id: m.memberId, fullName: m.member.fullName })), ...d.candidates];

  return (
    <div className="flex flex-col gap-6">
      <Section title={`${M.active} (${active.length})`}>
        {active.length === 0 ? (
          <Empty>{L.detail.noData}</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-black/5 rounded-2xl border border-black/5">
            {active.map((m) => (
              <li key={m.memberId} className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {m.member.fullName}
                    {m.memberId === c.leadMemberId && <Chip tone="ok">{M.leadBadge}</Chip>}
                    {!m.member.isActive && <Chip tone="danger">—</Chip>}
                  </p>
                  <p className="text-xs text-black/50">
                    {m.responsibility || L.overview.noResponsibility}
                    {" · "}
                    {fmt(M.addedBy, fmtWhen(m.addedAt, false), m.addedByName ?? "—")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canEditResp && (
                    <ActionForm
                      action={committeeResponsibilityAction}
                      submits={[{ label: L.overview.save, variant: "outline" }]}
                      pendingLabel={L.overview.saving}
                      theme={theme}
                      compact
                      className="flex items-center gap-2"
                    >
                      <Hidden d={d} />
                      <input type="hidden" name="memberId" value={m.memberId} />
                      <input
                        name="responsibility"
                        defaultValue={m.responsibility ?? ""}
                        maxLength={80}
                        placeholder={L.overview.responsibility}
                        aria-label={`${M.responsibility} — ${m.member.fullName}`}
                        className="min-h-9 w-40 rounded-lg border border-black/10 bg-white px-2.5 text-xs outline-none focus:border-black/30"
                      />
                    </ActionForm>
                  )}
                  {canManage && m.memberId !== c.leadMemberId && (
                    <ActionForm
                      action={removeMemberAction}
                      submits={[{ label: M.remove, variant: "ghost" }]}
                      pendingLabel={L.overview.saving}
                      theme={theme}
                      compact
                      className="flex items-center gap-2"
                      confirm={{ title: fmt(M.removeTitle, m.member.fullName), body: M.removeBody, confirmLabel: M.remove }}
                    >
                      <Hidden d={d} />
                      <input type="hidden" name="memberId" value={m.memberId} />
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {d.leadDeparted && (d.role.manage || d.role.view) && <Banner tone="warn">{M.leadDeparted}</Banner>}
      {canManage && !d.leadDeparted && !d.canAppointLead && (c.committeeStatus === "approved" || c.committeeStatus === "suspended") && (
        <Banner tone="info">{M.leadLocked}</Banner>
      )}
      {canManage && (
        <div className="grid gap-5 lg:grid-cols-2">
          {d.canAppointLead && (
          <Section title={c.leadMemberId ? M.handover : M.appointLead}>
            <ActionForm
              action={appointLeadAction}
              submits={[{ label: c.leadMemberId ? M.handover : M.appointLead }]}
              pendingLabel={M.appointing}
              theme={theme}
            >
              <Hidden d={d} />
              <p className="text-xs text-black/55">{c.leadMemberId ? M.handoverHint : M.appointLeadHint}</p>
              <select name="memberId" required defaultValue="" aria-label={M.appointLead} className={inputCls}>
                <option value="" disabled>
                  {M.choose}
                </option>
                {leadPool
                  .filter((p) => p.id !== c.leadMemberId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
              {c.leadMemberId && (
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" name="reassignOpenTasks" defaultChecked={d.leadDeparted} className="h-4 w-4" />
                  {M.reassignTasks}
                </label>
              )}
            </ActionForm>
          </Section>
          )}
          <Section title={M.add}>
            {d.candidates.length === 0 ? (
              <p className="text-xs text-black/50">{M.noCandidates}</p>
            ) : (
              <ActionForm action={addMembersAction} submits={[{ label: M.add }]} pendingLabel={M.adding} theme={theme}>
                <Hidden d={d} />
                <PeoplePicker name="memberIds" people={d.candidates} searchLabel={L.form.searchPeople} emptyLabel={M.noCandidates} />
              </ActionForm>
            )}
          </Section>
        </div>
      )}

      {d.role.lead && isActive(d) && (
        <Section title={M.propose}>
          <ActionForm action={proposeChangeAction} submits={[{ label: M.send }]} pendingLabel={L.overview.saving} theme={theme} className="grid gap-3 sm:grid-cols-2">
            <Hidden d={d} />
            <p className="text-xs text-black/55 sm:col-span-2">{M.proposeHint}</p>
            <Field label={M.proposalKind}>
              <select name="kind" required className={inputCls}>
                {(["add_member", "remove_member", "replace_member"] as const).map((k) => (
                  <option key={k} value={k}>
                    {L.proposalKind[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={M.proposalMember}>
              <select name="memberId" required defaultValue="" className={inputCls}>
                <option value="" disabled>
                  {M.choose}
                </option>
                {leadPool
                  .filter((p) => p.id !== c.leadMemberId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={M.replacement}>
              <select name="replacementMemberId" defaultValue="" className={inputCls}>
                <option value="">—</option>
                {d.candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={M.note}>
              <input name="note" maxLength={200} className={inputCls} />
            </Field>
          </ActionForm>
        </Section>
      )}

      {(pending.length > 0 || past.length > 0) && (
        <Section title={M.proposals}>
          <ul className="flex flex-col gap-2">
            {[...pending, ...past].map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-2xl border border-black/5 p-3.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>{L.proposalKind[p.kind]}</strong>
                  <span>
                    {p.member?.fullName ?? "—"}
                    {p.replacement && ` ← ${p.replacement.fullName}`}
                  </span>
                  <Chip tone={p.status === "pending" ? "warn" : p.status === "accepted" ? "ok" : "neutral"}>{L.proposalStatus[p.status]}</Chip>
                </div>
                <p className="text-xs text-black/50">
                  {fmt(M.proposedBy, p.proposedByName, fmtWhen(p.createdAt, false))}
                  {p.note && ` · ${p.note}`}
                  {p.decidedByName && ` · ${fmt(M.decidedBy, p.decidedByName)}`}
                  {p.decisionNote && ` · ${p.decisionNote}`}
                </p>
                {p.status === "pending" && d.role.manage && (
                  <ActionForm
                    action={decideProposalAction}
                    submits={[
                      { label: M.accept, name: "decision", value: "accept" },
                      { label: M.reject, name: "decision", value: "reject", variant: "outline" },
                    ]}
                    pendingLabel={L.overview.saving}
                    theme={theme}
                    compact
                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  >
                    <Hidden d={d} />
                    <input type="hidden" name="proposalId" value={p.id} />
                    <input name="note" maxLength={200} placeholder={M.decisionNote} aria-label={M.decisionNote} className="min-h-9 flex-1 rounded-lg border border-black/10 bg-white px-2.5 text-xs outline-none focus:border-black/30" />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {former.length > 0 && (
        <Section title={`${M.former} (${former.length})`}>
          <ul className="flex flex-col gap-1 text-sm text-black/60">
            {former.map((m) => (
              <li key={m.memberId}>
                {m.member.fullName}
                <span className="text-xs text-black/45">
                  {" · "}
                  {fmt(M.removedBy, fmtWhen(m.removedAt, false), m.removedByName ?? "—")}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  المهامّ
// ═════════════════════════════════════════════════════════════════════

const PRIORITY_TONE = { low: "neutral", normal: "neutral", high: "warn", urgent: "danger" } as const;

export function TasksTab({ d, actor, L, theme }: Ctx) {
  const K = L.tasks;
  const lead = d.role.lead && isActive(d);
  const activeMembers = d.memberships.filter((m) => m.active);
  const meetings = d.meetings.filter((m) => m.status !== "cancelled");
  const mineId = actor.kind === "member" ? actor.id : null;
  const tasks = [...d.tasks].sort((a, b) => Number(b.assigneeMemberId === mineId) - Number(a.assigneeMemberId === mineId));

  return (
    <div className="flex flex-col gap-6">
      {lead && (
        <details className="rounded-2xl border border-black/5 p-4">
          <summary className="cursor-pointer text-sm font-bold">{K.new}</summary>
          <ActionForm action={createTaskAction} submits={[{ label: K.create }]} pendingLabel={K.creating} theme={theme} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Hidden d={d} />
            <div className="sm:col-span-2">
              <Field label={K.title} required>
                <input name="title" required maxLength={200} className={inputCls} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={K.description}>
                <textarea name="description" maxLength={2000} className={textareaCls} />
              </Field>
            </div>
            <Field label={K.assignee} required>
              <select name="assigneeMemberId" required defaultValue="" className={inputCls}>
                <option value="" disabled>
                  {L.members.choose}
                </option>
                {activeMembers.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.member.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={K.dueAt}>
              <input type="date" name="dueAt" className={inputCls} />
            </Field>
            <Field label={K.priority}>
              <select name="priority" defaultValue="normal" className={inputCls}>
                {(["low", "normal", "high", "urgent"] as const).map((p) => (
                  <option key={p} value={p}>
                    {L.priority[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={K.meeting}>
              <select name="meetingId" defaultValue="" className={inputCls}>
                <option value="">{K.noMeeting}</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} — {fmtWhen(m.startsAt, false)}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </details>
      )}

      {tasks.length === 0 ? (
        <Empty>{K.none}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((t) => {
            const overdue = d.overdueTaskIds.has(t.id);
            const mine = !!mineId && t.assigneeMemberId === mineId;
            const open = t.status === "todo" || t.status === "in_progress";
            const canStatus = isActive(d) && (d.role.lead || (mine && t.status !== "cancelled"));
            const statuses = d.role.lead ? (["todo", "in_progress", "done", "cancelled"] as const) : (["todo", "in_progress", "done"] as const);
            return (
              <li key={t.id} className={`flex flex-col gap-2 rounded-2xl border p-3.5 ${overdue ? "border-red-200 bg-red-50/40" : "border-black/5"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{t.title}</p>
                  <Chip tone={t.status === "done" ? "ok" : t.status === "cancelled" ? "neutral" : "info"}>{L.taskStatus[t.status]}</Chip>
                  <Chip tone={PRIORITY_TONE[t.priority]}>{L.priority[t.priority]}</Chip>
                  {overdue && <Chip tone="danger">{K.overdue}</Chip>}
                  {mine && <Chip tone="ok">{K.mine}</Chip>}
                </div>
                {t.description && <p className="whitespace-pre-line text-xs leading-relaxed text-black/65">{t.description}</p>}
                <p className="text-xs text-black/50">
                  {K.assignee}: {t.assignee?.fullName ?? K.unassigned}
                  {t.dueAt && ` · ${fmt(K.due, fmtWhen(t.dueAt, false))}`}
                  {t.completedAt && ` · ${fmt(K.doneAt, fmtWhen(t.completedAt, false))}`}
                </p>
                {(canStatus || (d.role.lead && open && isActive(d))) && (
                  <div className="flex flex-wrap items-start gap-3">
                    {canStatus && (
                      <ActionForm action={taskStatusAction} submits={[{ label: K.setStatus, variant: "outline" }]} pendingLabel={L.overview.saving} theme={theme} compact className="flex items-center gap-2">
                        <Hidden d={d} />
                        <input type="hidden" name="taskId" value={t.id} />
                        <select name="status" defaultValue={t.status} aria-label={K.setStatus} className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs">
                          {statuses.map((s) => (
                            <option key={s} value={s}>
                              {L.taskStatus[s]}
                            </option>
                          ))}
                        </select>
                      </ActionForm>
                    )}
                    {d.role.lead && open && isActive(d) && (
                      <details className="text-xs">
                        <summary className="cursor-pointer py-2 font-bold text-black/60">{K.reassign}</summary>
                        <ActionForm action={updateTaskAction} submits={[{ label: K.save }]} pendingLabel={L.overview.saving} theme={theme} compact className="mt-2 flex flex-wrap items-center gap-2">
                          <Hidden d={d} />
                          <input type="hidden" name="taskId" value={t.id} />
                          <select name="assigneeMemberId" defaultValue={t.assigneeMemberId ?? ""} aria-label={K.assignee} className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs">
                            <option value="" disabled>
                              {L.members.choose}
                            </option>
                            {activeMembers.map((m) => (
                              <option key={m.memberId} value={m.memberId}>
                                {m.member.fullName}
                              </option>
                            ))}
                          </select>
                          <input type="date" name="dueAt" defaultValue={riyadhDayInput(t.dueAt)} aria-label={K.dueAt} className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs" />
                          <select name="priority" defaultValue={t.priority} aria-label={K.priority} className="min-h-9 rounded-lg border border-black/10 bg-white px-2 text-xs">
                            {(["low", "normal", "high", "urgent"] as const).map((p) => (
                              <option key={p} value={p}>
                                {L.priority[p]}
                              </option>
                            ))}
                          </select>
                        </ActionForm>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  الاجتماعات
// ═════════════════════════════════════════════════════════════════════

export function MeetingsTab({ d, L, theme }: Ctx) {
  const G = L.meetings;
  const lead = d.role.lead && isActive(d);
  const upcoming = d.meetings.filter((m) => d.upcomingMeetingIds.has(m.id)).reverse();
  const past = d.meetings.filter((m) => !d.upcomingMeetingIds.has(m.id));
  const activeMembers = d.memberships.filter((m) => m.active);
  const nameOf = new Map(d.memberships.map((m) => [m.memberId, m.member.fullName]));

  const card = (m: Detail["meetings"][number]) => {
    const present = m.attendance.filter((a) => a.status === "present").length;
    return (
      <li key={m.id} className="flex flex-col gap-2 rounded-2xl border border-black/5 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{m.title}</p>
          <Chip tone={m.status === "held" ? "ok" : m.status === "cancelled" ? "neutral" : "info"}>{L.meetingStatus[m.status]}</Chip>
        </div>
        <p className="text-xs text-black/55">
          {fmtWhen(m.startsAt)} · {m.durationMinutes}′{m.location && ` · ${m.location}`}
          {m.meetingUrl && (
            <>
              {" · "}
              <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
                {G.join}
              </a>
            </>
          )}
        </p>
        {m.agenda && (
          <div>
            <p className="text-xs font-bold text-black/60">{G.agenda}</p>
            <Prose>{m.agenda}</Prose>
          </div>
        )}
        {m.status === "held" && (
          <>
            <p className="text-xs text-black/55">
              {fmt(G.attendanceN, present, m.attendance.length)}
              {m.attendance.length > 0 && (
                <>
                  {" — "}
                  {m.attendance.map((a) => `${nameOf.get(a.memberId) ?? "—"}: ${L.attendance[a.status]}`).join("، ")}
                </>
              )}
            </p>
            {m.minutes && (
              <div>
                <p className="text-xs font-bold text-black/60">{G.minutes}</p>
                <Prose>{m.minutes}</Prose>
              </div>
            )}
          </>
        )}
        {m.status === "cancelled" && m.cancelledReason && <p className="text-xs text-black/55">{m.cancelledReason}</p>}
        {lead && m.status === "scheduled" && (
          <div className="flex flex-col gap-2">
            <details className="rounded-xl bg-black/[0.03] p-3">
              <summary className="cursor-pointer text-xs font-bold">{G.record}</summary>
              <ActionForm action={recordMeetingAction} submits={[{ label: G.saveRecord }]} pendingLabel={L.overview.saving} theme={theme} className="mt-3 flex flex-col gap-3">
                <Hidden d={d} />
                <input type="hidden" name="meetingId" value={m.id} />
                <ul className="flex flex-col gap-1.5">
                  {activeMembers.map((am) => {
                    const cur = m.attendance.find((a) => a.memberId === am.memberId)?.status ?? "present";
                    return (
                      <li key={am.memberId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>{am.member.fullName}</span>
                        <span className="flex gap-3">
                          {(["present", "absent", "excused"] as const).map((s) => (
                            <label key={s} className="flex items-center gap-1 text-xs">
                              <input type="radio" name={`att:${am.memberId}`} value={s} defaultChecked={cur === s} />
                              {L.attendance[s]}
                            </label>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Field label={G.minutes}>
                  <textarea name="minutes" maxLength={2000} defaultValue={m.minutes ?? ""} className={textareaCls} />
                </Field>
              </ActionForm>
            </details>
            <ActionForm
              action={cancelMeetingAction}
              submits={[{ label: G.cancel, variant: "ghost" }]}
              pendingLabel={L.overview.saving}
              theme={theme}
              compact
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
              confirm={{ title: G.cancel, confirmLabel: G.cancel }}
            >
              <Hidden d={d} />
              <input type="hidden" name="meetingId" value={m.id} />
              <input name="reason" maxLength={200} placeholder={G.cancelReason} aria-label={G.cancelReason} className="min-h-9 flex-1 rounded-lg border border-black/10 bg-white px-2.5 text-xs outline-none focus:border-black/30" />
            </ActionForm>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-black/50">{G.calendarNote}</p>
      {lead && (
        <details className="rounded-2xl border border-black/5 p-4">
          <summary className="cursor-pointer text-sm font-bold">{G.schedule}</summary>
          <ActionForm action={scheduleMeetingAction} submits={[{ label: G.create }]} pendingLabel={G.creating} theme={theme} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Hidden d={d} />
            <div className="sm:col-span-2">
              <Field label={G.title} required>
                <input name="title" required maxLength={200} className={inputCls} />
              </Field>
            </div>
            <Field label={G.startsAt} required>
              <input type="datetime-local" name="startsAt" required className={inputCls} />
            </Field>
            <Field label={G.duration}>
              <input type="number" name="durationMinutes" min={15} max={480} step={15} defaultValue={60} className={inputCls} />
            </Field>
            <Field label={G.location}>
              <input name="location" maxLength={200} className={inputCls} />
            </Field>
            <Field label={G.meetingUrl}>
              <input type="url" name="meetingUrl" maxLength={500} dir="ltr" placeholder="https://" className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={G.agenda}>
                <textarea name="agenda" maxLength={2000} className={textareaCls} />
              </Field>
            </div>
          </ActionForm>
        </details>
      )}
      <Section title={G.upcoming}>{upcoming.length ? <ul className="flex flex-col gap-2">{upcoming.map(card)}</ul> : <Empty>{G.none}</Empty>}</Section>
      {past.length > 0 && (
        <Section title={G.past}>
          <ul className="flex flex-col gap-2">{past.map(card)}</ul>
        </Section>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  القرارات والمحاضر
// ═════════════════════════════════════════════════════════════════════

export function DecisionsTab({ d, L, theme }: Ctx) {
  const X = L.decisions;
  const lead = d.role.lead && isActive(d);
  const member = !d.role.lead && d.role.member && isActive(d);
  const meetings = d.meetings.filter((m) => m.status !== "cancelled");
  const titleOf = new Map(d.meetings.map((m) => [m.id, m.title]));
  return (
    <div className="flex flex-col gap-6">
      {(lead || member) && (
        <ActionForm action={addDecisionAction} submits={[{ label: X.add }]} pendingLabel={L.overview.saving} theme={theme} className="grid gap-3 rounded-2xl border border-black/5 p-4 sm:grid-cols-2">
          <Hidden d={d} />
          {member && (
            <>
              <input type="hidden" name="kind" value="note" />
              <p className="text-xs text-black/55 sm:col-span-2">{X.memberHint}</p>
            </>
          )}
          {lead && (
            <Field label={X.kind}>
              <select name="kind" defaultValue="decision" className={inputCls}>
                {(["decision", "recommendation", "note"] as const).map((k) => (
                  <option key={k} value={k}>
                    {L.decisionKind[k]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={X.meeting}>
            <select name="meetingId" defaultValue="" className={inputCls}>
              <option value="">{L.tasks.noMeeting}</option>
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} — {fmtWhen(m.startsAt, false)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={X.text} required>
              <textarea name="text" required maxLength={2000} className={textareaCls} />
            </Field>
          </div>
        </ActionForm>
      )}
      {d.decisions.length === 0 ? (
        <Empty>{X.none}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {d.decisions.map((x) => (
            <li key={x.id} className="flex flex-col gap-1.5 rounded-2xl border border-black/5 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={x.kind === "decision" ? "ok" : x.kind === "recommendation" ? "info" : "neutral"}>{L.decisionKind[x.kind]}</Chip>
                <span className="text-xs text-black/50">
                  {fmt(L.detail.by, x.createdByName)} · {fmtWhen(x.createdAt)}
                  {x.meetingId && titleOf.get(x.meetingId) && ` · ${titleOf.get(x.meetingId)}`}
                </span>
              </div>
              <Prose>{x.text}</Prose>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  التقارير والمؤشرات
// ═════════════════════════════════════════════════════════════════════

export function ReportsTab({ d, L, theme }: Ctx) {
  const R = L.reports;
  const T = L.detail;
  const st = d.committee.committeeStatus;
  const canSubmit = d.role.lead && (st === "approved" || st === "completed");
  return (
    <div className="flex flex-col gap-6">
      <Section title={R.kpis}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={T.progress} value={d.stats.progress === null ? L.notSet : `${d.stats.progress}%`} />
          <Stat label={T.overdue} value={d.stats.overdue} tone={d.stats.overdue ? "danger" : undefined} />
          <Stat label={T.meetingsHeld} value={d.kpis.meetingsHeld} />
          <Stat label={T.upcoming} value={d.kpis.meetingsUpcoming} />
          <Stat label={T.attendanceRate} value={d.kpis.attendanceRate === null ? L.notSet : `${d.kpis.attendanceRate}%`} />
          <Stat label={T.decisions} value={d.kpis.decisions} />
          <Stat label={T.recommendations} value={d.kpis.recommendations} />
          <Stat label={T.reports} value={d.kpis.reports} />
        </div>
      </Section>
      {d.committee.kpis && (
        <Section title={L.form.kpis}>
          <Prose>{d.committee.kpis}</Prose>
        </Section>
      )}

      {canSubmit && (
        <details className="rounded-2xl border border-black/5 p-4">
          <summary className="cursor-pointer text-sm font-bold">{R.submit}</summary>
          <ActionForm action={submitReportAction} submits={[{ label: R.send }]} pendingLabel={R.sending} theme={theme} className="mt-3 flex flex-col gap-3">
            <Hidden d={d} />
            <Field label={R.period} required>
              <input name="periodLabel" required maxLength={200} placeholder={R.periodPh} className={inputCls} />
            </Field>
            <Field label={R.summary} required>
              <textarea name="summary" required maxLength={2000} className={textareaCls} />
            </Field>
            <Field label={R.achievements}>
              <textarea name="achievements" maxLength={2000} className={textareaCls} />
            </Field>
            <Field label={R.challenges}>
              <textarea name="challenges" maxLength={2000} className={textareaCls} />
            </Field>
            <Field label={R.nextSteps}>
              <textarea name="nextSteps" maxLength={2000} className={textareaCls} />
            </Field>
          </ActionForm>
        </details>
      )}

      {d.reports.length === 0 ? (
        <Empty>{R.none}</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {d.reports.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-black/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold">{r.periodLabel}</p>
                <span className="text-xs text-black/50">
                  {fmt(L.detail.by, r.submittedByName)} · {fmtWhen(r.submittedAt, false)}
                </span>
                {r.reviewedAt ? (
                  <Chip tone="ok">{fmt(R.reviewed, r.reviewedByName ?? "—", fmtWhen(r.reviewedAt, false))}</Chip>
                ) : (
                  <Chip tone="warn">{R.awaiting}</Chip>
                )}
              </div>
              <Prose>{r.summary}</Prose>
              {r.achievements && (
                <div>
                  <p className="text-xs font-bold text-black/60">{R.achievements}</p>
                  <Prose>{r.achievements}</Prose>
                </div>
              )}
              {r.challenges && (
                <div>
                  <p className="text-xs font-bold text-black/60">{R.challenges}</p>
                  <Prose>{r.challenges}</Prose>
                </div>
              )}
              {r.nextSteps && (
                <div>
                  <p className="text-xs font-bold text-black/60">{R.nextSteps}</p>
                  <Prose>{r.nextSteps}</Prose>
                </div>
              )}
              {r.reviewNote && <p className="text-xs text-black/55">{r.reviewNote}</p>}
              {!r.reviewedAt && d.role.manage && (
                <ActionForm action={reviewReportAction} submits={[{ label: R.review }]} pendingLabel={L.overview.saving} theme={theme} compact className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Hidden d={d} />
                  <input type="hidden" name="reportId" value={r.id} />
                  <input name="note" maxLength={200} placeholder={R.reviewNote} aria-label={R.reviewNote} className="min-h-9 flex-1 rounded-lg border border-black/10 bg-white px-2.5 text-xs outline-none focus:border-black/30" />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  سجلّ التغييرات
// ═════════════════════════════════════════════════════════════════════

function pairs(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}: ${x === null || x === undefined ? "—" : Array.isArray(x) ? x.join(", ") : String(x)}`)
    .join(" · ");
}

export function LogTab({ d, L }: Ctx) {
  const G = L.log;
  if (!d.log.length) return <Empty>{G.none}</Empty>;
  return (
    <ol className="flex flex-col gap-2">
      {d.log.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 rounded-xl border border-black/5 px-3.5 py-2.5">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <strong>{G.actions[e.action] ?? e.action}</strong>
            <span className="text-xs text-black/50">
              {e.actorName} · {fmtWhen(e.createdAt)}
            </span>
          </p>
          {e.before !== null && pairs(e.before) && (
            <p className="break-words text-xs text-black/55">
              {G.before}: {pairs(e.before)}
            </p>
          )}
          {e.after !== null && pairs(e.after) && (
            <p className="break-words text-xs text-black/70">
              {G.after}: {pairs(e.after)}
            </p>
          )}
          {e.note && <p className="text-xs text-black/55">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

// ═════════════════════════════════════════════════════════════════════
//  الإعدادات — لمن يدير اللجنة وحده
// ═════════════════════════════════════════════════════════════════════

export function SettingsTab({ d, L, theme }: Ctx) {
  const T = L.detail;
  const c = d.committee;
  return (
    <div className="flex flex-col gap-8">
      {d.transitions.length > 0 && (
        <Section title={T.statusActions}>
          <ActionForm action={changeCommitteeStatusAction} submits={[{ label: T.apply }]} pendingLabel={L.overview.saving} theme={theme} className="grid gap-3 sm:grid-cols-2">
            <Hidden d={d} />
            <Field label={T.statusActions}>
              <select name="to" required className={inputCls}>
                {d.transitions.map((s) => (
                  <option key={s} value={s}>
                    {fmt(T.toStatus, L.statuses[s])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={T.statusNote} hint={T.statusNoteHint}>
              <input name="note" maxLength={200} className={inputCls} />
            </Field>
          </ActionForm>
        </Section>
      )}
      {!isFrozen(d) ? (
        <Section title={L.form.saveChanges}>
          <ActionForm action={updateCommitteeAction} submits={[{ label: L.form.saveChanges }]} pendingLabel={L.form.saving} theme={theme} className="flex flex-col gap-4">
            <Hidden d={d} />
            <CommitteeFields L={L} v={c} />
          </ActionForm>
        </Section>
      ) : (
        <Banner tone="info">{T.frozen}</Banner>
      )}
      <p className="text-xs text-black/45">
        <Link href={`/committees/${c.id}?tab=log`} className="underline">
          {L.tabs.log}
        </Link>
      </p>
    </div>
  );
}
