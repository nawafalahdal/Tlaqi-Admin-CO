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

/** **أيُّ اتصالٍ يُرحَّل به** — المباشرُ لا المجمَّع، متى عُرف وطابق القاعدةَ نفسها.
 *
 *  **العطب:** تكامل Neon يضع في `DATABASE_URL` عنوانَ المجمِّع (PgBouncer بوضع المعاملات)، و`prisma
 *  migrate` يأخذ قفلَه (`pg_advisory_lock`) على مستوى الجلسة. والمجمِّعُ يُعيد اتصالَ الخادم إلى
 *  البِركة بعد كل معاملة، فقد يصل طلبُ فكّ القفل إلى اتصالٍ آخر — فيبقى القفلُ معلَّقاً على اتصالٍ
 *  لا صاحبَ له حتى يُغلَق. وهذا ما شوهد في نشر 0ed406b: نشرٌ أنهى ترحيله، وبقي القفلُ محجوزاً بعده
 *  دقائق، فلم ينجُ النشرُ التالي إلا في المحاولة الرابعة والأخيرة. وPrisma يطلب للترحيل اتصالاً
 *  مباشراً.
 *
 *  **والحل:** يُرحَّل بـ`DATABASE_URL_UNPOOLED` (أو `POSTGRES_URL_NON_POOLING`) — وهما من تكامل Neon
 *  نفسه — **بشرط أن يكون القاعدةَ نفسها:** المضيفُ نفسُه بلا `-pooler`، واسمُ القاعدة والمستخدمُ
 *  نفساهما. وإلا رُحِّل بـ`DATABASE_URL` كما كان، فلا يُرحَّل خطأً إلى قاعدةٍ أخرى. والتطبيقُ نفسه
 *  يبقى على المجمِّع. ولا يُطبع شيءٌ من العناوين — أسماءُ المتغيّرات وحدها. */
export const DIRECT_URL_KEYS = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"] as const;

export type MigrationUrl = { url: string | undefined; direct: boolean; note: string };

function parts(url: string | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      // مضيفُ المجمِّع في Neon هو المضيفُ المباشر بلاحقة `-pooler` في المقطع الأول
      host: u.hostname.toLowerCase().replace(/^([^.]+)-pooler\./, "$1."),
      port: u.port || "5432",
      db: decodeURIComponent(u.pathname.replace(/^\//, "")),
      user: decodeURIComponent(u.username),
    };
  } catch {
    return null;
  }
}

export function migrationDatabaseUrl(env: Record<string, string | undefined>): MigrationUrl {
  const pooled = env.DATABASE_URL;
  const p = parts(pooled);
  for (const key of DIRECT_URL_KEYS) {
    const direct = env[key]?.trim();
    if (!direct) continue;
    const d = parts(direct);
    const why = !p || !d
      ? "عنوانٌ لا يُقرأ"
      : p.host !== d.host
        ? "المضيف مختلف"
        : p.db !== d.db
          ? "اسم القاعدة مختلف"
          : p.user !== d.user
            ? "المستخدم مختلف"
            : p.port !== d.port
              ? "المنفذ مختلف"
              : null;
    if (why) return { url: pooled, direct: false, note: `${key} لا يطابق DATABASE_URL (${why}) — يُرحَّل بـDATABASE_URL كما كان` };
    return { url: direct, direct: true, note: `اتصالٌ مباشر للترحيل (${key}) — بلا مجمِّع اتصالات` };
  }
  return { url: pooled, direct: false, note: "لا اتصالَ مباشراً معرَّفاً — يُرحَّل بـDATABASE_URL" };
}
