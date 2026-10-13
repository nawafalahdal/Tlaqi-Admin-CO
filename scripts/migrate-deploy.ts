import { spawnSync } from "node:child_process";

/** `prisma migrate deploy` مع إعادةٍ محدودة على فشل قفل الترحيل وحده.
 *
 *  **العطب:** فشل نشرٌ مرّتين بـ`P1002`:
 *
 *      Timed out trying to acquire a postgres advisory lock
 *      (SELECT pg_advisory_lock(72707369)). Timeout: 10000ms
 *
 *  ومهلةُ هذا القفل **عشر ثوانٍ ثابتة لا تُضبَط** — هكذا وثّقها Prisma،
 *  وقالت إن الأمر الذي انتهت مهلته يُعاد تشغيله. فالفشل عارضٌ لا خطأٌ
 *  في الترحيلات: إمّا بناءٌ آخر يحمل القفل في تلك اللحظة، أو حسابُ
 *  Neon بارد فلا يُجيب في عشر ثوان.
 *
 *  وللمشكلة حلٌّ ثانٍ موثَّق: `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`.
 *  **ولم أستعمله.** القفل هو ما يمنع ترحيلَين متوازيين من إفساد
 *  القاعدة، وتعطيلُه يشتري نشراً أسرع بثمن احتمالٍ لا يُعكَس. والإعادة
 *  تحلّ العارض وتُبقي الحرس.
 *
 *  **ولا تُعاد إلا على هذا الفشل بعينه.** ترحيلٌ خاطئ، أو قاعدةٌ لا
 *  يصلها أحد، أو تعارضُ مخطَّط — كلُّها تفشل من المرّة الأولى بلا
 *  إعادة. وإلا صارت الإعادة سِتراً على عطبٍ حقيقي: أربع محاولاتٍ فاشلة
 *  تُخفي رسالةَ الخطأ الأولى في ضجيج.
 */
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [3000, 8000, 20000];

/** بصمةُ فشل القفل — وهي وحدها ما يُعاد عليه */
function isLockTimeout(output: string): boolean {
  return (
    output.includes("advisory lock") ||
    (output.includes("P1002") && output.includes("timed out"))
  );
}

function sleep(ms: number) {
  // انتظارٌ متزامن: هذه خطوةُ بناءٍ تسلسلية لا خادمٌ يخدم طلبات
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const run = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    env: process.env,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(output);

  if (run.status === 0) {
    if (attempt > 1) console.log(`✓ نجح الترحيل في المحاولة ${attempt}`);
    process.exit(0);
  }

  if (!isLockTimeout(output)) {
    // خطأٌ حقيقي: يُترَك ظاهراً ولا يُعاد عليه
    console.error("\n✗ فشل الترحيل لسببٍ ليس قفلاً — لا إعادة.");
    process.exit(run.status ?? 1);
  }

  if (attempt === MAX_ATTEMPTS) {
    console.error(`\n✗ تعذّر الحصول على قفل الترحيل في ${MAX_ATTEMPTS} محاولات.`);
    process.exit(run.status ?? 1);
  }

  const wait = BACKOFF_MS[attempt - 1];
  console.warn(
    `\n⟳ قفل الترحيل مشغول (المحاولة ${attempt}/${MAX_ATTEMPTS}) — إعادة بعد ${wait / 1000}ث`
  );
  sleep(wait);
}
