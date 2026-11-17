import sharp from "sharp";
import { HEX } from "./tokens";
import { ensureFonts } from "@/lib/welcomeBanner";

/** **إطارا البريد صورتان** (طلب المؤسس، 17 نوفمبر 2026 — «لا إطار أبيض أبداً، ومتوافقٌ مع الوضعين الداكن والفاتح»).
 *
 *  **لماذا صورتان لا أشرطةٌ ملوّنة:** كانت الهويةُ أشرطةً بخلفياتٍ ملوّنة بعرض الشاشة. لكنّ تطبيقَ Gmail يحذف لونَ صفحة
 *  الرسالة ويحيطها بهامشٍ من خلفيته هو (أبيض)، فكلُّ شريطٍ ملوّن يُبرز حولَه «إطاراً أبيض» لا يملكه القالب. والوضعُ الداكن
 *  أسوأ: Gmail يقلب الألوانَ الخلفية، وApple Mail يُبقيها فاتحةً على شاشةٍ داكنة.
 *  فصار المتنُ **بلا خلفيةٍ أصلاً** — نصٌّ على خلفية تطبيق البريد نفسها أياً كانت — والهويةُ صورتان: ترويسةٌ في الأعلى وتذييلٌ
 *  في الأسفل. **وعملاءُ البريد لا يقلبون الصور في الوضع الداكن**، فتبقيان كما صُمّمتا في الوضعين، وزواياهما المستديرة شفّافة
 *  فتجلسان على الأبيض والداكن معاً بلا حافة.
 *
 *  - **الترويسة:** لوحٌ Temptress — الشعارُ الرسمي يساراً، وجهةُ الرسالة يميناً بخطّ الهوية (The Year of The Camel)، وصفُّ نمط
 *    «موهبة» الرسمي أسفله. والجهةُ تُرسَم وقتَ الإرسال على قاعدةٍ مولَّدة (`composeHeader`)، وإن تعذّر رسمُها رُجع إلى القاعدة
 *    والجهةُ نصٌّ تحتها — فلا تُحجب رسالةٌ لعطبِ خط.
 *  - **التذييل:** العلامةُ Mahogany، و«نلتقي • نفكر • نصنع»، و@tlaqisa — على لوحٍ ينساب من Temptress إلى Mahogany.
 *
 *  القياساتُ بدقّةٍ مضاعفة (2x) لعرض 600px — حادّةٌ على شاشات الهاتف. */

/** عرضُ الإطار المعروض في الرسالة، والصورةُ بضعفه */
export const FRAME_DISPLAY_W = 600;
const W = FRAME_DISPLAY_W * 2;
const R = 40; // نصفُ قطر الزاوية (20px معروضاً)

export const HEADER = { W, H: 300, logo: { x: 56, y: 40, w: 400 }, label: { right: W - 60, centerY: 99, maxW: 600, size: 46 }, pattern: { y: 200 } } as const;
export const FOOTER = { W, H: 440 } as const;
export const HEADER_DISPLAY_H = HEADER.H / 2;
export const FOOTER_DISPLAY_H = FOOTER.H / 2;

const FONT = "'The Year of The Camel', Cairo, 'Noto Sans Arabic', 'DejaVu Sans', sans-serif";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** قناعُ الزوايا المستديرة: ما خارجه شفّاف — فيجلس الإطارُ على أيّ خلفية */
const roundedMask = (w: number, h: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${R}" ry="${R}" fill="#fff"/></svg>`);

/** سطرُ نصٍّ عربيٍّ بخطّ الهوية، مقصوصاً على حبره — ومقياسُ حبره ليُعرف أنه رُسم فعلاً (لا مربّعاتٍ فارغة) */
export async function textLayer(text: string, opts: { size: number; weight: number; color: string; opacity?: number; dir?: "rtl" | "ltr"; font?: string }): Promise<{ png: Buffer; width: number; height: number; ink: number }> {
  ensureFonts();
  const w = Math.ceil(opts.size * Math.max(4, text.length) * 1.1) + 40;
  const h = Math.ceil(opts.size * 2.2);
  const dir = opts.dir ?? "rtl";
  const x = dir === "rtl" ? w - 20 : 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${x}" y="${Math.ceil(opts.size * 1.45)}" font-family="${opts.font ?? FONT}" font-size="${opts.size}" font-weight="${opts.weight}" fill="${opts.color}"${opts.opacity !== undefined ? ` fill-opacity="${opts.opacity}"` : ""} direction="${dir}" text-anchor="start" xml:space="preserve">${escapeXml(text)}</text></svg>`;
  const raw = sharp(Buffer.from(svg)).png();
  const stats = await sharp(await raw.toBuffer()).stats();
  const ink = stats.channels[3]?.mean ?? 0;
  if (ink < 0.05) return { png: Buffer.alloc(0), width: 0, height: 0, ink };
  const { data, info } = await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height, ink };
}

/** **قاعدةُ الترويسة** (بلا جهة): لوحٌ Temptress بالشعار ونمطِ «موهبة» — تُولَّد مرّةً وتُضمَّن في الكود */
export async function renderHeaderBase(src: { logoOnTemptress: Buffer; patternOnTemptress: Buffer }): Promise<Buffer> {
  const logo = await sharp(src.logoOnTemptress).resize({ width: HEADER.logo.w }).png().toBuffer();
  const pattern = await sharp(src.patternOnTemptress).resize({ width: W }).png().toBuffer();
  const panel = await sharp({ create: { width: W, height: HEADER.H, channels: 4, background: HEX.temptress } })
    .composite([
      { input: logo, left: HEADER.logo.x, top: HEADER.logo.y },
      { input: pattern, left: 0, top: HEADER.pattern.y },
    ])
    .png()
    .toBuffer();
  return sharp(panel).composite([{ input: roundedMask(W, HEADER.H), blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
}

/** **الجهةُ على الترويسة** — يميناً ومتوسّطةً عمودياً مع الشعار، وتُصغَّر لتتّسع إن طالت. `null` إن لم يُرسم حبرٌ (خطٌّ غائب) */
export async function composeHeader(base: Buffer, label: string): Promise<Buffer | null> {
  // اسمُ الجهة من مدخلات الإدارة: يُهرَّب في SVG (`escapeXml`)، ويُقصَر — فطولُه يحدّد مساحةَ الرسم
  const text = label.trim().slice(0, 80);
  if (!text) return null;
  const t = await textLayer(text, { size: HEADER.label.size, weight: 700, color: HEX.beige });
  if (!t.width || t.ink < 0.05) return null;
  let layer = t.png;
  let { width, height } = t;
  if (width > HEADER.label.maxW) {
    const r = await sharp(layer).resize({ width: HEADER.label.maxW }).png().toBuffer({ resolveWithObject: true });
    layer = r.data;
    width = r.info.width;
    height = r.info.height;
  }
  return sharp(base)
    .composite([{ input: layer, left: HEADER.label.right - width, top: Math.round(HEADER.label.centerY - height / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** **التذييل:** العلامةُ وعبارةُ الهوية والحساب على لوحٍ ينساب من Temptress إلى Mahogany */
export async function renderFooter(src: { markMahogany: Buffer }, text: { tagline: string; handle: string }): Promise<Buffer> {
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${FOOTER.H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${HEX.temptress}"/><stop offset="0.52" stop-color="${HEX.temptress}"/><stop offset="1" stop-color="${HEX.mahogany}"/>` +
      `</linearGradient></defs><rect width="${W}" height="${FOOTER.H}" fill="url(#g)"/></svg>`
  );
  const mark = await sharp(src.markMahogany).resize({ width: 96 }).png().toBuffer({ resolveWithObject: true });
  const tagline = await textLayer(text.tagline, { size: 50, weight: 700, color: HEX.beige });
  // الحسابُ لاتينيّ وخطُّ الهوية عربيٌّ وحده — فبـCairo (لاتينيّه من العائلة نفسها في المنصة) لا بخطٍّ احتياطيٍّ مذيَّل
  const handle = await textLayer(text.handle, { size: 32, weight: 700, color: HEX.beige, opacity: 0.85, dir: "ltr", font: "Cairo, 'DejaVu Sans', sans-serif" });
  if (!tagline.width || !handle.width) throw new Error("التذييل: لم يُرسم نصُّ الهوية — الخطُّ غير متاح");
  const center = (w: number) => Math.round((W - w) / 2);
  const markTop = 52;
  const tagTop = markTop + mark.info.height + 40;
  const handleTop = tagTop + tagline.height + 26;
  const panel = await sharp(bg)
    .composite([
      { input: mark.data, left: center(mark.info.width), top: markTop },
      { input: tagline.png, left: center(tagline.width), top: tagTop },
      { input: handle.png, left: center(handle.width), top: handleTop },
    ])
    .png()
    .toBuffer();
  return sharp(panel).composite([{ input: roundedMask(W, FOOTER.H), blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
}
