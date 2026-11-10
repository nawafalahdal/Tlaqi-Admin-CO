import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { migrationDecision, migrationDatabaseUrl } from "./migrationPolicy";

/** سياسةُ الترحيل — على الدالّة ثم على `migrate-deploy.ts` نفسه.
 *
 *  الجزء الأول: كل بيئةٍ وما يُقرَّر فيها، ومنها القيمُ الغائبة والمجهولة.
 *  الجزء الثاني: السكربتُ يُشغَّل فعلاً ببيئةٍ مضبوطة، ويُثبَت أن Prisma لم
 *  يُستدعَ أصلاً حيث يُمنع (لا سطر `Datasource`). وما يُسمح فيه يقع على
 *  القاعدة المحلية وحدها؛ والعنوانُ البعيد في الفحص وهميٌّ (`.invalid`)
 *  فلا يصل شيءٌ إلى قاعدةٍ حقيقية ولو أخطأت السياسة. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const FAKE_PASS = "fake-pass-9f3c";
const REMOTE = `postgresql://u:${FAKE_PASS}@db.invalid:5432/neondb?sslmode=require`;
const LOCAL = parse(readFileSync(".env")).DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(LOCAL)) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

// ١ — الدالّة
const decide = (env: Record<string, string | undefined>) => migrationDecision(env).action;
const matrix: [string, Record<string, string | undefined>, "migrate" | "skip" | "refuse"][] = [
  ["production على Vercel", { VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: REMOTE }, "migrate"],
  ["production خارج Vercel", { VERCEL_ENV: "production", DATABASE_URL: REMOTE }, "refuse"],
  ["production و VERCEL≠1", { VERCEL: "true", VERCEL_ENV: "production", DATABASE_URL: REMOTE }, "refuse"],
  ["preview بقاعدةٍ بعيدة", { VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: REMOTE }, "skip"],
  ["preview بقاعدةٍ محلية — لا يُرحَّل أيضاً", { VERCEL_ENV: "preview", DATABASE_URL: LOCAL }, "skip"],
  ["preview بلا DATABASE_URL", { VERCEL: "1", VERCEL_ENV: "preview" }, "skip"],
  ["development بقاعدةٍ بعيدة", { VERCEL: "1", VERCEL_ENV: "development", DATABASE_URL: REMOTE }, "refuse"],
  ["development بقاعدةٍ محلية", { VERCEL: "1", VERCEL_ENV: "development", DATABASE_URL: LOCAL }, "migrate"],
  ["VERCEL بلا VERCEL_ENV", { VERCEL: "1", DATABASE_URL: LOCAL }, "refuse"],
  ["VERCEL_ENV=staging", { VERCEL: "1", VERCEL_ENV: "staging", DATABASE_URL: REMOTE }, "refuse"],
  ["VERCEL_ENV=Production", { VERCEL: "1", VERCEL_ENV: "Production", DATABASE_URL: REMOTE }, "refuse"],
  ["VERCEL_ENV=' production'", { VERCEL: "1", VERCEL_ENV: " production", DATABASE_URL: REMOTE }, "refuse"],
  ["VERCEL_ENV فارغ", { VERCEL: "1", VERCEL_ENV: "", DATABASE_URL: REMOTE }, "refuse"],
  ["محلياً: localhost", { DATABASE_URL: "postgresql://u:p@localhost:5432/x" }, "migrate"],
  ["محلياً: 127.0.0.1", { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x" }, "migrate"],
  ["محلياً: [::1]", { DATABASE_URL: "postgresql://u:p@[::1]:5432/x" }, "migrate"],
  ["محلياً بقاعدةٍ بعيدة", { DATABASE_URL: REMOTE }, "refuse"],
  ["محلياً: localhost.evil.test", { DATABASE_URL: "postgresql://u:p@localhost.evil.test:5432/x" }, "refuse"],
  ["محلياً بلا DATABASE_URL", {}, "refuse"],
  ["محلياً بعنوانٍ لا يُقرأ", { DATABASE_URL: "not a url" }, "refuse"],
  ["محلياً بمقبسٍ بلا مضيف", { DATABASE_URL: "postgresql:///x?host=/var/run/postgresql" }, "refuse"],
];
for (const [name, env, want] of matrix) {
  const got = decide(env);
  chk(`${name}: ${want}`, got === want, got === want ? "" : `got ${got}`);
}
chk("السببُ لا يحمل عنوان القاعدة ولا كلمة مرورها", matrix.every(([, env]) => {
  const r = migrationDecision(env).reason;
  return !r.includes("db.invalid") && !r.includes(FAKE_PASS) && !r.includes("localhost:");
}));

// ١ب — **اتصالُ الترحيل المباشر** (قفلُ Prisma لا يصمد خلف مجمِّع Neon) — بشرط أن يكون القاعدةَ نفسها
const NEON_POOLED = `postgresql://app:${FAKE_PASS}@ep-quiet-sky-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
const NEON_DIRECT = `postgresql://app:${FAKE_PASS}@ep-quiet-sky-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
const pick = (env: Record<string, string | undefined>) => migrationDatabaseUrl(env);
const neon = pick({ DATABASE_URL: NEON_POOLED, DATABASE_URL_UNPOOLED: NEON_DIRECT });
chk("اتصالُ الترحيل: زوجُ Neon (مجمَّع/مباشر) لنفس القاعدة → المباشر", neon.direct && neon.url === NEON_DIRECT);
const viaNonPooling = pick({ DATABASE_URL: NEON_POOLED, POSTGRES_URL_NON_POOLING: NEON_DIRECT });
chk("اتصالُ الترحيل: POSTGRES_URL_NON_POOLING بديلاً", viaNonPooling.direct && viaNonPooling.url === NEON_DIRECT);
const refuseCases: [string, string][] = [
  ["نقطةُ نهايةٍ أخرى", NEON_DIRECT.replace("ep-quiet-sky-123456", "ep-other-999")],
  ["قاعدةٌ أخرى", NEON_DIRECT.replace("/neondb", "/otherdb")],
  ["مستخدمٌ آخر", NEON_DIRECT.replace("app:", "admin:")],
  ["منفذٌ آخر", NEON_DIRECT.replace(".neon.tech/", ".neon.tech:6543/")],
  ["عنوانٌ لا يُقرأ", "not a url"],
];
for (const [name, direct] of refuseCases) {
  const r = pick({ DATABASE_URL: NEON_POOLED, DATABASE_URL_UNPOOLED: direct });
  chk(`اتصالُ الترحيل: ${name} → يبقى DATABASE_URL`, !r.direct && r.url === NEON_POOLED);
}
const none = pick({ DATABASE_URL: NEON_POOLED });
chk("اتصالُ الترحيل: بلا متغيّرٍ مباشر → DATABASE_URL كما كان", !none.direct && none.url === NEON_POOLED);
chk("اتصالُ الترحيل: الملاحظةُ لا تحمل عنواناً ولا كلمة مرور",
    [neon, viaNonPooling, none, ...refuseCases.map(([, d]) => pick({ DATABASE_URL: NEON_POOLED, DATABASE_URL_UNPOOLED: d }))]
      .every((r) => !r.note.includes(FAKE_PASS) && !r.note.includes("neon.tech") && !r.note.includes("not a url")));

// ٢ — السكربت نفسه، ببيئةٍ مضبوطة لا تَرث شيئاً
function run(env: Record<string, string>) {
  const r = spawnSync("node_modules/.bin/tsx", ["scripts/migrate-deploy.ts"], {
    encoding: "utf8",
    timeout: 120_000,
    // `.env` لا يُحمَّل في الفحص: البيئةُ هي ما يُمرَّر هنا وحده، و`NODE_ENV`
    // كما في بناء Vercel
    env: {
      PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "production",
      DOTENV_CONFIG_PATH: "/nonexistent/.env", ...env,
    },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const prismaRan = (out: string) => out.includes("Datasource");
const leaks = (out: string) => out.includes("db.invalid") || out.includes(FAKE_PASS);

const preview = run({ VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: REMOTE });
chk("سكربت: preview يتخطّى وينجح البناء", preview.status === 0 && preview.out.includes("لا ترحيل"), `exit ${preview.status}`);
chk("سكربت: preview لم يستدعِ Prisma", !prismaRan(preview.out));
const previewLocal = run({ VERCEL: "1", VERCEL_ENV: "preview", DATABASE_URL: LOCAL });
chk("سكربت: preview بقاعدةٍ محلية لا يُرحّل أيضاً", previewLocal.status === 0 && !prismaRan(previewLocal.out));

for (const [name, env] of [
  ["VERCEL_ENV=staging", { VERCEL: "1", VERCEL_ENV: "staging", DATABASE_URL: REMOTE }],
  ["VERCEL بلا VERCEL_ENV", { VERCEL: "1", DATABASE_URL: REMOTE }],
  ["development بقاعدةٍ بعيدة", { VERCEL: "1", VERCEL_ENV: "development", DATABASE_URL: REMOTE }],
  ["production خارج Vercel", { VERCEL_ENV: "production", DATABASE_URL: REMOTE }],
  ["محلياً بقاعدةٍ بعيدة", { DATABASE_URL: REMOTE }],
  ["محلياً بلا DATABASE_URL", {}],
] as [string, Record<string, string>][]) {
  const r = run(env);
  chk(`سكربت: ${name} يُفشِل البناء بلا Prisma`, r.status === 1 && r.out.includes("رُفض الترحيل") && !prismaRan(r.out),
      `exit ${r.status}`);
  chk(`سكربت: ${name} لا يطبع العنوان`, !leaks(r.out));
}
chk("سكربت: لا تسرّب في preview", !leaks(preview.out));

const local = run({ DATABASE_URL: LOCAL });
chk("سكربت: محلياً يُرحّل على القاعدة المحلية", local.status === 0 && prismaRan(local.out) && local.out.includes("No pending migrations"),
    `exit ${local.status}`);
const prod = run({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: LOCAL });
chk("سكربت: production يستدعي Prisma فعلاً (على القاعدة المحلية هنا)",
    prod.status === 0 && prod.out.includes("Vercel production") && prismaRan(prod.out), `exit ${prod.status}`);

// ٣ — السكربت يرحّل فعلاً بالاتصال المباشر: كلمةُ مرور DATABASE_URL خاطئة عمداً، فلا ينجح إلا إن استعمل المباشر
const lu = new URL(LOCAL);
const wrongPass = new URL(LOCAL);
wrongPass.password = "wrong-pass-0000";
wrongPass.searchParams.set("pgbouncer", "true");
const viaDirect = run({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: wrongPass.toString(), DATABASE_URL_UNPOOLED: LOCAL });
chk("سكربت: production يرحّل بالاتصال المباشر (DATABASE_URL_UNPOOLED)",
    viaDirect.status === 0 && viaDirect.out.includes("اتصالٌ مباشر للترحيل (DATABASE_URL_UNPOOLED)") && viaDirect.out.includes("No pending migrations"),
    `exit ${viaDirect.status}`);
chk("سكربت: ولا يطبع كلمة المرور", !viaDirect.out.includes("wrong-pass-0000") && !viaDirect.out.includes(decodeURIComponent(lu.password) || "\u0000"));
const mismatch = run({ VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: LOCAL, DATABASE_URL_UNPOOLED: REMOTE });
chk("سكربت: مباشرٌ لقاعدةٍ أخرى يُتجاهَل ويُرحَّل بـDATABASE_URL (ولا يُتّصل بالأخرى)",
    mismatch.status === 0 && mismatch.out.includes("لا يطابق DATABASE_URL") && mismatch.out.includes("No pending migrations") && !leaks(mismatch.out),
    `exit ${mismatch.status}`);

console.log(checks.join("\n"));
const failed = checks.some((c) => c.startsWith("✗"));
console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
process.exit(failed ? 1 : 0);
