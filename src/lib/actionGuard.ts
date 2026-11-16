"use client";

import { unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";

/** **حارسُ استدعاء إجراءات الخادم من المتصفح** (البند ٤: خطأ إضافة الالتزام).
 *
 *  السببُ الجذري: إجراءُ الخادم يُستدعى بمعرّفٍ يتغيّر مع كل بناء. فصفحةٌ فُتحت قبل نشرٍ جديد تطلب إجراءً لم يعد
 *  موجوداً، فيرمي Next خطأ `UnrecognizedActionError` — وكذلك انقطاعُ الشبكة — ويحمله React إلى صفحة الخطأ كاملةً،
 *  فيظنّ صاحبُ النموذج أن المنصة تعطّلت ولا يعرف أحُفظ ما أرسله أم لا. والخطأ لا يصل الخادمَ فلا أثر له في سجلّاته.
 *
 *  الحارسُ يلتقط **فشلَ النقل وحده** ويعيده نتيجةً عادية فيها `error` يعرضها النموذجُ في مكانه، ويُعلن الفشلَ لشريطٍ
 *  عامّ فيه زرُّ تحديث الصفحة (`ActionFailureNotice`) — فيُرى حتى في نموذجٍ لا يعرض `error`.
 *  - **التوجيهُ (`redirect`) والإشعاراتُ الداخلية تمرّ كما هي** (`unstable_rethrow`): ليست فشلاً.
 *  - **ما رماه الخادمُ نفسُه** (يحمل `digest`) يُقال بمعرّفه — ليُبلَّغ به.
 *  - لا يُعيد المحاولةَ من تلقائه: ما لا يُعرف أوصل أم لا لا يُكرَّر صامتاً (والالتزامُ يحمل مفتاحَ منع التكرار). */

export type ActionFailureKind = "stale" | "network" | "server";

export const ACTION_FAILURE_EVENT = "tlaqi:action-failure";

const TEXT = {
  ar: {
    stale: "صدر تحديثٌ للمنصة منذ فتحتَ هذه الصفحة، فلم يصل طلبُك ولم يُحفظ شيء. حدّث الصفحة ثم أعد المحاولة.",
    network: "تعذّر الاتصال بالمنصة، فقد لا يكون طلبُك وصل. حدّث الصفحة وتحقّق قبل أن تعيده.",
    server: "تعذّر إتمام الطلب في المنصة. حدّث الصفحة وأعد المحاولة، وإن تكرّر فأبلغ بالرمز",
  },
  en: {
    stale: "The platform was updated since you opened this page, so your request did not arrive and nothing was saved. Refresh the page and try again.",
    network: "Could not reach the platform, so your request may not have arrived. Refresh the page and check before sending it again.",
    server: "The request could not be completed. Refresh the page and try again; if it repeats, report the code",
  },
} as const;

function lang(): "ar" | "en" {
  if (typeof document === "undefined") return "ar";
  return document.documentElement.lang === "en" ? "en" : "ar";
}

/** نوعُ الفشل — أو يُرمى من جديد ما ليس فشلاً (توجيه، «غير موجود»، …) */
export function actionFailureKind(e: unknown): ActionFailureKind {
  unstable_rethrow(e);
  if (unstable_isUnrecognizedActionError(e)) return "stale";
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest) return "server";
  return "network";
}

export function actionFailureMessage(kind: ActionFailureKind, digest?: string | null): string {
  const t = TEXT[lang()];
  return kind === "server" ? `${t.server}${digest ? ` (ref: ${digest})` : ""}.` : t[kind];
}

/** يُعلن الفشلَ للشريط العام — مرّةً لكل فشل */
export function announceActionFailure(kind: ActionFailureKind, message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACTION_FAILURE_EVENT, { detail: { kind, message } }));
}

/** نتيجةُ الفشل بالشكل الذي تقرؤه النماذجُ أصلاً: `error` نصٌّ، و`ok`/`success` كاذبان */
export type ActionFailure = { ok: false; success: false; error: string; transportFailure: ActionFailureKind };

/** **يحرس إجراءَ خادمٍ واحداً** — يُستدعى كما هو (بمعاملاته، ومع `useActionState` أو `bind`)، ويعيد عند فشل النقل
 *  نتيجةً فيها `error` بدل أن يرمي إلى صفحة الخطأ. والنوعُ المُعاد نوعُ الإجراء نفسه (ما يقرؤه المستدعي `error`). */
export function guardAction<A extends unknown[], R>(action: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const guarded = async (...args: A): Promise<R> => {
    try {
      return await action(...args);
    } catch (e) {
      const kind = actionFailureKind(e);
      const digest = (e as { digest?: string } | null)?.digest ?? null;
      const message = actionFailureMessage(kind, digest);
      announceActionFailure(kind, message);
      // حالةُ `useActionState` السابقة (المعاملُ الأول حين يكون كائناً) تُحفظ حقولُها، ويُضاف إليها الخطأ
      const prev = args.length === 2 && args[1] instanceof FormData && args[0] && typeof args[0] === "object" ? (args[0] as object) : {};
      return { ...prev, ok: false, success: false, error: message, transportFailure: kind } as unknown as R;
    }
  };
  return guarded;
}
