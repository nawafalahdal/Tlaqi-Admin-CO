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

const SWATCHES = ["#1F6F8B", "#7A4EAB", "#B38B2D", "#3F7D20", "#C2185B", "#0F766E"];

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
  /** لونُ القسم نفسه — يُمنَع على لجانه، والواجهةُ تُعلن المنعَ قبل الضغط */
  parentColorHex: string;
  committees: CommitteeRow[];
  theme: ReturnType<typeof themeFromColor>;
  canPropose: boolean;
}) {
  // **الواجهةُ تُطعَم الحرسَ نفسَه الذي يفرضه الخادم:** الألوان المأخوذة
  // تُعطَّل في اللوحة ولا يُنتظَر بها رفضٌ بعد الإرسال.
  const taken = new Set(
    [parentColorHex, ...committees.map((c) => c.colorHex)].map((c) => c.toLowerCase())
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-bold">اللجان داخل {parentName}</h2>
        <p className="mt-1 text-xs leading-relaxed text-black/50">
          اللجنة قسمٌ داخل قسمك: لها اسمُها ولونُها ومسمّى قائدها، ولقائدها لوحةٌ ودعواتٌ وبنك
          أسئلةٍ كلوحتك — في نطاق لجنته وحدها. ولا تُفتح باقتراحها: القرار للمدير التنفيذي، وما لم
          يُعتمد لا يظهر في الهيكل ولا تُوجَّه إليه تذكرةٌ ولا يُدعى له أحد.
        </p>
      </div>

      {committees.length > 0 && (
        <ul className="flex flex-col gap-3">
          {committees.map((c) => (
            <CommitteeCard key={c.id} committee={c} theme={theme} canManage={canPropose} />
          ))}
        </ul>
      )}

      {canPropose && <ProposeForm parentId={parentId} theme={theme} taken={taken} />}
    </div>
  );
}

function StatusChip({ status }: { status: CommitteeRow["committeeStatus"] }) {
  const map = {
    pending_review: { label: "بانتظار اعتماد التنفيذي", cls: "bg-amber-100 text-amber-900" },
    approved: { label: "معتمدة ومفتوحة", cls: "bg-emerald-100 text-emerald-900" },
    rejected: { label: "لم تُعتمد", cls: "bg-red-50 text-red-700" },
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
  const [inviting, setInviting] = useState(false);
  const [removing, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const leadLabel = c.leadTitle?.trim() || `قائد لجنة ${c.name}`;
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
            <h3 className="text-sm font-bold">لجنة {c.name}</h3>
            <StatusChip status={c.committeeStatus} />
          </div>
          <p className="mt-0.5 text-xs text-black/45">
            {leadLabel}
            {c.lead ? ` · ${c.lead.fullName}` : " · المنصب شاغر"}
            {c.committeeStatus === "approved" && ` · الأعضاء: ${c.memberCount}`}
            {c.subCommitteeCount > 0 && ` · لجان فرعية: ${c.subCommitteeCount}`}
          </p>
          {c.committeeStatus === "pending_review" && c.requestedByName && (
            <p className="mt-1 text-xs text-black/40">اقترحها {c.requestedByName}</p>
          )}
          {c.committeeStatus === "rejected" && c.decisionNote && (
            <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs leading-relaxed text-red-700">
              سببُ الردّ من {c.decidedByName ?? "الإدارة"}: {c.decisionNote}
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
              {inviting ? "إلغاء" : "ادعُ قائد اللجنة"}
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
                ? "جارٍ الإزالة..."
                : c.committeeStatus === "rejected"
                  ? "أزِل المردودة"
                  : "اسحب الاقتراح"}
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
      <p className="text-xs leading-relaxed text-black/50">
        سيدخل بمسمّى <strong>{leadLabel}</strong> — وهو المسمّى المُقَرّ عند اعتماد اللجنة، لا
        يُكتب من هنا. ويمرّ باختبار القادة نفسه، ثم يصير قائداً للجنته: يدعو أعضاءها ويملأ بنك
        أسئلتهم ويُدير تذاكرها.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الاسم الكامل</span>
          <input
            name="fullName"
            required
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">البريد الإلكتروني</span>
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
          {pending ? "جارٍ إنشاء الحساب..." : "أنشئ حساب قائد اللجنة"}
        </Button>
      </div>
    </form>
  );
}

function ProposeForm({
  parentId,
  theme,
  taken,
}: {
  parentId: string;
  theme: ReturnType<typeof themeFromColor>;
  taken: Set<string>;
}) {
  const [state, formAction, pending] = useActionState(requestCommitteeAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  // اللونُ الأول الحرّ لا الأول مطلقاً: فلا يُفتَح النموذجُ على لونٍ
  // مرفوضٍ سلفاً يُرسَل ثم يُرَدّ
  const [color, setColor] = useState(
    SWATCHES.find((c) => !taken.has(c.toLowerCase())) ?? SWATCHES[0]
  );
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
          <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
            اقترح لجنة جديدة
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-2xl bg-black/[0.03] p-3.5">
      <input type="hidden" name="parentId" value={parentId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">اسم اللجنة</span>
          <input
            name="name"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: التطوير"
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs text-black/45">تُعرض «لجنة {name.trim() || "..."}»</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">مسمّى قائدها</span>
          <input
            name="leadTitle"
            maxLength={60}
            placeholder={`قائد لجنة ${name.trim() || "..."}`}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs text-black/45">
            اتركه فارغاً فيُشتقّ من اسمها. وهو ما يحمله قائدها في الهيكل وفي بطاقته.
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium text-black/70">لون اللجنة</span>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => {
            const used = taken.has(c.toLowerCase());
            return (
              <button
                key={c}
                type="button"
                disabled={used}
                onClick={() => setColor(c)}
                aria-label={used ? `${c} — مأخوذ` : c}
                title={used ? "هذا اللون مأخوذ في هذا القسم" : c}
                className={`h-9 w-9 rounded-full border-2 transition-transform ${
                  color === c ? "scale-110 border-black/60" : "border-black/10"
                } ${used ? "cursor-not-allowed opacity-25" : ""}`}
                style={{ background: c }}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-black/10 bg-white p-1"
          />
          <input
            name="colorHex"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            dir="ltr"
            pattern="#[0-9a-fA-F]{6}"
            required
            className="min-h-11 w-32 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
        </div>
        {taken.has(color.toLowerCase()) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            هذا اللون مأخوذ في هذا القسم — اختر غيره قبل الإرسال.
          </p>
        )}
        <span className="text-xs leading-relaxed text-black/45">
          ولا بدّ أن يختلف عن لون قسمك وعن ألوان لجانه: اللجنة تُقرأ في الهيكل بلونها، فلونٌ
          مكرَّرٌ يجعلها تبدو امتداداً لغيرها.
        </span>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending || taken.has(color.toLowerCase())}>
          {pending ? "جارٍ الإرسال..." : "أرسل الاقتراح للتنفيذي"}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
