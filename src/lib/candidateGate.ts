/** **حصرُ المرشّح قبل الاعتماد النهائي** — قرار المؤسس (نوفمبر 2026): «لا يدخل المستخدم الواجهة الداخلية قبل
 *  استيفاء مراحل الاعتماد المطلوبة»، ولا يُعدّ دخولٌ سابقٌ أو دعوةٌ قديمة دليلاً على اجتياز الاختبار.
 *
 *  **العطبُ الذي يُصلحه:** كان الحصرُ موزّعاً على الصفحات — بوابةُ العضو تحوّل المرشّحَ إلى اختباره، وغيرُها لا
 *  يسأل. فدخل مرشّحٌ لم يختبر إلى التقويم والهيكل والوثائق والتنبيهات (أُثبت بفحصٍ فعليّ).
 *
 *  **والآن حدٌّ واحد بثلاث طبقات:**
 *  - الجلسةُ تحمل «مرشّح» من القاعدة (`approvalStatus` ≠ approved)، وتُراجَع في كل طلبٍ ما دام مرشّحاً (`auth.ts`)
 *    — فيُفتح له الداخلُ لحظةَ اعتماده لا بعد خمس دقائق؛
 *  - الوكيلُ (`proxy.ts`) لا يفتح له إلا صفحاتِ رحلته (`isCandidatePathAllowed`)؛
 *  - وإجراءاتُ الخادم التي يبلغها العضو ترفضه (`assertNotCandidate`) — فالإجراءُ يُنادى من أي صفحة، والحارسُ
 *    عند الحقيقة لا عند الواجهة. */

/** صفحاتُ رحلة المرشّح وحدها: الاختبار، وانتظارُ القرار، والترحيب، وتغييرُ كلمة المرور */
export const CANDIDATE_PATHS = ["/member/test", "/member/pending", "/member/welcome", "/change-password"] as const;

export function isCandidatePathAllowed(pathname: string): boolean {
  // البوابةُ نفسُها تحوّله إلى مرحلته (الاختبار أو الانتظار) من القاعدة
  if (pathname === "/member") return true;
  return CANDIDATE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type MaybeSession = { user?: { role?: string; candidate?: boolean } | null } | null | undefined;

export function isCandidateSession(session: MaybeSession): boolean {
  return session?.user?.role === "member" && session.user.candidate === true;
}

export const CANDIDATE_BLOCKED = "حسابُك مرشّحٌ لم يُعتمد بعد — يُفتح لك هذا بعد اجتياز الاختبار والاعتماد النهائي";

/** يرفض إجراءً داخلياً لمرشّحٍ لم يُعتمد — يُستدعى بعد قراءة الجلسة في إجراءات الخادم التي يبلغها العضو */
export function assertNotCandidate(session: MaybeSession): void {
  if (isCandidateSession(session)) throw new Error(CANDIDATE_BLOCKED);
}

/** الصيغةُ نفسُها تُمرِّر الجلسةَ بعد الفحص — لمن يقرأ الجلسة في سطرٍ واحد (`orgActor(notCandidate(await auth()))`) */
export function notCandidate<T extends MaybeSession>(session: T): T {
  assertNotCandidate(session);
  return session;
}
