/** **صورُ الهوية داخل البريد نفسه** — يولّد `src/lib/brand2026/emailAssets.generated.ts` من ملفات `public/brand/2026/email`.
 *
 *  السببُ الجذري لمربّع التذييل الفارغ: الشعارُ والنمطُ والعلامةُ كانت روابطَ خارجية (`https://…/brand/2026/email/*.png`)،
 *  فكلُّ عارضٍ يحجب الصورَ الخارجية — Outlook افتراضياً، وApple Mail بلا «تحميل المحتوى البعيد»، وعارضُ الملفات في
 *  التطبيقات — يرسم مكانها مربّعاً فارغاً. والبطاقةُ وحدها كانت تظهر لأنها مضمّنةٌ بمعرّف `cid:`.
 *  فتُضمَّن صورُ الهوية بالطريقة نفسها: بايتاتُها في الكود (لا قراءةَ ملفٍّ وقت الإرسال — ملفاتُ `public` لا تُحزَم مع دوالّ
 *  الخادم على Vercel)، ويُرفقها مسارُ الإرسال الواحد بكل رسالة.
 *
 *  تشغيل (بعد تغيير أيٍّ من الصور أو إطارَي البريد): npx tsx --tsconfig tsconfig.json scripts/gen-email-brand-assets.ts
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

const entry = (key: string, cid: string, source: string, width: number, height: number, buf: Buffer) => {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error(`${key}: ليس PNG`);
  const sha = createHash("sha256").update(buf).digest("hex");
  return `  ${key}: {
    cid: "${cid}",
    filename: "${cid}.png",
    source: "${source}",
    width: ${width},
    height: ${height},
    sha256: "${sha}",
    base64:
      "${buf.toString("base64")}",
  },`;
};

/** **التدرّجُ السفلي** (قرار المؤسس، نوفمبر 2026: «تدرّجٌ انسيابي في الأسفل من البنفسجي الداكن إلى البرتقالي الرسمي») —
 *  من Temptress إلى Mahogany عمودياً، صورةٌ مضمّنة لا تدرّجُ CSS: دعمُ `linear-gradient` يختلف بين عملاء البريد (Outlook على
 *  ويندوز لا يرسمه)، والصورةُ المضمّنة تُرسم في كلٍّ منها كما هي. ولأن التدرّجَ عموديٌّ فمطُّها أفقياً لعرض الشاشة لا يغيّرها. */
const GRADIENT = { from: [0x34, 0x1d, 0x2b], to: [0xc3, 0x49, 0x00], width: 600, height: 120 } as const;

(async () => {
  const sharp = (await import("sharp")).default;
  const entries = ASSETS.map((a) => entry(a.key, a.cid, `${DIR}/${a.file}`, a.width, a.height, readFileSync(`${DIR}/${a.file}`)));
  const { width: W, height: H, from, to } = GRADIENT;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    // انسيابٌ ناعم (smoothstep) لا خطّيٌّ حادّ عند الطرفين
    const t0 = y / (H - 1);
    const t = t0 * t0 * (3 - 2 * t0);
    const c = from.map((f, i) => Math.round(f + (to[i] - f) * t));
    for (let x = 0; x < W; x++) raw.set(c, (y * W + x) * 3);
  }
  const gradient = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
  entries.push(entry("gradient", "tlaqi-gradient", "generated:temptress-to-mahogany", W, H, gradient));

  // **إطارا البريد صورتين** (طلب المؤسس، 17 نوفمبر 2026): قاعدةُ الترويسة (تُرسم عليها الجهةُ وقتَ الإرسال) والتذييل
  const F = await import("../src/lib/brand2026/emailFrames");
  const { TAGLINE, EMAIL_FOOTER_SOCIAL } = await import("../src/lib/emailBrand");
  const headerBase = await F.renderHeaderBase({
    logoOnTemptress: readFileSync(`${DIR}/logo-on-temptress.png`),
    patternOnTemptress: readFileSync(`${DIR}/pattern-talent-on-temptress.png`),
  });
  entries.push(entry("headerBase", "tlaqi-header-base", "generated:header-base", F.FRAME_DISPLAY_W, F.HEADER_DISPLAY_H, headerBase));
  const footer = await F.renderFooter({ markMahogany: readFileSync(`${DIR}/mark-mahogany.png`) }, { tagline: TAGLINE, handle: `@${EMAIL_FOOTER_SOCIAL[0].handle}` });
  entries.push(entry("footer", "tlaqi-footer", "generated:footer", F.FRAME_DISPLAY_W, F.FOOTER_DISPLAY_H, footer));
  write(entries);
})();

function write(entries: string[]) {
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
console.log(`${OUT}: ${ASSETS.map((a) => a.cid).join(", ")}, tlaqi-gradient, tlaqi-header-base, tlaqi-footer`);
}
