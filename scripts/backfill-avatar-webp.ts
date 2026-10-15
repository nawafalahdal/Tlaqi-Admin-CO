/** إعادةُ ترميز الصور المخزَّنة PNG إلى WebP — مرّةً واحدة.
 *
 *  **لماذا يَلزم سكربتٌ ولا يَكفي تغييرُ الترميز:** الترميزُ الجديد
 *  يَسري على ما يُرفَع بعده. أما ما في القاعدة فبقي PNG — والصورةُ
 *  المقيسة ٩٠٤ ك.ب، فمن فتح الهيكلَ يُحمّلها كاملةً أوّلَ مرّة. وهذا
 *  السكربتُ يُعيد ترميزَها في مكانها.
 *
 *  **وهو آمنٌ قابلٌ للتكرار:** لا يَمسّ إلا ما كان `data:image/png`،
 *  ويَفكّ الصورةَ ويتحقّق منها قبل الكتابة، ويَترك ما لا يُفَكّ كما هو
 *  ولا يَحذف شيئاً. ويُحدّث الختمَ معها في نفس التحديث — وإلا بقي
 *  المتصفّح يَعرض PNG القديمة سنةً، لأن الجوابَ `immutable`.
 *
 *  ويُشغَّل بـ`--dry` ليُقال ما سيجري قبل أن يجري.
 *
 *  التشغيل: npx tsx scripts/backfill-avatar-webp.ts [--dry]
 */
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

const PNG_PREFIX = "data:image/png;base64,";

async function recode(dataUrl: string): Promise<{ url: string; from: number; to: number } | null> {
  const png = Buffer.from(dataUrl.slice(PNG_PREFIX.length), "base64");
  try {
    const webp = await sharp(png).webp({ quality: 82, alphaQuality: 100, effort: 5 }).toBuffer();
    // لا يُكتَب ما لم يُفَكّ ويُقرأ صورةً — وإلا فُقدت صورةٌ سليمة
    const meta = await sharp(webp).metadata();
    if (meta.format !== "webp" || !meta.width) return null;
    // ولا يُكتَب ما كَبُر: PNG لرسمٍ مسطّحٍ قد يكون أصغرَ من WebP
    if (webp.length >= png.length) return null;
    return {
      url: `data:image/webp;base64,${webp.toString("base64")}`,
      from: png.length,
      to: webp.length,
    };
  } catch {
    return null;
  }
}

async function main() {
  let changed = 0, skipped = 0, savedBytes = 0;

  for (const kind of ["member", "user"] as const) {
    const rows =
      kind === "member"
        ? await prisma.member.findMany({
            where: { avatarData: { startsWith: PNG_PREFIX } },
            select: { id: true, fullName: true, avatarData: true },
          })
        : await prisma.user.findMany({
            where: { avatarData: { startsWith: PNG_PREFIX } },
            select: { id: true, fullName: true, avatarData: true },
          });

    for (const row of rows) {
      const next = await recode(row.avatarData!);
      if (!next) {
        skipped += 1;
        console.log(`— تُركت كما هي: ${row.fullName}`);
        continue;
      }
      savedBytes += next.from - next.to;
      changed += 1;
      const pct = (100 - (next.to / next.from) * 100).toFixed(0);
      console.log(
        `${DRY ? "سيُعاد" : "أُعيد"} ترميزُها: ${row.fullName} — ` +
          `${(next.from / 1024).toFixed(0)}KB ← ${(next.to / 1024).toFixed(0)}KB (${pct}% أقلّ)`
      );
      if (DRY) continue;
      const data = { avatarData: next.url, avatarVersion: new Date() };
      if (kind === "member") {
        await prisma.member.update({ where: { id: row.id }, data });
      } else {
        await prisma.user.update({ where: { id: row.id }, data });
      }
    }
  }

  console.log(
    `\n${DRY ? "معاينة" : "تمّ"}: ${changed} صورة، ${skipped} تُركت، ` +
      `${(savedBytes / 1024).toFixed(0)}KB أقلّ في المجموع`
  );
}

main().finally(() => prisma.$disconnect());
