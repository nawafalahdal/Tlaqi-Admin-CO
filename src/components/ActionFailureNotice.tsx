"use client";

import { useEffect, useState } from "react";
import { ACTION_FAILURE_EVENT, type ActionFailureKind } from "@/lib/actionGuard";

const LABELS = {
  ar: { reload: "تحديث الصفحة", dismiss: "إغلاق" },
  en: { reload: "Refresh the page", dismiss: "Dismiss" },
} as const;

/** **شريطُ فشل الإرسال** — يظهر حين يفشل نقلُ إجراءٍ إلى الخادم (`guardAction`): صفحةٌ من نسخةٍ سابقة أو انقطاع.
 *  يقول ما حدث، وأحُفظ شيءٌ أم لا، ويعطي زرَّ تحديث الصفحة — بدل صفحة الخطأ الكاملة. ويبقى ما كُتب في النموذج
 *  كما هو حتى يختار صاحبُه التحديث. */
export function ActionFailureNotice() {
  const [failure, setFailure] = useState<{ kind: ActionFailureKind; message: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ kind: ActionFailureKind; message: string }>).detail;
      if (d?.message) setFailure(d);
    };
    window.addEventListener(ACTION_FAILURE_EVENT, on);
    return () => window.removeEventListener(ACTION_FAILURE_EVENT, on);
  }, []);
  if (!failure) return null;
  const t = LABELS[typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "ar"];
  return (
    <div
      role="alert"
      data-testid="action-failure"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-lg sm:flex-row sm:items-center"
    >
      <p className="flex-1 leading-relaxed">{failure.message}</p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-10 rounded-xl bg-amber-900 px-4 text-sm font-semibold text-white"
        >
          {t.reload}
        </button>
        <button type="button" onClick={() => setFailure(null)} className="min-h-10 rounded-xl px-3 text-sm text-amber-900">
          {t.dismiss}
        </button>
      </div>
    </div>
  );
}
