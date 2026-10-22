import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import {
  deploymentEnv,
  databaseBlocked,
  spreadsheetId,
  emailRecipientsAllowed,
  type DeploymentEnv,
} from "../src/lib/deploymentEnv";

/** حارسُ البيئة — على الدوالّ ثم على عميل Prisma نفسه.
 *
 *  الجزء الأول: كل بيئةٍ وما يُقرَّر فيها، ومنها القيمُ الغائبة والمجهولة.
 *  الجزء الثاني: عميلُ Prisma يُحمَّل فعلاً في عمليةٍ ببيئةٍ مضبوطة، ويُطلَق
 *  منه استعلام: في المعاينة غير المعزولة لا يبلغ القاعدة، وفيما سواها
 *  يبلغها. والقاعدةُ في الفحص كلّه محليةٌ وحدها. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

// عمليةٌ فرعية: تستعلم بعميل المنصة وتطبع ما جرى
async function probeOnce() {
  const { prisma } = await import("../src/lib/prisma");
  try {
    const n = await prisma.user.count();
    console.log(`PROBE reached ${n}`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (process.env.PROBE_DEBUG) console.error(msg.replace(/postgres(ql)?:\/\/[^@\s]*@/g, "postgresql://***@").slice(0, 400));
    console.log(`PROBE failed ${msg.includes("database.invalid") ? "blocked-host" : "other"}`);
  }
  await prisma.$disconnect();
}

if (process.argv.includes("--probe")) {
  probeOnce().then(() => process.exit(0));
} else {
  main();
}

function main() {
const LOCAL = parse(readFileSync(".env")).DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(LOCAL)) {
  console.error("يُشغَّل على القاعدة المحلية وحدها");
  process.exit(1);
}

// ١ — البيئة
const envOf: [string, Record<string, string | undefined>, DeploymentEnv][] = [
  ["محلياً بلا Vercel", {}, "development"],
  ["production على Vercel", { VERCEL: "1", VERCEL_ENV: "production" }, "production"],
  // غيابُ `VERCEL` في التشغيل لا يُوقف الإنتاج — `VERCEL_ENV` وحده يحسم
  ["production بلا VERCEL", { VERCEL_ENV: "production" }, "production"],
  ["production و VERCEL≠1", { VERCEL: "true", VERCEL_ENV: "production" }, "production"],
  ["preview", { VERCEL: "1", VERCEL_ENV: "preview" }, "preview"],
  ["development على Vercel", { VERCEL: "1", VERCEL_ENV: "development" }, "development"],
  ["VERCEL بلا VERCEL_ENV", { VERCEL: "1" }, "preview"],
  ["VERCEL_ENV=staging", { VERCEL: "1", VERCEL_ENV: "staging" }, "preview"],
  ["VERCEL_ENV=Production", { VERCEL: "1", VERCEL_ENV: "Production" }, "preview"],
  ["VERCEL_ENV=''", { VERCEL: "1", VERCEL_ENV: "" }, "preview"],
];
for (const [name, env, want] of envOf) {
  const got = deploymentEnv(env);
  chk(`البيئة: ${name}`, got === want, `${got}`);
}

// ٢ — القاعدة
const dbOf: [string, Record<string, string | undefined>, boolean][] = [
  ["preview غير معزولة تُمنع", { VERCEL: "1", VERCEL_ENV: "preview" }, true],
  ["preview معزولة تُفتح", { VERCEL: "1", VERCEL_ENV: "preview", PREVIEW_DATABASE_ISOLATED: "1" }, false],
  ["preview بقيمة عزلٍ غير صريحة تُمنع", { VERCEL: "1", VERCEL_ENV: "preview", PREVIEW_DATABASE_ISOLATED: "true" }, true],
  ["بيئةٌ مجهولة تُمنع", { VERCEL: "1" }, true],
  ["production تُفتح", { VERCEL: "1", VERCEL_ENV: "production" }, false],
  ["محلياً تُفتح", {}, false],
];
for (const [name, env, want] of dbOf) chk(`القاعدة: ${name}`, databaseBlocked(env) === want);

// ٣ — الشيت
chk("الشيت: الإنتاج يكتب في شيت الإنتاج",
  spreadsheetId({ VERCEL: "1", VERCEL_ENV: "production", GOOGLE_SHEETS_SPREADSHEET_ID: "P", GOOGLE_SHEETS_SPREADSHEET_ID_PREVIEW: "T" }) === "P");
chk("الشيت: المعاينة لا تكتب في شيت الإنتاج ولو وُجد",
  spreadsheetId({ VERCEL: "1", VERCEL_ENV: "preview", GOOGLE_SHEETS_SPREADSHEET_ID: "P" }) === undefined);
chk("الشيت: المعاينة تكتب في التجريبي",
  spreadsheetId({ VERCEL: "1", VERCEL_ENV: "preview", GOOGLE_SHEETS_SPREADSHEET_ID: "P", GOOGLE_SHEETS_SPREADSHEET_ID_PREVIEW: "T" }) === "T");
chk("الشيت: محلياً كما هو", spreadsheetId({ GOOGLE_SHEETS_SPREADSHEET_ID: "P" }) === "P");

// ٤ — البريد
const people = ["a@x.test", "B@X.test", "c@x.test"];
chk("البريد: الإنتاج لا يُنقِص أحداً",
  emailRecipientsAllowed(people, { VERCEL: "1", VERCEL_ENV: "production" }).length === 3);
chk("البريد: المعاينة بلا قائمةٍ لا تراسل أحداً",
  emailRecipientsAllowed(people, { VERCEL: "1", VERCEL_ENV: "preview" }).length === 0);
const allowed = emailRecipientsAllowed(people, { VERCEL: "1", VERCEL_ENV: "preview", PREVIEW_EMAIL_ALLOWLIST: " b@x.test , z@x.test" });
chk("البريد: المعاينة تراسل من في القائمة وحدهم", allowed.length === 1 && allowed[0] === "B@X.test", allowed.join(","));
chk("البريد: بيئةٌ مجهولة كالمعاينة", emailRecipientsAllowed(people, { VERCEL: "1" }).length === 0);

// ٥ — عميلُ Prisma نفسه، في عمليةٍ ببيئتها
const probe = (extra: Record<string, string>) => {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: LOCAL, ...extra };
  delete env.VERCEL;
  delete env.VERCEL_ENV;
  delete env.PREVIEW_DATABASE_ISOLATED;
  Object.assign(env, extra);
  const r = spawnSync("npx", ["tsx", "scripts/check-deployment-env.ts", "--probe"], { env, encoding: "utf8", timeout: 120_000 });
  return (r.stdout.match(/PROBE (\S+(?: \S+)?)/)?.[1] ?? `none: ${r.stderr.slice(0, 200)}`).trim();
};
const p1 = probe({ VERCEL: "1", VERCEL_ENV: "preview" });
chk("Prisma: المعاينة غير المعزولة لا تبلغ القاعدة", p1 === "failed blocked-host", p1);
const p2 = probe({ VERCEL: "1" });
chk("Prisma: والبيئة المجهولة كذلك", p2 === "failed blocked-host", p2);
const p3 = probe({ VERCEL: "1", VERCEL_ENV: "preview", PREVIEW_DATABASE_ISOLATED: "1" });
chk("Prisma: المعاينة المعزولة تبلغ قاعدتها", p3.startsWith("reached"), p3);
const p4 = probe({ VERCEL: "1", VERCEL_ENV: "production" });
chk("Prisma: الإنتاج يبلغ قاعدته", p4.startsWith("reached"), p4);
const p5 = probe({});
chk("Prisma: محلياً كما هو", p5.startsWith("reached"), p5);

console.log(checks.join("\n"));
const failed = checks.filter((c) => c.startsWith("✗")).length;
console.log(failed ? `\nFAILED (${failed})` : "\nALL PASS");
process.exit(failed ? 1 : 0);
}
