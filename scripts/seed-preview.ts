import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { previewDatabaseIsolated, PREVIEW_DATABASE_NAME } from "../src/lib/deploymentEnv";

/** **بذرةُ قاعدة المعاينة المعزولة** — تُشغَّل من `migrate-deploy.ts` بعد ترحيلها، ولا تعمل في غيرها.
 *
 *  - لا تعمل إلا على `tlaqi_preview` مع إعلان العزل (`previewDatabaseIsolated`)، فلا تمسّ الإنتاج ولا المحلي.
 *  - لا تعمل إلا على قاعدةٍ **فارغة** (لا حسابات): فلا تُعاد ولا تكتب فوق ما جرّبه المؤسس.
 *  - تزرع ما يزرعه `prisma/seed.ts` (الأقسام الرسمية، ومسارات الاختبار، وحساب المؤسس) — **بيانات اصطناعية، لا أعضاء**.
 *  - **ثم تُبطل كلمة المرور المعروفة في `seed.ts`** بقيمةٍ عشوائية لا تُطبع: الدخولُ الأول بـ«نسيت كلمة المرور»، والرسالةُ
 *    لا تصل إلا لمن في `PREVIEW_EMAIL_ALLOWLIST`. فلا كلمةَ مرورٍ معروفة لمعاينةٍ منشورة على الإنترنت. */
(async () => {
  if (!previewDatabaseIsolated(process.env)) {
    console.log(`⏭ لا بذرة: ليست قاعدة المعاينة المعزولة (${PREVIEW_DATABASE_NAME})`);
    return;
  }
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.count();
    if (users > 0) {
      console.log("⏭ لا بذرة: قاعدة المعاينة فيها حسابات بالفعل");
      return;
    }
    const run = spawnSync("npx", ["tsx", "prisma/seed.ts"], { encoding: "utf8", env: process.env });
    // لا يُطبع خرجُ seed.ts: فيه كلمةُ المرور الافتراضية التي تُبطَل الآن
    if (run.status !== 0) {
      console.error("✗ تعذّرت بذرة المعاينة");
      process.exit(1);
    }
    const unusable = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
    const n = await prisma.user.updateMany({ where: { role: "super_admin" }, data: { passwordHash: unusable } });
    console.log(`✓ بذرة المعاينة: أقسامٌ ومساراتٌ وحسابُ المؤسس (${n.count}) — كلمةُ المرور تُعيَّن بـ«نسيت كلمة المرور»`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("✗ بذرة المعاينة:", e instanceof Error ? e.message : "خطأ");
  process.exit(1);
});
