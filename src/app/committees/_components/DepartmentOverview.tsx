import Link from "next/link";
import { Card } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import type { departmentOverview } from "@/lib/org/queries";
import { DEPUTY_PERMISSIONS } from "@/lib/org/committeeService";
import { fmt } from "@/i18n/fmt";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import {
  appointDeputyAction,
  deputyPermissionAction,
  revokeDeputyAction,
  memberResponsibilityAction,
} from "../actions";
import { ActionForm } from "./ActionForm";
import { Stat, Field, inputCls, fmtWhen } from "./bits";

type Overview = NonNullable<Awaited<ReturnType<typeof departmentOverview>>>;
type Theme = ReturnType<typeof themeFromColor>;

/** نظرةُ القسم: قائدُه ونائبُه وأعضاؤه ومسؤولياتُهم ولجانُه ومهامُّه.
 *  ما يُرسم هنا محسوبٌ بصلاحية المشاهد في `departmentOverview` — والأزرارُ
 *  لا تظهر إلا لمن يملكها، والخادمُ يفحصها ثانيةً عند الإرسال. */
export function DepartmentOverview({ o, theme, L }: { o: Overview; theme: Theme; L: Dictionary["org"] }) {
  const V = L.overview;
  const D = L.deputy;
  const pct = (n: number | null) => (n === null ? L.notSet : `${n}%`);
  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 shrink-0 rounded-xl" style={{ background: o.dept.colorHex }} aria-hidden />
          <div>
            <h2 className="text-base font-bold">{fmt(V.title, o.dept.name)}</h2>
            <p className="mt-0.5 text-xs text-black/55">
              {V.leader}: <strong>{o.dept.lead?.fullName ?? V.vacantLeader}</strong>
              {" · "}
              {V.deputy}: <strong>{o.dept.deputyMember?.fullName ?? V.noDeputy}</strong>
            </p>
          </div>
        </div>
        <Link
          href={`/committees?dept=${o.dept.id}`}
          className="inline-flex min-h-10 items-center rounded-xl border border-black/10 px-3 text-xs font-bold hover:bg-black/[0.04]"
        >
          {V.viewCommittees}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={V.members} value={o.memberCount} />
        <Stat label={V.activeCommittees} value={o.activeCommittees} />
        <Stat label={V.closedCommittees} value={o.closedCommittees} />
        <Stat label={V.meetings30} value={o.kpis.meetingsLast30} />
        {o.tasks && (
          <>
            <Stat label={V.planOpen} value={o.tasks.planOpen} />
            <Stat label={V.planOverdue} value={o.tasks.planOverdue} tone={o.tasks.planOverdue ? "danger" : undefined} />
            <Stat label={V.committeeOpen} value={o.tasks.committeeOpen} />
            <Stat label={V.committeeOverdue} value={o.tasks.committeeOverdue} tone={o.tasks.committeeOverdue ? "danger" : undefined} />
          </>
        )}
        <Stat label={V.planVerified} value={pct(o.kpis.planVerifiedRate)} />
        <Stat label={V.committeeDone} value={pct(o.kpis.committeeDoneRate)} />
      </div>

      {(o.pendingProposals > 0 || o.unreviewedReports > 0 || o.leaderless.length > 0) && (
        <ul className="flex flex-col gap-1.5 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          {o.pendingProposals > 0 && <li>{fmt(V.pendingProposals, o.pendingProposals)}</li>}
          {o.unreviewedReports > 0 && <li>{fmt(V.unreviewedReports, o.unreviewedReports)}</li>}
          {o.leaderless.length > 0 && (
            <li>
              {V.leaderless}{" "}
              {o.leaderless.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && "، "}
                  <Link href={`/committees/${c.id}?tab=members`} className="font-bold underline">
                    {c.name}
                  </Link>
                </span>
              ))}
            </li>
          )}
        </ul>
      )}

      {/* النائب — يعيّنه القائدُ وحده، ويراه النائبُ بصلاحياته */}
      {(o.can.appointDeputy || o.dept.deputyMember) && (
        <section className="flex flex-col gap-3 rounded-2xl border border-black/5 p-4">
          <div>
            <h3 className="text-sm font-bold">{D.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-black/50">{D.hint}</p>
          </div>
          {o.dept.deputyMember && (
            <div className="flex flex-col gap-1 text-sm">
              <p>
                <strong>{o.dept.deputyMember.fullName}</strong>
                {o.dept.deputyAppointedAt && (
                  <span className="text-xs text-black/50">
                    {" · "}
                    {fmt(D.appointedBy, fmtWhen(o.dept.deputyAppointedAt, false), o.dept.deputyAppointedByName ?? "—")}
                  </span>
                )}
              </p>
              {!o.can.appointDeputy && (
                <p className="text-xs text-black/60">
                  {D.permissions}:{" "}
                  {o.dept.deputyPermissions.length
                    ? o.dept.deputyPermissions.map((p) => L.deputyPermissions[p]).join("، ")
                    : D.none}
                </p>
              )}
            </div>
          )}
          {o.can.appointDeputy && o.dept.deputyMember && (
            <div className="flex flex-col gap-3">
              {/* كلُّ صلاحيةٍ وحدها: تُمنح وتُسحب بزرّها، ويُسجَّل كلُّ تغيير */}
              <p className="text-xs text-black/50">{D.perPermissionHint}</p>
              <ul className="flex flex-col divide-y divide-black/5 rounded-xl border border-black/5">
                {DEPUTY_PERMISSIONS.map((p) => {
                  const on = o.dept.deputyPermissions.includes(p);
                  return (
                    <li key={p} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm">
                        {L.deputyPermissions[p]}
                        <span className={`ms-2 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${on ? "bg-emerald-50 text-emerald-800" : "bg-black/[0.05] text-black/55"}`}>
                          {on ? D.granted : D.notGranted}
                        </span>
                      </span>
                      <ActionForm
                        action={deputyPermissionAction}
                        submits={[{ label: on ? D.withdraw : D.grant, variant: on ? "outline" : undefined }]}
                        pendingLabel={V.saving}
                        theme={theme}
                        compact
                      >
                        <input type="hidden" name="departmentId" value={o.dept.id} />
                        <input type="hidden" name="permission" value={p} />
                        <input type="hidden" name="granted" value={on ? "0" : "1"} />
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
              <ActionForm
                action={revokeDeputyAction}
                submits={[{ label: D.revoke, variant: "outline" }]}
                pendingLabel={V.saving}
                theme={theme}
                confirm={{ title: fmt(D.revokeTitle, o.dept.deputyMember.fullName), body: D.revokeBody, confirmLabel: D.revoke }}
              >
                <input type="hidden" name="departmentId" value={o.dept.id} />
              </ActionForm>
            </div>
          )}
          {o.can.appointDeputy && (
            // نائبٌ قائم: الاستبدالُ مطويٌّ — لا قائمتا صلاحياتٍ متجاورتان تُلبسان أيّهما للحالي
            <AppointDeputy open={!o.dept.deputyMember} summary={D.replace}>
              <ActionForm action={appointDeputyAction} submits={[{ label: D.appoint }]} pendingLabel={D.appointing} theme={theme}>
                  <input type="hidden" name="departmentId" value={o.dept.id} />
                  <Field label={D.member} hint={o.dept.deputyMember ? D.replaceNote : undefined}>
                    <select name="memberId" required defaultValue="" className={inputCls}>
                      <option value="" disabled>
                        {D.choose}
                      </option>
                      {o.deputyCandidates
                        .filter((m) => m.id !== o.dept.deputyMemberId)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.fullName}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <PermissionBoxes L={L} selected={[]} />
              </ActionForm>
            </AppointDeputy>
          )}
        </section>
      )}

      {o.can.viewMembers && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">{V.membersTitle}</h3>
          {o.members.length === 0 ? (
            <p className="text-xs text-black/50">{L.notSet}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-black/5 rounded-2xl border border-black/5">
              {o.members.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {m.fullName}
                      {m.id === o.dept.deputyMemberId && (
                        <span className="ms-2 rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold">{V.deputy}</span>
                      )}
                    </p>
                    <p className="text-xs text-black/50">
                      {m.jobTitle || V.noResponsibility}
                      {m._count.committeeMemberships > 0 && ` · ${fmt(V.committeesN, m._count.committeeMemberships)}`}
                    </p>
                  </div>
                  {o.can.assignResponsibilities && (
                    <ActionForm
                      action={memberResponsibilityAction}
                      submits={[{ label: V.save, variant: "outline" }]}
                      pendingLabel={V.saving}
                      theme={theme}
                      compact
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="departmentId" value={o.dept.id} />
                      <input type="hidden" name="memberId" value={m.id} />
                      <input
                        name="responsibility"
                        defaultValue={m.jobTitle ?? ""}
                        maxLength={80}
                        aria-label={fmt("{0} — {1}", V.responsibility, m.fullName)}
                        placeholder={V.responsibility}
                        className="min-h-9 w-44 rounded-lg border border-black/10 bg-white px-2.5 text-xs outline-none focus:border-black/30"
                      />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Card>
  );
}

function PermissionBoxes({ L, selected }: { L: Dictionary["org"]; selected: string[] }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium text-black/70">{L.deputy.permissions}</legend>
      {DEPUTY_PERMISSIONS.map((p) => (
        <label key={p} className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="permissions" value={p} defaultChecked={selected.includes(p)} className="h-4 w-4" />
          {L.deputyPermissions[p]}
        </label>
      ))}
    </fieldset>
  );
}

function AppointDeputy({ open, summary, children }: { open: boolean; summary: string; children: React.ReactNode }) {
  if (open) return <>{children}</>;
  return (
    <details className="rounded-xl bg-black/[0.03] p-3">
      <summary className="cursor-pointer text-xs font-bold text-black/70">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
