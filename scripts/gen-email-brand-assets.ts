/** **صورُ الهوية داخل البريد نفسه** — يولّد `src/lib/brand2026/emailAssets.generated.ts` من ملفات `public/brand/2026/email`.
 *
 *  السببُ الجذري لمربّع التذييل الفارغ: الشعارُ والنمطُ والعلامةُ كانت روابطَ خارجية (`https://…/brand/2026/email/*.png`)،
 *  فكلُّ عارضٍ يحجب الصورَ الخارجية — Outlook افتراضياً، وApple Mail بلا «تحميل المحتوى البعيد»، وعارضُ الملفات في
 *  التطبيقات — يرسم مكانها مربّعاً فارغاً. والبطاقةُ وحدها كانت تظهر لأنها مضمّنةٌ بمعرّف `cid:`.
 *  فتُضمَّن صورُ الهوية بالطريقة نفسها: بايتاتُها في الكود (لا قراءةَ ملفٍّ وقت الإرسال — ملفاتُ `public` لا تُحزَم مع دوالّ
 *  الخادم على Vercel)، ويُرفقها مسارُ الإرسال الواحد بكل رسالة.
 *
 *  تشغيل (بعد تغيير أيٍّ من الصور الثلاث): npx tsx scripts/gen-email-brand-assets.ts
 *  ويتحقّق `scripts/e2e-email-template.ts` أن الملفَّ المولَّد يطابق الصورَ الأصلية بايتاً ببايت. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DIR = "public/brand/2026/email";
const OUT = "src/lib/brand2026/emailAssets.generated.ts";
const ASSETS = [
  { key: "logo", file: "logo-on-temptress.png", cid: "tlaqi-logo", width: 180, height: 53 },
  { key: "pattern", file: "pattern-talent-on-beige.png", cid: "tlaqi-pattern", width: 600, height: 48 },
  { key: "mark", file: "mark-mahogany.png", cid: "tlaqi-mark", width: 40, height: 43 },
] as const;

const entries = ASSETS.map((a) => {
  const buf = readFileSync(`${DIR}/${a.file}`);
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error(`${a.file}: ليس PNG`);
  const sha = createHash("sha256").update(buf).digest("hex");
  return `  ${a.key}: {
    cid: "${a.cid}",
    filename: "${a.cid}.png",
    source: "${DIR}/${a.file}",
    width: ${a.width},
    height: ${a.height},
    sha256: "${sha}",
    base64:
      "${buf.toString("base64")}",
  },`;
});

writeFileSync(
  OUT,
  `/* eslint-disable */
// مولَّدٌ من \`scripts/gen-email-brand-assets.ts\` — لا يُحرَّر يدوياً. صورُ الهوية تُضمَّن في البريد بمعرّف \`cid:\`
// فلا تعتمد على تحميل صورٍ خارجية (السببُ الجذري لمربّع الشعار الفارغ في التذييل).
export const EMAIL_BRAND_ASSETS = {
${entries.join("\n")}
} as const;

export type EmailBrandAssetKey = keyof typeof EMAIL_BRAND_ASSETS;
`
);
console.log(`${OUT}: ${ASSETS.map((a) => a.cid).join(", ")}`);
