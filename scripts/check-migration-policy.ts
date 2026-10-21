import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { migrationDecision } from "./migrationPolicy";

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

console.log(checks.join("\n"));
const failed = checks.some((c) => c.startsWith("✗"));
console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
process.exit(failed ? 1 : 0);
