"use client";

import { useState, useTransition } from "react";
import {
  submitPeriodAction,
  approvePeriodAction,
  beginReviewAction,
  completeReviewAction,
  openPeriodAction,
  reopenPeriodAction,
} from "@/app/admin/execution/actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** أزرارُ آلةِ حالة الأسبوع — ولكلِّ حالةٍ خطوتُها التالية وحدها.
 *
 *  **ولا زرَّ عامّاً اسمه «تخطَّ» أو «أكمِل الكلّ»:** كلُّ زرٍّ هنا
 *  إجراءٌ واحدٌ معلومُ الأثر. والفتحُ قبل اكتمال المراجعة يَفتح حقلَ
 *  سببٍ أولاً — فالاستثناءُ يُكتَب لا يُضغَط.
 */

const STATE_TEXT: Record<string, { label: string; hint: string }> = {
  draft: {
    label: "قيد البناء",
    hint: "تُبنى خططُ الأقسام ومهامُّها. ولا يُكتَب فيها تنفيذٌ قبل الفتح.",
  },
  submitted: {
    label: "مرفوعةٌ للمراجعة",
    hint: "رُفعت للمراجعة التنفيذية — تُعتمَد للعرض في اجتماع السبت.",
  },
  approved_for_review: {
    label: "معتمَدةٌ للعرض",
    hint: "تُعرَض في الاجتماع. ابدأ المراجعةَ عند انعقاده.",
  },
  awaiting_review: {
    label: "المراجعةُ جارية",
    hint: "اقضِ في التسليمات والمعوّقات، ثم أعلِن اكتمالها — أو افتح الأسبوع استثناءً بسببٍ مكتوب.",
  },
  awaiting_opening: {
    label: "بانتظار إذن الفتح",
    hint: "اكتملت المراجعة. الفتحُ قرارُك الصريح — ولا يقع بمرور التقويم.",
  },
  open: { label: "مفتوحةٌ للتنفيذ", hint: "يُكتَب فيها التنفيذُ والتسليمات." },
  closed: {
    label: "مُغلقة",
    hint: "رُحِّل ما لم يكتمل إلى الأسبوع التالي بمعرّفاته وتاريخه.",
  },
  reopened: { label: "أُعيد فتحُها باستثناء", hint: "فُتحت ثانيةً بسببٍ مسجَّل." },
};

export function PeriodControls({
  periodId,
  state,
  canGovern,
  unresolved,
  theme,
}: {
  periodId: string;
  state: string;
  canGovern: boolean;
  /** كم بنداً ينتظر قراراً في المراجعة — يُقال قبل الفتح لا بعده */
  unresolved: number;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "emergency" | "reopen">(null);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ error: string | null; message?: string }>) {
    start(async () => {
      setError(null);
      setMessage(null);
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setMessage(res.message ?? null);
        setPanel(null);
        setReason("");
      }
    });
  }

  const text = STATE_TEXT[state] ?? { label: state, hint: "" };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">حالةُ الأسبوع:</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              state === "open" || state === "reopened"
                ? "bg-emerald-100 text-emerald-900"
                : state === "closed"
                  ? "bg-black/[0.06] text-black/60"
                  : "bg-amber-100 text-amber-900"
            }`}
          >
            {text.label}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-black/50">{text.hint}</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</p>
      )}

      {canGovern && (
        <div className="flex flex-wrap gap-2">
          {state === "draft" && (
            <Button theme={theme} disabled={pending} onClick={() => run(() => submitPeriodAction(periodId))}>
              ارفعها للمراجعة
            </Button>
          )}
          {state === "submitted" && (
            <Button theme={theme} disabled={pending} onClick={() => run(() => approvePeriodAction(periodId))}>
              اعتمِدها للعرض
            </Button>
          )}
          {state === "approved_for_review" && (
            <Button theme={theme} disabled={pending} onClick={() => run(() => beginReviewAction(periodId))}>
              ابدأ المراجعة
            </Button>
          )}
          {state === "awaiting_review" && (
            <>
              <Button
                theme={theme}
                disabled={pending}
                onClick={() => run(() => completeReviewAction(periodId))}
              >
                أعلِن اكتمال المراجعة
                {unresolved > 0 ? ` (${unresolved} معلَّق)` : ""}
              </Button>
              <Button
                theme={theme}
                variant="ghost"
                onClick={() => setPanel(panel === "emergency" ? null : "emergency")}
              >
                افتح استثناءً
              </Button>
            </>
          )}
          {state === "awaiting_opening" && (
            <Button theme={theme} disabled={pending} onClick={() => run(() => openPeriodAction(periodId))}>
              افتح الأسبوع للتنفيذ
            </Button>
          )}
          {state === "closed" && (
            <Button theme={theme} variant="outline" onClick={() => setPanel(panel === "reopen" ? null : "reopen")}>
              أعِد فتحَها باستثناء
            </Button>
          )}
        </div>
      )}

      {panel === "emergency" && (
        <div className="flex flex-col gap-2.5 rounded-xl bg-amber-50 p-3">
          <p className="text-xs leading-relaxed text-amber-900">
            المراجعةُ لم تكتمل{unresolved > 0 ? ` — وبقي ${unresolved} بنداً بلا قرار` : ""}.
            والفتحُ الآن استثناء: <strong>لا يَمحو ما بقي</strong>، بل يُسجَّل عددُه وسببُه،
            وتبقى البنودُ قائمةً تُرحَّل.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="سببُ الفتح قبل اكتمال المراجعة — إلزامي"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !reason.trim()}
              onClick={() => run(() => openPeriodAction(periodId, reason))}
            >
              افتحه استثناءً
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setPanel(null)}>
              تراجع
            </Button>
          </div>
        </div>
      )}

      {panel === "reopen" && (
        <div className="flex flex-col gap-2.5 rounded-xl bg-amber-50 p-3">
          <p className="text-xs leading-relaxed text-amber-900">
            إعادةُ الفتح تُعَدّ وتُسجَّل بسببها — وما رُحِّل منها لا يعود.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="سببُ إعادة الفتح — إلزامي"
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              theme={theme}
              disabled={pending || !reason.trim()}
              onClick={() => run(() => reopenPeriodAction(periodId, reason))}
            >
              أعِد الفتح
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setPanel(null)}>
              تراجع
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
