"use client";

import { useState, useTransition } from "react";
import { decideApprovalAction } from "./actions";
import { Button } from "@/components/ui";

/** قرارُ المعتمِد — والاعتماد لا يقع بضغطةٍ واحدة.
 *
 *  **نافذةُ التأكيد ليست تزييناً.** الاعتماد يُطلِق التنفيذ ويُسجَّل
 *  باسم المعتمِد ووقته، فالضغطة الخاطئة تُجيز عملاً لم يُراجَع. فتُعرَض
 *  خطوةٌ ثانية تقول: هذا الطلب، ومن رفعه، وأن الاعتماد يُجيز الانتقال
 *  إلى التنفيذ — ثم «تأكيد الاعتماد» أو «إلغاء».
 *
 *  والردّ والرفض يُلزمان بملاحظة، والخادم يُلزم بها أيضاً: الواجهة
 *  تُعطّل الزرّ، والخادم يرفض — فالحرس في الموضعين.
 */
export function ApprovalDecide({
  ticketId,
  ticketNumber,
  subject,
  requesterName,
  isReviewing,
  theme,
}: {
  ticketId: string;
  ticketNumber: number;
  subject: string;
  requesterName: string;
  isReviewing: boolean;
  theme: Parameters<typeof Button>[0]["theme"];
}) {
  const [panel, setPanel] = useState<"none" | "approve" | "return" | "reject">("none");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(decision: "reviewing" | "approved" | "returned" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await decideApprovalAction(ticketId, decision, note);
      if (res.error) {
        setError(res.error);
        return;
      }
      setPanel("none");
      setNote("");
      setDone(
        decision === "approved"
          ? res.nextApproverName
            ? `اعتمدتَه — وانتقل إلى ${res.nextApproverName} لاستكمال الموافقات`
            : "اعتمدتَه نهائياً — وصاحبه يستطيع الانتقال إلى التنفيذ"
          : decision === "returned"
            ? "أُعيد لصاحبه للتعديل"
            : decision === "rejected"
              ? "رُفض الطلب وسُجِّل السبب"
              : "صار «قيد المراجعة»"
      );
    });
  }

  if (done) {
    return (
      <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold leading-relaxed text-green-800">
        {done}
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      {panel === "none" && (
        <div className="flex flex-wrap gap-2">
          <Button theme={theme} disabled={pending} onClick={() => setPanel("approve")}>
            اعتماد الطلب
          </Button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setNote("");
              setPanel("return");
            }}
            className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 px-4 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >
            إعادة للتعديل
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setNote("");
              setPanel("reject");
            }}
            className="inline-flex min-h-11 items-center rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"
          >
            رفض الطلب
          </button>
          {!isReviewing && (
            <Button theme={theme} variant="ghost" disabled={pending} onClick={() => run("reviewing")}>
              أدرسه الآن
            </Button>
          )}
        </div>
      )}

      {/* خطوة التأكيد — الاعتماد لا يقع بضغطةٍ واحدة */}
      {panel === "approve" && (
        <div className="flex flex-col gap-3 rounded-2xl bg-green-50/70 p-4 ring-1 ring-green-200">
          <p className="text-xs font-bold text-green-900">تأكيد الاعتماد</p>
          <p className="text-xs leading-relaxed text-green-900/80">
            أنت على وشك اعتماد <strong>#{ticketNumber} — {subject}</strong> المرفوع من{" "}
            <strong>{requesterName}</strong>. والاعتماد يُجيز لصاحبه الانتقال إلى التنفيذ، ويُسجَّل
            باسمك ووقته في سجلّ الطلب.
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">ملاحظة (اختيارية)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="rounded-xl border border-green-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400"
            />
          </label>
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run("approved")}
              className="inline-flex min-h-11 items-center rounded-xl bg-green-700 px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {pending ? "جارِ الاعتماد..." : "تأكيد الاعتماد"}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setPanel("none")}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {(panel === "return" || panel === "reject") && (
        <div
          className={`flex flex-col gap-3 rounded-2xl p-4 ring-1 ${
            panel === "return" ? "bg-amber-50/70 ring-amber-200" : "bg-red-50/70 ring-red-200"
          }`}
        >
          <p className="text-xs font-bold text-black/75">
            {panel === "return" ? "إعادة الطلب للتعديل" : "رفض الطلب"}
          </p>
          <p className="text-xs leading-relaxed text-black/60">
            {panel === "return"
              ? "اكتب ما تريد تعديله — يصل صاحبَ الطلب ويستطيع تعديله وإعادة إرساله."
              : "اكتب سبب الرفض — يُسجَّل في سجلّ الطلب ويصل صاحبَه."}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={panel === "return" ? "ما ينبغي تعديله..." : "سبب الرفض..."}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          />
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || note.trim().length < 5}
              onClick={() => run(panel === "return" ? "returned" : "rejected")}
              className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50 ${
                panel === "return" ? "bg-amber-700" : "bg-red-700"
              }`}
            >
              {pending ? "جارِ التنفيذ..." : panel === "return" ? "أعِده للتعديل" : "ارفض الطلب"}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setPanel("none")}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
