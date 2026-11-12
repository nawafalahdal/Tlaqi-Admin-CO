import { join } from "node:path";
import sharp from "sharp";

/** **تطبيقُ الشعار الرسمي (هوية تلاق 2026) على ملفات المنصة** — بالأسماء والأبعاد نفسها، فيتبدّل في كل موضعٍ
 *  يستعملها (القائمة، الدخول، الشهادات، البطاقات، الأيقونة) بلا تعديلٍ في الشيفرة.
 *  الملفُّ الرسمي يُصغَّر بنسبته ويُوضع في إطارٍ شفاف بأبعاد الملف القديم — لا قصَّ ولا تمديدَ ولا تلوين.
 *  يُشغَّل مرّةً: `npx tsx scripts/brand-apply-logos.ts` (والنسخُ القديمة في تاريخ git). */
const KIT = join(process.cwd(), "brand-assets/2026/logos");
const OUT = join(process.cwd(), "public/brand");
const clear = { r: 0, g: 0, b: 0, alpha: 0 };

const jobs: [string, string, number, number][] = [
  ["full/TLAQI-logo-full_on-beige.png", "lockup-on-light.png", 880, 259],
  ["full/TLAQI-logo-full_on-temptress.png", "lockup-on-dark.png", 880, 259],
  ["full/TLAQI-logo-full_on-beige.png", "logo-fullname-on-light.png", 880, 318],
  ["full/TLAQI-logo-full_on-temptress.png", "logo-fullname-on-dark.png", 880, 318],
  ["full/TLAQI-logo-full_on-beige.png", "logo-full.png", 1479, 1019],
  ["mark/TLAQI-mark_mahogany.png", "symbol.png", 345, 345],
  ["mark/TLAQI-mark_mahogany.png", "symbol-mark.png", 512, 725],
  ["mark/TLAQI-mark_mahogany.png", "favicon.png", 512, 512],
];

(async () => {
  for (const [src, dst, w, h] of jobs) {
    await sharp(join(KIT, src)).resize(w, h, { fit: "contain", background: clear }).png({ compressionLevel: 9 }).toFile(join(OUT, dst));
    console.log(`${dst}\t${w}×${h}`);
  }
  // أصولُ قالب البريد الجديد — علنيةٌ ليقرأها عميلُ البريد
  const { mkdirSync, copyFileSync, readdirSync } = await import("node:fs");
  mkdirSync(join(OUT, "2026/email"), { recursive: true });
  for (const f of readdirSync(join(process.cwd(), "brand-assets/2026/email"))) copyFileSync(join(process.cwd(), "brand-assets/2026/email", f), join(OUT, "2026/email", f));
  console.log("email assets → public/brand/2026/email");
})();
