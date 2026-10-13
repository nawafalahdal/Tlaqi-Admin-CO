import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { readableTextOn } from "@/lib/colors";

/** مربّعات الرمز: واحدٌ لكل لون قسم، مُخبوزاً صورةً.
 *
 *  لونُ القسم كخلفية CSS يَقلبه عميل البريد: البيج الفاتح (#EEF6DF)
 *  يصير داكناً، فيختفي عليه الرمزُ الأبيض أو الداكن — أيُّهما اخترنا.
 *  والصورةُ لا يقلبها أحد. فالمربّع كلُّه صورةٌ واحدة: لونُه وحبرُه
 *  معاً، ثابتان في الوضعين.
 */
const SIZE = 84;             // يُعرض في ٤٢، فيبقى حاداً على الشاشات المضاعَفة
const RADIUS = 24;
const MARK = "public/brand/symbol-mark.png";
const MARK_RATIO = 725 / 512;

const TILES: Record<string, string> = {
  mahogany: "#C34900",
  green: "#67C090",
  beige: "#EEF6DF",
  temptress: "#341D2B",
};

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

(async () => {
  for (const [slug, hex] of Object.entries(TILES)) {
    const ink = readableTextOn(hex);                 // الدالة نفسها التي تحكم الواجهة
    const [ir, ig, ib] = hexToRgb(ink);
    const [br, bg, bb] = hexToRgb(hex);

    // الرمز: ألفا الأصل يُلوَّن بحبرٍ مقروءٍ على لون القسم
    const markW = 34;
    const markH = Math.round(markW * MARK_RATIO);
    const { data: alpha, info } = await sharp(MARK)
      .resize(markW, markH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mark = await sharp({
      create: { width: info.width, height: info.height, channels: 3, background: { r: ir, g: ig, b: ib } },
    })
      .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
      .png()
      .toBuffer();

    // المربّع: لون القسم، بزوايا مستديرة شفّافة
    const mask = Buffer.from(
      `<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`
    );
    const tile = await sharp({
      create: { width: SIZE, height: SIZE, channels: 4, background: { r: br, g: bg, b: bb, alpha: 1 } },
    })
      .composite([
        { input: mask, blend: "dest-in" },
        { input: mark, gravity: "center" },
      ])
      .png()
      .toBuffer();

    const out = `public/brand/card-mark-${slug}.png`;
    writeFileSync(out, tile);
    console.log(out, `${tile.length}B  حبر ${ink} على ${hex}`);
  }
})();
