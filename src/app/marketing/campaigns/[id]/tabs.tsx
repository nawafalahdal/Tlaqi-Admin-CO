import Link from "next/link";
import type { MarketingCampaignRole } from "@prisma/client";
import type { Dictionary } from "@/i18n";
import type { MkActor } from "@/lib/marketing/access";
import { assignableMembers, type campaignWorkspace } from "@/lib/marketing/campaigns";
import { listFormats } from "@/lib/marketing/formats";
import { campaignTasks, campaignTaskIndex, campaignComments, TASK_KINDS } from "@/lib/marketing/tasks";
import { campaignEvents } from "@/lib/marketing/inbox";
import { assignmentSuggestions, type Suggestion } from "@/lib/marketing/suggestions";
import { PRIORITIES } from "@/lib/marketing/campaigns";
import { fmt } from "@/i18n/fmt";
import { ActionForm } from "../../_components/ActionForm";
import { Pill, Section, Field, inputCls, areaCls, deliverableTone, taskTone, nameOf, when, Muted, Pager } from "../../_components/bits";
import { FileField } from "@/components/FileField";

type Mk = Dictionary["mk"];
type Campaign = NonNullable<Awaited<ReturnType<typeof campaignWorkspace>>>["campaign"];

// ── المخرجات ──────────────────────────────────────────────────────────

export async function DeliverablesTab({ mk, campaign: c, canEdit, locale }: { mk: Mk; campaign: Campaign; canEdit: boolean; locale: "ar" | "en" }) {
  const formats = canEdit ? await listFormats() : [];
  // ما أُرشف بعد نشره خرج من العمل الجاري: سطرٌ مختصرٌ لكلٍّ منه، وتفاصيلُه في ملف الأرشيف
  const active = c.deliverables.filter((d) => !d.archivedAt);
  const archived = c.deliverables.filter((d) => d.archivedAt);
  return (
    <Section title={mk.campaign.deliverables}>
      {active.length === 0 ? (
        <Muted>{archived.length ? mk.campaign.allArchived : mk.campaign.noDeliverables}</Muted>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[0.06]">
          {active.map((d) => (
            <li key={d.id}>
              <Link href={`/marketing/campaigns/${c.id}/deliverables/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-black/[0.02]">
                {d.seq != null && <span className="rounded-md bg-[#1a0e1c] px-2 py-0.5 text-[11px] font-bold text-[#EEF6DF]">{fmt(mk.work.seq, d.seq)}</span>}
                <span className="text-sm font-bold">{d.title}</span>
                <span className="text-xs text-black/55" dir="ltr">{d.platform} · {d.width}×{d.height}</span>
                <Pill tone={deliverableTone(d.status)}>{mk.deliverableStatus[d.status]}</Pill>
                <span className="text-[11px] text-black/45">{when(d.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <details className="mt-3 rounded-xl bg-[#EEF6DF]/60 p-3" data-archived-posts>
          <summary className="cursor-pointer text-xs font-bold text-[#1a0e1c]">{fmt(mk.campaign.archivedPosts, archived.length)}</summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {archived.map((d) => (
              <li key={d.id}>
                <Link href={`/marketing/campaigns/${c.id}/deliverables/${d.id}`} className="hover:underline">
                  {d.seq != null ? `${fmt(mk.work.seq, d.seq)} — ` : ""}{d.title} · {when(d.archivedAt)}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && (
        <details className="mt-4 border-t border-black/5 pt-3">
          <summary className="cursor-pointer text-sm font-bold">{mk.campaign.addDeliverable}</summary>
          <div className="mt-3">
            <ActionForm op="deliverable.create" submit={mk.campaign.createDeliverable} resetOnSuccess>
              <input type="hidden" name="campaignId" value={c.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={mk.campaign.deliverableTitle}>
                  <input name="title" required maxLength={160} className={inputCls} />
                </Field>
                <Field label={mk.common.platform}>
                  <input name="platform" required maxLength={40} list={`platforms-${c.id}`} dir="ltr" defaultValue={c.channels[0] ?? ""} className={inputCls} />
                  <datalist id={`platforms-${c.id}`}>
                    {[...new Set([...c.channels, ...formats.flatMap((f) => f.platforms)])].map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </Field>
                <Field label={mk.common.format}>
                  <select name="formatKey" required className={inputCls}>
                    {formats.map((f) => (
                      <option key={f.key} value={f.key}>
                        {locale === "en" ? f.nameEn : f.nameAr} — {f.width}×{f.height}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </ActionForm>
          </div>
        </details>
      )}
    </Section>
  );
}

// ── المهامّ ───────────────────────────────────────────────────────────

// الإلغاءُ للمنسّق وحده — كما في `setTaskStatus`
const STATUS_ALL = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
const STATUS_ASSIGNEE = ["todo", "in_progress", "blocked", "done"] as const;

const TASKS_PAGE = 50;

export async function TasksTab({ mk, actor, campaign: c, roles, page: rawPage = 1 }: { mk: Mk; actor: MkActor; campaign: Campaign; roles: MarketingCampaignRole[]; page?: number }) {
  // بصفحات: مهامُّ التنفيذ تُولَّد أربعاً لكل قطعة، فلا تُرسم كلُّها في صفحةٍ واحدة
  const index = (await campaignTaskIndex(actor, c.id)) ?? { total: 0, options: [] };
  const pages = Math.max(1, Math.ceil(index.total / TASKS_PAGE));
  const page = Math.min(pages, Math.max(1, rawPage));
  const tasks = (await campaignTasks(actor, c.id, { page, size: TASKS_PAGE })) ?? [];
  const isCoordinator = roles.includes("coordinator");
  const closed = c.status === "archived" || c.status === "published";
  const me = actor.member?.id;
  const people = [...new Map(c.members.filter((m) => m.member.active).map((m) => [m.member.id, nameOf(m.member)])).entries()];
  // اقتراحٌ يُعرض للمنسّق — والإسنادُ ضغطتُه هو (`task.assign`)
  const suggestions = new Map(isCoordinator && !closed ? ((await assignmentSuggestions(actor, c.id)) ?? []).map((x) => [x.taskId, x]) : []);

  return (
    <Section title={mk.tasks.title}>
      {tasks.length === 0 ? (
        <Muted>{mk.tasks.empty}</Muted>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((t) => {
            const waiting = t.dependsOn.map((d) => d.dependsOn).filter((d) => d.status !== "done" && d.status !== "cancelled");
            const mine = !!me && t.assignee?.id === me;
            const canStatus = !closed && (isCoordinator || (mine && t.status !== "done" && t.status !== "cancelled"));
            const options = (isCoordinator ? STATUS_ALL : STATUS_ASSIGNEE).filter((s) => s !== t.status);
            return (
              <li key={t.id} id={`task-${t.id}`} className="scroll-mt-24 rounded-xl border border-black/[0.08] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{t.title}</span>
                  <Pill tone={taskTone(t.status)}>{mk.taskStatus[t.status]}</Pill>
                  <Pill>{mk.taskKind[t.kind]}</Pill>
                  {t.priority !== "normal" && <Pill tone={t.priority === "critical" ? "bad" : "review"}>{mk.priority[t.priority]}</Pill>}
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-black/50">
                  <span>{mk.tasks.assignee}: {t.assignee ? nameOf(t.assignee) : mk.tasks.unassigned}</span>
                  {t.dueAt && <span className={t.dueAt < new Date() && t.status !== "done" ? "font-bold text-red-700" : ""}>{mk.tasks.due}: {when(t.dueAt, false)}</span>}
                  {t.deliverable && <span>{mk.tasks.deliverable}: {t.deliverable.title}</span>}
                  {t.reopenCount > 0 && <span>{fmt(mk.tasks.reopened, t.reopenCount)}</span>}
                </p>
                {t.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/70">{t.description}</p>}
                {waiting.length > 0 && <p className="mt-2 text-xs text-amber-900">{fmt(mk.tasks.waitingOn, waiting.map((d) => d.title).join(" · "))}</p>}
                {suggestions.has(t.id) && <SuggestionBox mk={mk} taskId={t.id} s={suggestions.get(t.id)!} />}
                {t.files.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {t.files.map((f) => (
                      <li key={f.id}>
                        <a href={`/api/marketing/files/${f.id}`} className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.04]" target="_blank" rel="noopener">
                          {f.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {(canStatus || (roles.length > 0 && !closed) || isCoordinator) && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-black/5 pt-3">
                    {canStatus && (
                      <ActionForm op="task.status" submit={mk.tasks.setStatus} variant="outline" inline>
                        <input type="hidden" name="taskId" value={t.id} />
                        <select name="status" aria-label={mk.common.status} className={`${inputCls} w-auto`}>
                          {options.map((s) => (
                            <option key={s} value={s}>{mk.taskStatus[s]}</option>
                          ))}
                        </select>
                      </ActionForm>
                    )}
                    {roles.length > 0 && !closed && (
                      <details>
                        <summary className="cursor-pointer text-xs font-bold text-black/60">{mk.tasks.attach}</summary>
                        <div className="mt-2">
                          <ActionForm op="task.attach" submit={mk.tasks.attach} variant="outline" resetOnSuccess>
                            <input type="hidden" name="taskId" value={t.id} />
                            <FileField name="file" accept="application/pdf,image/png,image/jpeg,image/webp,.docx,.xlsx,.pptx" />
                            <span className="text-[11px] text-black/50">{mk.tasks.attachHint}</span>
                          </ActionForm>
                        </div>
                      </details>
                    )}
                    {isCoordinator && (
                      <details>
                        <summary className="cursor-pointer text-xs font-bold text-red-700">{mk.tasks.delete}</summary>
                        <div className="mt-2">
                          <ActionForm op="task.delete" submit={mk.tasks.delete} variant="danger" confirm={mk.tasks.deleteConfirm}>
                            <input type="hidden" name="taskId" value={t.id} />
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3">
        <Pager page={page} pages={pages} href={(n) => `/marketing/campaigns/${c.id}?tab=tasks&tp=${n}`} labels={mk.common} />
      </div>

      {isCoordinator && !closed && (
        <details className="mt-4 border-t border-black/5 pt-3">
          <summary className="cursor-pointer text-sm font-bold">{mk.tasks.add}</summary>
          <div className="mt-3">
            <ActionForm op="task.create" submit={mk.tasks.create} resetOnSuccess>
              <input type="hidden" name="campaignId" value={c.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={mk.tasks.taskTitle} className="sm:col-span-2">
                  <input name="title" required maxLength={200} className={inputCls} />
                </Field>
                <Field label={mk.tasks.description} className="sm:col-span-2">
                  <textarea name="description" rows={2} maxLength={2000} className={areaCls} />
                </Field>
                <Field label={mk.tasks.kind}>
                  <select name="kind" className={inputCls}>
                    {TASK_KINDS.map((k) => (
                      <option key={k} value={k}>{mk.taskKind[k]}</option>
                    ))}
                  </select>
                </Field>
                <Field label={mk.common.priority}>
                  <select name="priority" defaultValue="normal" className={inputCls}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{mk.priority[p]}</option>
                    ))}
                  </select>
                </Field>
                <Field label={mk.tasks.assignee}>
                  <select name="assigneeId" className={inputCls}>
                    <option value="">{mk.tasks.unassigned}</option>
                    {people.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </Field>
                <Field label={mk.tasks.due}>
                  <input type="date" name="dueAt" className={inputCls} />
                </Field>
                <Field label={mk.tasks.deliverable}>
                  <select name="deliverableId" className={inputCls}>
                    <option value="">{mk.tasks.noDeliverable}</option>
                    {c.deliverables.map((d) => (
                      <option key={d.id} value={d.id}>{d.title}</option>
                    ))}
                  </select>
                </Field>
                {index.options.length > 0 && (
                  <Field label={mk.tasks.dependsOn} hint={mk.tasks.dependsHint}>
                    <select name="dependsOn" multiple size={Math.min(5, index.options.length)} className={`${inputCls} py-2`}>
                      {index.options.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </ActionForm>
          </div>
        </details>
      )}
    </Section>
  );
}

function SuggestionBox({ mk, taskId, s }: { mk: Mk; taskId: string; s: Suggestion }) {
  return (
    <div data-suggestion={taskId} className="mt-3 rounded-xl border border-dashed border-black/15 bg-black/[0.02] p-3">
      <p className="text-xs font-bold">{mk.tasks.suggestTitle}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-black/55">{mk.tasks.suggestHint}</p>
      <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-black/60">
        <span>{s.role ? fmt(mk.tasks.suggestRole, mk.capability[s.role]) : mk.tasks.suggestAnyRole}</span>
        {s.why === "assignee_ineligible" && <span className="text-red-700">{mk.tasks.suggestIneligible}</span>}
        {s.waitingOn > 0 && <span className="text-amber-900">{fmt(mk.tasks.suggestWaiting, s.waitingOn)}</span>}
      </p>
      {s.candidates.length === 0 ? (
        <p className="mt-2 text-xs text-black/60">{mk.tasks.suggestNone}</p>
      ) : (
        <ActionForm
          op="task.assign"
          variant="outline"
          className="mt-2"
          buttons={s.candidates.map((p) => ({ label: fmt(mk.tasks.assignTo, p.name), name: "assigneeId", value: p.memberId, variant: "outline" as const }))}
        >
          <input type="hidden" name="taskId" value={taskId} />
          <ul className="flex flex-col gap-1 text-[11px] text-black/60">
            {s.candidates.map((p) => (
              <li key={p.memberId} className="flex flex-wrap gap-x-2">
                <span className="font-bold text-black/75">{p.name}</span>
                <span>{fmt(mk.tasks.suggestLoad, p.open)}</span>
                {p.overdue > 0 && <span className="text-red-700">{fmt(mk.tasks.suggestOverdue, p.overdue)}</span>}
                {p.authored && <span className="text-amber-900">{mk.tasks.suggestAuthored}</span>}
              </li>
            ))}
          </ul>
        </ActionForm>
      )}
    </div>
  );
}

// ── الفريق ────────────────────────────────────────────────────────────

export async function TeamTab({ mk, actor, campaign: c, canEdit }: { mk: Mk; actor: MkActor; campaign: Campaign; canEdit: boolean }) {
  const pool = canEdit ? ((await assignableMembers(actor, c.id)) ?? []) : [];
  return (
    <Section title={mk.campaign.team}>
      {c.members.length === 0 ? (
        <Muted>{mk.campaign.noTeam}</Muted>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[0.06]">
          {c.members.map((m) => {
            const revoked = !m.member.capabilities.includes(m.role);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <span className="text-sm font-bold">{nameOf(m.member)}</span>
                <Pill tone="progress">{mk.capability[m.role]}</Pill>
                {!m.member.active && <Pill tone="bad">{mk.campaign.inactive}</Pill>}
                {revoked && <Pill tone="review">{mk.campaign.capabilityRevoked}</Pill>}
                {canEdit && (
                  <div className="ms-auto">
                    <ActionForm op="campaign.member.remove" submit={mk.campaign.remove} variant="ghost">
                      <input type="hidden" name="campaignId" value={c.id} />
                      <input type="hidden" name="rowId" value={m.id} />
                    </ActionForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && pool.length > 0 && (
        <div className="mt-4 border-t border-black/5 pt-3">
          <ActionForm op="campaign.member.add" submit={mk.campaign.assign} inline>
            <input type="hidden" name="campaignId" value={c.id} />
            <Field label={mk.campaign.assignPerson} className="min-w-48 flex-1">
              <select name="memberId" required className={inputCls}>
                {pool.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.roles.map((r) => mk.capability[r]).join(" · ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={mk.campaign.assignRole} className="min-w-40">
              <select name="role" required className={inputCls}>
                {(["writer", "designer", "reviewer", "publisher", "coordinator"] as const).map((r) => (
                  <option key={r} value={r}>{mk.capability[r]}</option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </div>
      )}
    </Section>
  );
}

// ── التعليقات ─────────────────────────────────────────────────────────

export async function CommentsTab({ mk, actor, campaignId, canWrite, deliverableId }: { mk: Mk; actor: MkActor; campaignId: string; canWrite: boolean; deliverableId?: string }) {
  const comments = (await campaignComments(actor, campaignId, { deliverableId })) ?? [];
  return (
    <Section title={mk.campaign.comments}>
      {comments.length === 0 ? (
        <Muted>{mk.campaign.noComments}</Muted>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((m) => (
            <li key={m.id} className="rounded-xl bg-black/[0.03] px-3 py-2.5">
              <p className="flex flex-wrap gap-x-2 text-[11px] text-black/50">
                <span className="font-bold text-black/70">{nameOf(m.author)}</span>
                <span>{when(m.createdAt)}</span>
                {!deliverableId && m.deliverable && <span>· {m.deliverable.title}</span>}
                {m.task && <span>· {m.task.title}</span>}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="mt-4">
          <ActionForm op="comment.add" submit={mk.campaign.addComment} resetOnSuccess>
            <input type="hidden" name="campaignId" value={campaignId} />
            {deliverableId && <input type="hidden" name="deliverableId" value={deliverableId} />}
            <textarea name="body" required rows={3} maxLength={4000} placeholder={mk.campaign.commentPlaceholder} aria-label={mk.campaign.addComment} className={areaCls} />
          </ActionForm>
        </div>
      )}
    </Section>
  );
}

// ── السجلّ ────────────────────────────────────────────────────────────

/** تفاصيلُ الحدث المعروفة وحدها، بأسمائها المترجمة — لا يُعرض JSON خام */
export function eventSummary(mk: Mk, details: unknown, locale: "ar" | "en"): string {
  if (!details || typeof details !== "object") return "";
  const d = details as Record<string, unknown>;
  const status = (v: unknown) => {
    const k = String(v);
    return (mk.campaignStatus as Record<string, string>)[k] ?? (mk.deliverableStatus as Record<string, string>)[k] ?? (mk.taskStatus as Record<string, string>)[k] ?? k;
  };
  const parts: string[] = [];
  if (d.title) parts.push(String(d.title));
  if (d.name) parts.push(String(d.name));
  if (d.role) parts.push((mk.capability as Record<string, string>)[String(d.role)] ?? String(d.role));
  if (d.from !== undefined && d.to !== undefined) parts.push(`${status(d.from)} ${locale === "ar" ? "←" : "→"} ${status(d.to)}`);
  else if (d.to !== undefined) parts.push(status(d.to));
  if (d.version !== undefined) parts.push(fmt(mk.common.version, d.version));
  if (d.content !== undefined && d.design !== undefined) parts.push(fmt(mk.publish.pair, d.content, d.design));
  if (d.error) parts.push((mk.ai.jobErrors as Record<string, string>)[String(d.error)] ?? String(d.error));
  if (d.reason) parts.push(String(d.reason));
  if (d.url) parts.push(String(d.url));
  return parts.join(" · ");
}

export async function AuditTab({ mk, campaignId, deliverableId, locale }: { mk: Mk; campaignId: string; deliverableId?: string; locale: "ar" | "en" }) {
  const events = await campaignEvents(campaignId, 150, deliverableId);
  return (
    <Section title={mk.campaign.audit}>
      {events.length === 0 ? (
        <Muted>{mk.campaign.noEvents}</Muted>
      ) : (
        <ol className="flex flex-col divide-y divide-black/[0.06]">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
              <span className="text-[11px] tabular-nums text-black/45" dir="ltr">{when(e.createdAt)}</span>
              <span className="font-bold">{(mk.events as Record<string, string>)[e.action] ?? e.action}</span>
              <span className="text-xs text-black/60">{e.actorKind === "system" ? mk.common.system : e.actorName}</span>
              <span className="text-xs text-black/50">{eventSummary(mk, e.details, locale)}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
