import type { deliverableJobs } from "./jobs";

/** طلباتُ التوليد بصيغةٍ تعبر إلى المتصفّح (تواريخُ نصّية) — بلا مدخلاتِ الطلب.
 *  ليس إجراءَ خادم: يُستدعى من الصفحة ومن `pollAiJobs` وحدهما. */
export type JobsView = ReturnType<typeof serializeJobs>;

export function serializeJobs(view: NonNullable<Awaited<ReturnType<typeof deliverableJobs>>>) {
  return {
    canRequest: view.canRequest,
    jobs: view.jobs.map((j) => ({
      id: j.id,
      provider: j.provider,
      model: j.model,
      status: j.status,
      error: j.error,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      retryable: j.retryable,
      adopted: !!j.adoptedAt,
      createdAt: j.createdAt.toISOString(),
      nextAttemptAt: j.nextAttemptAt?.toISOString() ?? null,
      simulated: !!j.result?.simulated,
      variants: j.result?.variants ?? [],
    })),
  };
}
