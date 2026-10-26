/** نتيجةُ كلِّ عمليةٍ في وكيل التسويق: نجاحٌ ببياناته، أو رفضٌ برمزٍ لا بنصّ.
 *
 *  الرمزُ تترجمه الواجهةُ بلغة صاحبها (`mk.errors` في القاموسين)، فلا تخرج
 *  رسالةٌ عربيةٌ ثابتةٌ إلى واجهةٍ إنجليزية. والمعاملاتُ (`params`) تملأ
 *  الفراغات في نصّ القاموس — أسماءُ متطلباتٍ ناقصة، وأرقامُ إصدارات. */

export const MK_ERRORS = [
  "unauthenticated",
  "no_access",
  "forbidden",
  "not_found",
  "invalid_input",
  "invalid_state",
  "stale",
  "brief_incomplete",
  "team_incomplete",
  "separate_approver_required",
  "version_not_current",
  "content_not_approved",
  "design_not_current_content",
  "design_checks_failed",
  "design_not_submitted",
  "quality_not_passed",
  "file_type",
  "file_too_large",
  "file_corrupt",
  "dependency_open",
  "dependency_cycle",
  "self_escalation",
  "capability_required",
  "already_member",
  "url_invalid",
  "not_verified",
  "integration_not_configured",
  "job_not_retryable",
  "job_active",
  "job_quota",
  "draft_changed",
  "campaign_closed",
] as const;

export type MkErrorCode = (typeof MK_ERRORS)[number];

export type MkFail = { ok: false; code: MkErrorCode; params?: Record<string, string | number> };
export type MkResult<T extends object = object> = ({ ok: true } & T) | MkFail;

export const fail = (code: MkErrorCode, params?: Record<string, string | number>): MkFail => ({
  ok: false,
  code,
  ...(params ? { params } : {}),
});

/** يُرمى داخل معاملةٍ ليُلغيها ويُعيد رمزَه — فلا تُكتب نصفُ عملية */
export class MkAbort extends Error {
  constructor(public readonly failure: MkFail) {
    super(failure.code);
    this.name = "MkAbort";
  }
}

export function abort(code: MkErrorCode, params?: Record<string, string | number>): never {
  throw new MkAbort(fail(code, params));
}

/** يُشغّل عمليةً قد تُلغى برمز — ويُحوّل الإلغاء إلى نتيجةٍ لا استثناء */
export async function guarded<T extends object>(run: () => Promise<MkResult<T>>): Promise<MkResult<T>> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof MkAbort) return e.failure;
    throw e;
  }
}

/** تعارضُ مفتاحٍ فريد (P2002) — طلبان بالمفتاح نفسه في اللحظة نفسها */
export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
}
