"use client";

import { useActionState, useRef, useEffect, useState, useTransition } from "react";
import {
  requestCommitteeAction,
  withdrawCommitteeAction,
  inviteCommitteeLeadAction,
} from "./actions";
import { Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";

import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
/** لجانُ القسم — في لوحة قائده، حيث يملك القرار.
 *
 *  والبطاقةُ تقول في كل حالٍ ما الخطوةُ التالية بلا أن يُسأل أحد:
 *  المقترحةُ «تنتظر الاعتماد»، والمردودةُ تُظهر سببَها، والمعتمدةُ
 *  الشاغرةُ تفتح نموذجَ دعوةِ قائدها، والعاملةُ تُسمّي قائدَها وعدد
 *  أعضائها ورابطَ لوحتها.
 */

export type CommitteeRow = {
  id: string;
  name: string;
  slug: string;
  colorHex: string;
  leadTitle: string | null;
  committeeStatus: "pending_review" | "approved" | "rejected" | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  lead: { id: string; fullName: string; jobTitle: string | null } | null;
  memberCount: number;
  subCommitteeCount: number;
};

export function CommitteesPanel({
  parentId,
  parentName,
  parentColorHex,
  committees,
  theme,
  canPropose,
}: {
  parentId: string;
  parentName: string;
  /** لونُ القسم — ولجانُه تأخذه، ويُميّزها شكلُها لا لونُها */
  parentColorHex: string;
  committees: CommitteeRow[];
  theme: ReturnType<typeof themeFromColor>;
  canPropose: boolean;
}) {
  const L = useTranslations().rDeptCommittees;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-bold">{fmt(L.committeesWithin, parentName)}</h2>
        <p className="mt-1 text-xs leading-relaxed text-black/50">{L.aCommitteeIsA}<strong>{L.itsColourIsYour}</strong>{L.soItBelongsTo}</p>
      </div>

      {committees.length > 0 && (
        <ul className="flex flex-col gap-3">
          {committees.map((c) => (
            <CommitteeCard key={c.id} committee={c} theme={theme} canManage={canPropose} />
          ))}
        </ul>
      )}

      {canPropose && (
        <ProposeForm parentId={parentId} theme={theme} parentColorHex={parentColorHex} />
      )}
    </div>
  );
}

function StatusChip({ status }: { status: CommitteeRow["committeeStatus"] }) {
  const L = useTranslations().rDeptCommittees;
  const map = {
    pending_review: { label: L.awaitingCeoApproval, cls: "bg-amber-100 text-amber-900" },
    approved: { label: L.approvedAndOpen, cls: "bg-emerald-100 text-emerald-900" },
    rejected: { label: L.notApproved, cls: "bg-red-50 text-red-700" },
  } as const;
  const s = map[status ?? "pending_review"];
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${s.cls}`}>{s.label}</span>;
}

function CommitteeCard({
  committee: c,
  theme,
  canManage,
}: {
  committee: CommitteeRow;
  theme: ReturnType<typeof themeFromColor>;
  canManage: boolean;
}) {
  const L = useTranslations().rDeptCommittees;
  const [inviting, setInviting] = useState(false);
  const [removing, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const leadLabel = c.leadTitle?.trim() || fmt(L.committeeLead, c.name);
  // الساكنةُ وحدها تُزال من هنا: المفتوحةُ قسمٌ عاملٌ يمرّ بشروط الحذف
  const removable = canManage && c.committeeStatus !== "approved";
  // الدعوةُ لمقعدٍ شاغرٍ في لجنةٍ مفتوحة. وشرطُها يُحسَب مرّةً ويُستعمل
  // مرّتين: في الزرّ وفي صفّ الأزرار نفسه — وإلا رُسم صفٌّ بحدٍّ علويٍّ
  // لا شيء فيه. (رأيتُه مرسوماً في لقطةٍ قبل أن يراه أحد.)
  const canInviteLead = canManage && c.committeeStatus === "approved" && !c.lead;

  return (
    <li className="rounded-2xl border border-black/5 p-3.5">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 h-9 w-9 shrink-0 rounded-xl"
          style={{ background: c.colorHex }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{fmt(L.committee, c.name)}</h3>
            <StatusChip status={c.committeeStatus} />
          </div>
          <p className="mt-0.5 text-xs text-black/45">
            {leadLabel}
            {c.lead ? ` · ${c.lead.fullName}` : L.positionVacant}
            {c.committeeStatus === "approved" && fmt(L.members, c.memberCount)}
            {c.subCommitteeCount > 0 && fmt(L.subCommittees, c.subCommitteeCount)}
          </p>
          {c.committeeStatus === "pending_review" && c.requestedByName && (
            <p className="mt-1 text-xs text-black/40">{fmt(L.proposedBy, c.requestedByName)}</p>
          )}
          {c.committeeStatus === "rejected" && c.decisionNote && (
            <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs leading-relaxed text-red-700">{L.reasonForReturnFrom}{c.decidedByName ?? L.management}: {c.decisionNote}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {(removable || canInviteLead) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
          {canInviteLead && (
            <Button theme={theme} variant="outline" onClick={() => setInviting((v) => !v)}>
              {inviting ? L.cancel : L.inviteTheCommitteeLead}
            </Button>
          )}
          {removable && (
            <Button
              theme={theme}
              variant="ghost"
              disabled={removing}
              onClick={() =>
                startRemoving(async () => {
                  setError(null);
                  const res = await withdrawCommitteeAction(c.id);
                  if (res.error) setError(res.error);
                })
              }
            >
              {removing
                ? L.removing
                : c.committeeStatus === "rejected"
                  ? L.removeTheReturnedProposal
                  : L.withdrawTheProposal}
            </Button>
          )}
        </div>
      )}

      {inviting && c.committeeStatus === "approved" && (
        <div className="mt-3 rounded-xl bg-black/[0.03] p-3">
          <InviteLeadForm committee={c} theme={theme} leadLabel={leadLabel} />
        </div>
      )}
    </li>
  );
}

function InviteLeadForm({
  committee,
  theme,
  leadLabel,
}: {
  committee: CommitteeRow;
  theme: ReturnType<typeof themeFromColor>;
  leadLabel: string;
}) {
  const L = useTranslations().rDeptCommittees;
  const [state, formAction, pending] = useActionState(inviteCommitteeLeadAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  if (state.success && state.credentials && state.credentials.tempPassword !== dismissed) {
    return (
      <CredentialsReveal
        email={state.credentials.email}
        tempPassword={state.credentials.tempPassword}
        theme={theme}
        onClose={() => setDismissed(state.credentials!.tempPassword)}
      />
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="committeeId" value={committee.id} />
      <p className="text-xs leading-relaxed text-black/50">{L.theyWillJoinWith}<strong>{leadLabel}</strong>{L.theTitleApprovedWith}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.fullName}</span>
          <input
            name="fullName"
            required
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.email}</span>
          <input
            name="email"
            type="email"
            required
            dir="ltr"
            placeholder="lead@email.com"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div>
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? L.creatingTheAccount : L.createTheCommitteeLead}
        </Button>
      </div>
    </form>
  );
}

function ProposeForm({
  parentId,
  theme,
  parentColorHex,
}: {
  parentId: string;
  theme: ReturnType<typeof themeFromColor>;
  parentColorHex: string;
}) {
  const L = useTranslations().rDeptCommittees;
  const [state, formAction, pending] = useActionState(requestCommitteeAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [handledSuccess, setHandledSuccess] = useState(false);

  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {state.success && state.message && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {state.message}
          </p>
        )}
        <div>
          <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>{L.proposeANewCommittee}</Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-2xl bg-black/[0.03] p-3.5">
      <input type="hidden" name="parentId" value={parentId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.committeeName}</span>
          <input
            name="name"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={L.eGDevelopment}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs text-black/45">{fmt(L.shownAsCommittee, name.trim() || "...")}</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{L.leadTitle}</span>
          <input
            name="leadTitle"
            maxLength={60}
            placeholder={fmt(L.committeeLead, name.trim() || "...")}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs text-black/45">{L.leaveItEmptyTo}</span>
        </label>
      </div>

      {/* معاينةُ ما سيُرسَم: لونُ القسم، وشكلُ اللجنة — لا مُنتقي ألوان.
          فاللونُ لم يعد خياراً، والمعاينةُ تُغني عن شرحٍ طويل. */}
      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium text-black/70">{L.howItWillAppear}</span>
        <div className="flex items-center gap-2">
          <span
            className="rounded-xl border-dashed px-3 py-1.5 text-xs font-bold"
            style={{
              background: `${parentColorHex}14`,
              border: `1.5px dashed ${parentColorHex}`,
            }}
          >
            {fmt(L.committee, name.trim() || "...")}</span>
          <span className="text-xs text-black/45">{L.inYourDepartmentS}</span>
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? L.sending : L.sendTheProposalTo}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>{L.cancel}</Button>
      </div>
    </form>
  );
}
