/** في أي بيئةٍ تعمل المنصة — وماذا يُسمح لها أن تمسّ.
 *
 *  **العطب الذي يحرسه هذا الملف:** نشراتُ المعاينة على Vercel تقرأ متغيّرات
 *  قاعدة الإنتاج وشيته ومفتاح بريده. فأيُّ دخولٍ إلى معاينة — ولو للتجربة —
 *  كان يكتب في بيانات الأعضاء الحقيقية، ويُلحق سطراً بشيت الإنتاج، ويرسل
 *  بريداً لأشخاصٍ حقيقيين.
 *
 *  **والقاعدة:** الإنتاجُ لا يُعرَف إلا بإثبات (`VERCEL_ENV=production`)،
 *  والمحليُّ لا يُعرَف إلا بغياب Vercel كلّه. وما سواهما — معاينةٌ أو بيئةٌ
 *  مجهولة — يُعامَل معاملةَ المعاينة: لا قاعدةَ حقيقية إلا إذا أُعلن عزلُها
 *  (`PREVIEW_DATABASE_ISOLATED=1`)، ولا شيتَ إلا الشيتُ التجريبي، ولا بريدَ
 *  إلا لقائمةٍ مسمّاة. وهي القاعدةُ نفسها التي تقرّر الترحيل
 *  (`scripts/migrationPolicy.ts`). */

type Env = Record<string, string | undefined>;

export type DeploymentEnv = "production" | "preview" | "development";

export function deploymentEnv(env: Env = process.env): DeploymentEnv {
  const vercelEnv = env.VERCEL_ENV;
  const onVercel = env.VERCEL !== undefined || vercelEnv !== undefined;
  // في التشغيل يكفي `VERCEL_ENV=production` — لا يضبطه إلا Vercel. واشتراطُ `VERCEL=1`
  // معه (كما في سياسة الترحيل وقت البناء) كان يجعل غيابَ متغيّرِ نظامٍ واحد إيقافاً للإنتاج
  if (vercelEnv === "production") return "production";
  if (!onVercel || vercelEnv === "development") return "development";
  // `preview`، أو قيمةٌ مجهولة، أو `VERCEL` بلا `VERCEL_ENV`
  return "preview";
}

/** القاعدةُ ممنوعة: معاينةٌ لم يُعلَن أن قاعدتها معزولة عن الإنتاج */
export function databaseBlocked(env: Env = process.env): boolean {
  return deploymentEnv(env) === "preview" && env.PREVIEW_DATABASE_ISOLATED !== "1";
}

/** عنوانٌ لا يُحَلّ (`.invalid` محجوزٌ لذلك): من يتّصل به لا يبلغ قاعدةً أصلاً */
export const BLOCKED_DATABASE_URL = "postgresql://preview-not-isolated@database.invalid:5432/blocked";

/** الشيتُ الذي يُكتب فيه: شيتُ الإنتاج في الإنتاج ومحلياً، والتجريبيُّ في المعاينة وحده */
export function spreadsheetId(env: Env = process.env): string | undefined {
  return deploymentEnv(env) === "preview" ? env.GOOGLE_SHEETS_SPREADSHEET_ID_PREVIEW : env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

/** من يصله البريد. في المعاينة: من في `PREVIEW_EMAIL_ALLOWLIST` وحدهم، وإلا فلا أحد */
export function emailRecipientsAllowed(recipients: string[], env: Env = process.env): string[] {
  if (deploymentEnv(env) !== "preview") return recipients;
  const allow = new Set(
    (env.PREVIEW_EMAIL_ALLOWLIST ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  );
  return recipients.filter((r) => allow.has(r.trim().toLowerCase()));
}
