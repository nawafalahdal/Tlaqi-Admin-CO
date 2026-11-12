import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { contrastRatio } from "@/lib/colors";
import { HEX } from "./tokens";

/** **الدائرةُ أسفل الرسالة بلون القسم** (قرار المؤسس، نوفمبر 2026): الرسائلُ كلُّها ثابتةٌ بالبنفسجي، والمتغيّرُ الوحيد
 *  علامةُ الشعار في التذييل — تأخذ لونَ القسم أو اللجنة (واللجنةُ بلون قسمها).
 *
 *  العلامةُ هي الملفُّ الرسمي نفسُه: يُؤخذ قناعُه (الشفافية) ويُملأ باللون — فلا يُعاد رسمُها ولا تُقارَب. ولونٌ لا يُرى
 *  على تذييل Temptress (كالإدارة العليا بلونها نفسه) يُرسم بـBeige. */
export const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;

export function markColorFor(hex: string): string {
  const c = `#${hex.replace("#", "").toUpperCase()}`;
  return contrastRatio(c, HEX.temptress) < 1.6 ? HEX.beige : c;
}

let source: Buffer | null = null;
export async function tintedMarkPng(hex: string): Promise<Buffer> {
  source ??= readFileSync(join(process.cwd(), "public", "brand", "2026", "email", "mark-mahogany.png"));
  const color = markColorFor(hex).slice(1);
  const meta = await sharp(source).metadata();
  const alpha = await sharp(source).ensureAlpha().extractChannel("alpha").toBuffer();
  return sharp({
    create: {
      width: meta.width!,
      height: meta.height!,
      channels: 3,
      background: { r: parseInt(color.slice(0, 2), 16), g: parseInt(color.slice(2, 4), 16), b: parseInt(color.slice(4, 6), 16) },
    },
  })
    .joinChannel(alpha)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
