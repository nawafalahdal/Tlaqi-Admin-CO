import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/** **أصولُ البريد لهوية 2026** — صورٌ PNG من ملفات الحزمة نفسها (عملاءُ البريد لا يعرضون SVG):
 *  - الشعار والعلامة: تصغيرٌ بنسبتهما كما هي (لا قصَّ ولا تلوين).
 *  - شريطُ النمط: بلاطةُ «موهبة» بمقاس M مكرّرةً أفقياً بلا تدويرٍ ولا تمديد، على لونها المعتمد
 *    (Mahogany على Beige، وBeige على Temptress) — شريطٌ مستقلٌّ لا خلف نص.
 *  يُشغَّل يدوياً: `npx tsx scripts/brand-build-assets.ts` — والناتجُ في `brand-assets/2026/email`. */

const ROOT = join(process.cwd(), "brand-assets/2026");
const OUT = join(ROOT, "email");
mkdirSync(OUT, { recursive: true });

const BEIGE = "#EEF6DF";
const TEMPTRESS = "#341D2B";

async function logo(file: string, width: number, out: string) {
  const buf = await sharp(join(ROOT, file)).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(OUT, out), buf);
  return buf.length;
}

async function strip(tileFile: string, bg: string, out: string, tilePx = 96, width = 1200) {
  const tile = await sharp(readFileSync(join(ROOT, "patterns", tileFile)), { density: 384 })
    .resize(tilePx, tilePx)
    .png()
    .toBuffer();
  const n = Math.ceil(width / tilePx);
  const buf = await sharp({ create: { width, height: tilePx, channels: 4, background: bg } })
    .composite(Array.from({ length: n }, (_, i) => ({ input: tile, left: i * tilePx, top: 0 })))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(join(OUT, out), buf);
  return buf.length;
}

(async () => {
  const sizes = {
    "logo-on-temptress.png": await logo("logos/full/TLAQI-logo-full_on-temptress.png", 480, "logo-on-temptress.png"),
    "logo-on-beige.png": await logo("logos/full/TLAQI-logo-full_on-beige.png", 480, "logo-on-beige.png"),
    "mark-mahogany.png": await logo("logos/mark/TLAQI-mark_mahogany.png", 112, "mark-mahogany.png"),
    "pattern-talent-on-beige.png": await strip("pattern-talent_M_mahogany.svg", BEIGE, "pattern-talent-on-beige.png"),
    "pattern-talent-on-temptress.png": await strip("pattern-talent_M_beige.svg", TEMPTRESS, "pattern-talent-on-temptress.png"),
  };
  for (const [k, v] of Object.entries(sizes)) console.log(`${k}\t${Math.round(v / 1024)} KB`);
})();
