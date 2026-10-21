/** متى يُسمح بتطبيق الترحيلات — قرارٌ واحدٌ صريح قبل `prisma migrate deploy`.
 *
 *  **العطب:** كان البناء يُرحِّل في كل نشر، والمعاينةُ تحمل `DATABASE_URL`
 *  الإنتاج نفسه (قيمةٌ واحدة لكل البيئات). فأيُّ ترحيلٍ يُرفع إلى أيّ فرعٍ
 *  كان يقع على قاعدة الإنتاج من بناء معاينة — قبل أن يُراجَع أو يُعتمَد.
 *
 *  **والقاعدة: يُرحَّل في موضعين لا ثالث لهما.**
 *
 *  | الحالة                                          | القرار  |
 *  |-------------------------------------------------|---------|
 *  | `VERCEL=1` و`VERCEL_ENV=production`             | يُرحَّل  |
 *  | `VERCEL_ENV=preview` — أيّاً كانت القاعدة       | يُتخطّى  |
 *  | خارج Vercel، أو `development`، وقاعدةٌ محلية    | يُرحَّل  |
 *  | خارج Vercel، أو `development`، وقاعدةٌ بعيدة    | يُرفض   |
 *  | `VERCEL` بلا `VERCEL_ENV`، أو قيمةٌ غير معروفة  | يُرفض   |
 *  | `DATABASE_URL` غائب أو لا يُقرأ (خارج الإنتاج)  | يُرفض   |
 *
 *  **والتخطّي غيرُ الرفض.** المعاينةُ تُبنى بلا ترحيل فيبقى عرضُها ممكناً،
 *  والإنتاجُ لا يُمَسّ. أما ما لا يُعرف فيُفشِل البناء: لو كان إنتاجاً
 *  لنُشر كودٌ بلا مخطّطه، والفشلُ يُبقي النشر السابق قائماً.
 *
 *  والمقارنةُ حرفيّة: `Production` و` production` قيمٌ غير معروفة، لا
 *  تقريبٌ لـ`production`. ولا يُطبع عنوانُ القاعدة ولا شيءٌ منها في السبب. */

export type MigrationDecision =
  | { action: "migrate"; reason: string }
  | { action: "skip"; reason: string }
  | { action: "refuse"; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function databaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function migrationDecision(env: Record<string, string | undefined>): MigrationDecision {
  const vercelEnv = env.VERCEL_ENV;
  const onVercel = env.VERCEL !== undefined || vercelEnv !== undefined;

  if (vercelEnv === "production") {
    return env.VERCEL === "1"
      ? { action: "migrate", reason: "Vercel production" }
      : { action: "refuse", reason: "VERCEL_ENV=production خارج بناء Vercel" };
  }
  if (vercelEnv === "preview") {
    return { action: "skip", reason: "معاينة (VERCEL_ENV=preview) — الترحيل ممنوع فيها" };
  }
  if (vercelEnv !== undefined && vercelEnv !== "development") {
    return { action: "refuse", reason: `قيمة VERCEL_ENV غير معروفة (${JSON.stringify(vercelEnv)})` };
  }
  if (onVercel && vercelEnv === undefined) {
    return { action: "refuse", reason: "VERCEL مضبوط بلا VERCEL_ENV — البيئة مجهولة" };
  }

  // ما بقي: خارج Vercel، أو `development` — والقاعدةُ يجب أن تكون محلية
  const host = databaseHost(env.DATABASE_URL);
  if (host === null) return { action: "refuse", reason: "DATABASE_URL غائب أو لا يُقرأ" };
  if (!LOCAL_HOSTS.has(host)) {
    return { action: "refuse", reason: "قاعدة غير محلية خارج إنتاج Vercel" };
  }
  return { action: "migrate", reason: "قاعدة محلية" };
}
