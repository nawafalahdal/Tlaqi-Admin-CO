"use client";

import { useActionState, useState, useTransition } from "react";
import {
  stepDownMemberAction,
  markOffboardingStepAction,
  closeOffboardingAction,
} from "./actions";
import { Card, Button } from "@/components/ui";
import { useLocale } from "@/i18n/LocaleProvider";
import { dayCount } from "@/lib/dayCount";
import type { themeFromColor } from "@/lib/brand";

export type OffboardingMember = {
  id: string;
  fullName: string;
  email: string;
  warningsCount: number;
  stepDownAt: string | null;
  stepDownByName: string | null;
  endDate: string | null;
  certificateAt: string | null;
  farewellAt: string | null;
  closedAt: string | null;
  /** بدايةُ مسيرته (ISO) — يُقاس بها تاريخُ الانتهاء المختار قبل التنحية */
  serviceStart: string;
  /** أتستحقّ مسيرتُه شهادة الشكر والخبرة؟ — من الخادم (`earnsFinalCertificate`) */
  earnsCertificate: boolean;
  /** أيامُ مسيرته كما تُحسب للشهادة */
  serviceDays: number;
};

/** حوكمة الأسبوعين — الحدُّ نفسُه الذي يفرضه الخادم (`MIN_SERVICE_DAYS_FOR_CERTIFICATE`) */
const MIN_DAYS = 14;

/** حوكمة الخروج على بطاقة واحدة.
 *
 *  الخطوات الأربع مرئية دائماً بترتيبها — تنحٍّ، شهادة، وداع، ختام —
 *  فيُرى ما بقي بدل أن يُنسى في سجلٍّ لا يفتحه أحد. والختام لا يُفتح إلا
 *  بعد الشهادة والوداع معاً: هذا الشرط هو ما يمنعه أن يصير طريقاً
 *  مختصراً للتخلّص من السجل. */
export function OffboardingPanel({
  member,
  theme,
}: {
  member: OffboardingMember;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const { t: dict, locale } = useLocale();
  const t = dict.offboarding;
  const [panel, setPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [state, formAction, formPending] = useActionState(stepDownMemberAction, {
    error: null,
    success: false,
  });
  // تاريخُ الانتهاء المختار: يُقال قبل التنفيذ إن كانت المسيرة دون أسبوعين
  const [endPick, setEndPick] = useState("");
  const pickedDays = endPick
    ? Math.floor((new Date(endPick).getTime() - new Date(member.serviceStart).getTime()) / 86_400_000)
    : null;

  // من خرج خلال أول أسبوعين لا شهادة له — فالخطوةُ تُذكَر ولا تُنتظَر
  const noCertificate = !member.earnsCertificate && !member.certificateAt;
  const steps = [
    { done: Boolean(member.stepDownAt), label: t.stepStepDown, at: member.stepDownAt },
    noCertificate
      ? { done: true, waived: true, label: t.noCertificateStep, at: null }
      : { done: Boolean(member.certificateAt), label: t.stepCertificate, at: member.certificateAt },
    { done: Boolean(member.farewellAt), label: t.stepFarewell, at: member.farewellAt },
    { done: Boolean(member.closedAt), label: t.stepClosed, at: member.closedAt },
  ];

  function mark(step: "certificate" | "farewell") {
    setError(null);
    startTransition(async () => {
      const res = await markOffboardingStepAction(member.id, step);
      if (res.error) setError(res.error);
    });
  }

  function close() {
    setError(null);
    startTransition(async () => {
      const res = await closeOffboardingAction(member.id);
      if (res.error) setError(res.error);
    });
  }

  // لم يُنحَّ بعد: لا يُعرض إلا زرّ البدء، وبجانبه عدّاد تنبيهاته ليكون
  // القرار على بيّنة لا على انطباع
  if (!member.stepDownAt) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold">{member.fullName}</p>
            <p className="mt-0.5 break-all text-xs text-black/45" dir="ltr">
              {member.email}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
              member.warningsCount >= 3 ? "bg-red-50 text-red-700" : "bg-black/[0.05] text-black/60"
            }`}
          >
            {t.warnings}: {member.warningsCount} / 3
          </span>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {state.error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
        )}

        {panel ? (
          <form action={formAction} className="mt-3 flex flex-col gap-3 border-t border-black/5 pt-3">
            <input type="hidden" name="memberId" value={member.id} />
            <p className="text-xs leading-relaxed text-black/50">{t.stepDownHint}</p>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-black/70">{t.endDateLabel}</span>
              <input
                type="date"
                name="endDate"
                required
                dir="ltr"
                value={endPick}
                onChange={(e) => setEndPick(e.target.value)}
                className="min-h-11 rounded-xl border border-black/10 px-3.5 text-sm outline-none focus:border-black/30"
              />
              <span className="text-xs text-black/45">{t.endDateHint}</span>
              {pickedDays !== null && pickedDays < MIN_DAYS && (
                <span role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                  {t.earlyExitWarning.replace("{days}", dayCount(pickedDays, locale))}
                </span>
              )}
            </label>
            <textarea
              name="reason"
              required
              rows={2}
              placeholder={t.reasonPlaceholder}
              className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" theme={theme} disabled={formPending}>
                {formPending ? t.working : t.stepDownConfirm}
              </Button>
              <Button type="button" theme={theme} variant="ghost" onClick={() => setPanel(false)}>
                {dict.common.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setPanel(true)}
            className="mt-3 min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            {t.stepDownTitle}
          </button>
        )}
      </Card>
    );
  }

  const ready = Boolean((member.certificateAt || noCertificate) && member.farewellAt) && !member.closedAt;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold">{member.fullName}</p>
          <p className="mt-0.5 break-all text-xs text-black/45" dir="ltr">
            {member.email}
          </p>
          {member.endDate && (
            <p className="mt-0.5 text-xs text-black/45">
              {t.endsOn}: {member.endDate}
              {member.stepDownByName ? ` · ${t.byWhom}: ${member.stepDownByName}` : ""}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
            member.closedAt ? "bg-black/[0.05] text-black/55" : "bg-[#FFF1DE] text-[#8A5A00]"
          }`}
        >
          {member.closedAt ? t.badgeClosed : t.badgeOpen}
        </span>
      </div>

      {/* الخطوات بترتيبها: ما تمّ وما بقي، بتواريخه */}
      <ol className="mt-3 flex flex-col gap-1.5 border-t border-black/5 pt-3">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-xs">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                "waived" in s
                  ? "bg-amber-100 text-amber-800"
                  : s.done
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-black/[0.06] text-black/35"
              }`}
            >
              {"waived" in s ? "—" : s.done ? "✓" : "·"}
            </span>
            <span className={"waived" in s ? "text-amber-900" : s.done ? "text-black/70" : "text-black/40"}>
              {s.label}
              {s.at ? ` — ${s.at}` : ""}
            </span>
          </li>
        ))}
      </ol>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {!member.closedAt && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-black/5 pt-3">
          {!member.certificateAt && !noCertificate && (
            <Button theme={theme} variant="outline" disabled={pending} onClick={() => mark("certificate")}>
              {t.markCertificate}
            </Button>
          )}
          {!member.farewellAt && (
            <Button theme={theme} variant="outline" disabled={pending} onClick={() => mark("farewell")}>
              {t.markFarewell}
            </Button>
          )}
          {ready && (
            <Button theme={theme} disabled={pending} onClick={close}>
              {pending ? t.working : t.closeConfirm}
            </Button>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-black/5 pt-3 text-xs leading-relaxed text-black/45">
        {member.closedAt ? t.closedNote : ready ? t.readyNote : noCertificate ? t.pendingNoteNoCert : t.pendingNote}
      </p>
      {/* حوكمة الأسبوعين مكتوبةٌ على بطاقته بعدد أيامه — لا يُظَنّ نسياناً */}
      {noCertificate && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t.noCertificateNote.replace("{days}", dayCount(member.serviceDays, locale))}
        </p>
      )}
    </Card>
  );
}
