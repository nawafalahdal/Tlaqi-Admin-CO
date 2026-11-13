import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { BRAND, themeFromColor } from "@/lib/brand";
import { ensureFonts } from "@/lib/welcomeBanner";
import { firstName } from "@/lib/personName";
import { departmentBrand } from "@/lib/departmentBrand";

/** صورتا المشاركة: ملصقُ الدعوة، وبطاقةُ العضوية.
 *
 *  **لماذا صورةٌ لا HTML؟** المطلوب أن يُصوِّر صاحبُها الشاشة فينشرها
 *  كما هي. والبريد لا يحمل خطَّ الهوية (Gmail يُسقط `@font-face`)،
 *  ويقلب الألوان في الوضع الداكن، ويرسم كلُّ عميلٍ الجداول بطريقته — فلا
 *  يصل التصميم مرّتين بالشكل نفسه. أما الصورة فتُرسَم هنا مرّةً بخطّ
 *  الهوية نفسه (The Year of The Camel)، فتصل في كلّ صندوقٍ كما صُمِّمت، ولا ينقلبها الوضع الداكن.
 *
 *  **والمقاس ١٠٨٠×١٣٥٠ (٤:٥)** — مقاسُ منشور إنستغرام العمودي، فتُنشر بلا
 *  قصّ. والرسمُ بالأدوات نفسها التي ترسم اللوحة الترحيبية (sharp +
 *  librsvg + خطّ `assets/fonts`) ويحرسها فحصُ البناء نفسه.
 *
 *  ولا يُكتب في الصورتين إلا ما في السجلّ: الاسم والقسم والمسمّى
 *  والتاريخ والداعي. لا إنجازٌ مُخترَع ولا رقمٌ مُقدَّر. */

export const CARD_W = 1080;
export const CARD_H = 1350;

/** خطُّ الهوية الرسمي (قرار المؤسس، نوفمبر 2026) من `assets/fonts` — وCairo احتياطٌ إن غاب */
const FONT = "'The Year of The Camel', Cairo, 'Noto Sans Arabic', 'DejaVu Sans', sans-serif";
const BRAND_DIR = join(process.cwd(), "public", "brand");
/** للنصّ اللاتيني وحده («TLAQI»، المعرّف): حروفُ خطّ الهوية اللاتينيةُ مذيَّلة، والشعارُ الرسميُّ لاتينيٌّ غير مذيَّل */
const LATIN = "Cairo, 'DejaVu Sans', sans-serif";

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!
  );
}

/** التاريخ بالأرقام العربية والشهر باسمه: «٢٠ أكتوبر ٢٠٢٦» */
export function cardDate(d: Date): string {
  return new Intl.DateTimeFormat("ar-u-ca-gregory-nu-arab", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

const logoCache = new Map<string, string>();
/** ملفُّ الشعار الرسمي كما في حزمة الهوية — لا يُلوَّن ولا يُعدَّل */
function logoUri(file: string): string {
  const hit = logoCache.get(file);
  if (hit) return hit;
  const uri = `data:image/png;base64,${readFileSync(join(BRAND_DIR, "2026", "logos", `TLAQI-logo-full_${file}.png`)).toString("base64")}`;
  logoCache.set(file, uri);
  return uri;
}

/** عرضُ النصّ كما يرسمه pango فعلاً — لا تقديراً بعدد الحروف.
 *
 *  الاسم أكبرُ ما في البطاقة، والتقديرُ يُخطئ في العربية (الحروف
 *  المتّصلة أعرض من المنفصلة بكثير). فيُرسم مرّةً وحده ويُقاس. */
async function textWidth(text: string, size: number, weight = 700, font = FONT): Promise<number> {
  const w = Math.ceil(text.length * size * 0.9) + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.ceil(size * 2)}"><text x="${w - 10}" y="${Math.ceil(size * 1.4)}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="#000" direction="rtl" text-anchor="start">${escapeXml(text)}</text></svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
    return info.width;
  } catch {
    return text.length * size * 0.55;
  }
}

/** أكبرُ حجمٍ يتّسع به النصّ — ثم لا يصغُر دون حدٍّ يُقرأ */
async function fit(text: string, size: number, maxWidth: number, min: number, weight = 700): Promise<number> {
  const w = await textWidth(text, size, weight);
  if (w <= maxWidth) return size;
  return Math.max(min, Math.floor((size * maxWidth) / w));
}

/** نصٌّ عربيٌّ يبدأ من اليمين عند `x` (أو ينتهي يساراً عنده) */
function t(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  opts: { weight?: number; opacity?: number; anchor?: "right" | "left" | "middle"; ltr?: boolean; font?: string } = {}
): string {
  const dir = opts.ltr ? "ltr" : "rtl";
  // في RTL: «start» هو اليمين. وفي LTR: «start» هو اليسار.
  const anchor =
    opts.anchor === "middle"
      ? "middle"
      : opts.ltr
        ? opts.anchor === "right" ? "end" : "start"
        : opts.anchor === "left" ? "end" : "start";
  return `<text x="${x}" y="${y}" font-family="${opts.font ?? FONT}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${fill}"${opts.opacity !== undefined ? ` fill-opacity="${opts.opacity}"` : ""} direction="${dir}" text-anchor="${anchor}" xml:space="preserve">${escapeXml(text)}</text>`;
}

/** ألوانُ البطاقة ونسخةُ الشعار ولونُ النمط — من دليل الهوية (`docs/brand/KIT-README.md`)، لا اجتهاداً.
 *
 *  **قرار المؤسس:** كل بطاقةٍ بلون قسمها كاملاً (واللجنةُ بلون قسمها)، والشعارُ **بنسخته الرسمية لذلك اللون** —
 *  مفرَّغاً بلونٍ واحد على Mahogany (Beige) وGreen Sheen (Temptress)، وبنسختيه المعتمدتين على Beige وTemptress — لا
 *  لوحةَ خلفه ولا تلوينَ له. ولونٍ غيرِ الأربعة: النسخةُ المفرَّغة التي تقرأ عليه (Beige على الداكن، Temptress على
 *  الفاتح). والنمطُ بلون الدليل: Mahogany على Beige، وBeige على Temptress والداكن، وTemptress على Green Sheen والفاتح. */
type LogoFile = "on-beige" | "on-temptress" | "on-mahogany" | "on-green-sheen";
type PatternColor = "beige" | "temptress" | "mahogany" | "green-sheen";
function palette(colorHex: string | null | undefined) {
  // لونٌ سداسيٌّ صريحٌ وحده يدخل الـSVG؛ وما سواه (قيمةٌ معطوبة) يُرسم بلون الهوية الافتراضي
  const raw = colorHex?.trim() ?? "";
  const bg = (/^#[0-9A-Fa-f]{6}$/.test(raw) ? raw : BRAND.temptress).toUpperCase();
  const onLight = themeFromColor(bg).text === BRAND.ink;
  const ink = onLight ? BRAND.temptress : BRAND.beige;
  const official: Record<string, [LogoFile, PatternColor]> = {
    [BRAND.beige.toUpperCase()]: ["on-beige", "mahogany"],
    [BRAND.temptress.toUpperCase()]: ["on-temptress", "beige"],
    [BRAND.mahogany.toUpperCase()]: ["on-mahogany", "beige"],
    [BRAND.greenSheen.toUpperCase()]: ["on-green-sheen", "temptress"],
  };
  const [logo, pattern] = official[bg] ?? (onLight ? ["on-green-sheen", "temptress"] : ["on-mahogany", "beige"]);
  return { bg, onLight, ink, logo: logo as LogoFile, pattern: pattern as PatternColor };
}

/** وزنُ الاسم البطل: ملفُّ ExtraBold من خطّ الهوية (Bold فيه خفيفٌ بطبعه) */
const HERO = 900;

/** شبكةُ البطاقتين (قرار المؤسس): **عمودُ الأنماط طوليٌّ على الجانب** — عمودُ «موهبة» ثم عمودُ «ابتكار»، كلٌّ بعرض
 *  بلاطةٍ واحدة وبطول البطاقة — والمحتوى إلى يمينه على لونٍ صلب (لا نمطَ خلف نص). ولا يُستعمل نمطُ «ربط». */
// بلاطاتٌ كاملة فقط: ١٨ صفاً (١٢٩٦) في وسط ارتفاع البطاقة (١٣٥٠) — لا شكلَ مقطوعاً عند الحافتين
const COLUMN = { x: 0, w: 2 * 72, rows: 18, y: (1350 - 18 * 72) / 2 };
const L = COLUMN.w + 66;
const R = 1080 - 90;
const ROW = { rule: 1100, label: 1152, value: 1202, extra: 1266 };

/** الشعارُ الرسمي بنسخة اللون — موضعٌ واحدٌ وحجمٌ واحد في البطاقتين (٢٤٠٠×٧٠٦ في الأصل) */
const LOGO = { w: 340, h: 100, top: 72 };
function lockupSvg(p: ReturnType<typeof palette>, right: number): string {
  return `<image href="${logoUri(p.logo)}" x="${right - LOGO.w}" y="${LOGO.top}" width="${LOGO.w}" height="${LOGO.h}"/>`;
}

/** شارةُ القسم أعلى اليسار — مشتركةٌ بين البطاقتين، بحبرٍ صريح بلا شفافية */
async function deptChip(p: ReturnType<typeof palette>, dept: string, left: number): Promise<string> {
  const w = Math.min(420, (await textWidth(dept, 26)) + 56);
  return `<rect x="${left}" y="93" width="${w}" height="58" rx="29" fill="none" stroke="${p.ink}" stroke-width="2"/>${t(dept, left + w / 2, 131, 26, p.ink, { weight: 700, anchor: "middle" })}`;
}

/** **النمطُ في عمودٍ منفصل لا خلف النص** (قاعدة الدليل)، بمقاس M للبطاقات وبلاطاتٍ كاملة على شبكةٍ واحدة:
 *  «موهبة» — النمطُ الأساسي — و«ابتكار» متجاوران. */
const TILE = 72;
const patternCache = new Map<string, string>();
function patternTile(kind: "talent" | "innovation" | "link", color: PatternColor): string {
  const key = `${kind}_${color}`;
  const hit = patternCache.get(key);
  if (hit) return hit;
  const raw = readFileSync(join(BRAND_DIR, "2026", "patterns", `pattern-${kind}_M_${color}.svg`), "utf8");
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  patternCache.set(key, inner);
  return inner;
}
function patternColumns(p: ReturnType<typeof palette>): string {
  return (["talent", "innovation"] as const)
    .map((kind, i) => {
      const x = COLUMN.x + i * TILE;
      const id = `pat-${kind}-${p.pattern}`;
      return `<defs><pattern id="${id}" x="${x}" y="${COLUMN.y}" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse">${patternTile(kind, p.pattern)}</pattern></defs><rect x="${x}" y="${COLUMN.y}" width="${TILE}" height="${COLUMN.rows * TILE}" fill="url(#${id})"/>`;
    })
    .join("");
}

async function toPng(svg: string): Promise<Buffer> {
  ensureFonts();
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export type InviteCardData = {
  fullName: string;
  /** الموقع الذي دُعي إليه بصيغةٍ لا تحتاج جنساً: «قيادة قسم التقنية» */
  position: string;
  /** المسمّى الذي حدّدته الإدارة الداعية — إن وُجد */
  jobTitle: string | null;
  departmentName: string | null;
  colorHex: string | null;
  invitedByName: string | null;
  issuedAt: Date;
};

/** ملصقُ الدعوة — المفهوم «ب»: لونُ القسم يملأ الإطار، والاسمُ بطلُه.
 *
 *  وليس ترحيباً: من وصله لم يُعتمد بعد. فيقول «دعوة خاصّة» ومَن دعاه،
 *  والترحيبُ يأتي ببطاقة العضوية عند الاعتماد. */
export async function renderInviteCard(d: InviteCardData): Promise<Buffer> {
  // الخطوط قبل أوّل رسم — والقياسُ رسمٌ أيضاً: لو سبقها لقرأ fontconfig
  // إعداد النظام مرّةً وثبّته، فيُرسم كلُّ ما بعده بخطٍّ غير خطّ الهوية
  ensureFonts();
  const p = palette(d.colorHex);
  const first = firstName(d.fullName);
  const firstSize = await fit(first, 200, R - L, 110, HERO);
  const fullSize = await fit(d.fullName, 34, 380, 22);
  const byName = d.invitedByName?.trim() || "إدارة تلاق";
  const bySize = await fit(byName, 34, 360, 22);
  const chip = await deptChip(p, d.departmentName?.trim() || "تلاق", L);
  const role = d.jobTitle?.trim() ? `${d.position} · ${d.jobTitle.trim()}` : d.position;
  const roleSize = await fit(role, 36, R - L, 24);
  const nameY = 460 + firstSize;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  ${lockupSvg(p, R)}
  ${chip}
  ${patternColumns(p)}
  ${t("دعوة خاصّة", R, 440, 40, p.ink, { weight: 700 })}
  ${t(first, R, nameY, firstSize, p.ink, { weight: HERO })}
  ${t("للانضمام إلى فريق تلاق", R, nameY + 84, 44, p.ink)}
  ${t(role, R, nameY + 146, roleSize, p.ink, { weight: 700 })}
  <line x1="${L}" y1="${ROW.rule}" x2="${R}" y2="${ROW.rule}" stroke="${p.ink}" stroke-width="2"/>
  ${t("الاسم", R, ROW.label, 24, p.ink)}
  ${t(d.fullName, R, ROW.value, fullSize, p.ink, { weight: 700 })}
  ${t("بدعوةٍ من", L, ROW.label, 24, p.ink, { anchor: "left" })}
  ${t(byName, L, ROW.value, bySize, p.ink, { weight: 700, anchor: "left" })}
  ${t(cardDate(d.issuedAt), L, ROW.extra, 24, p.ink, { anchor: "left" })}
</svg>`;
  return toPng(svg);
}

export type WelcomeCardData = {
  fullName: string;
  /** «أهلاً بك» أو «أهلاً بكِ» — بجنس صاحبها */
  greeting: string;
  /** المسمّى تحت الاسم: المسمّى الوظيفي، أو الصفة إن لم يكن له مسمّى */
  title: string;
  /** الصفة بجنسها: «قائدة قسم التسويق»، «عضوة» */
  roleTitle: string;
  /** «انضمّ في» أو «انضمّت في» */
  joinedLabel: string;
  joinedAt: Date;
  departmentName: string | null;
  colorHex: string | null;
};

/** **علامةُ الشعار الرسمية** بنسختها لذلك اللون — الملفُّ نفسُه من حزمة الهوية، مصغَّراً لا ملوَّناً */
const MARK_FOR: Record<LogoFile, string> = {
  "on-temptress": "TLAQI-mark_mahogany.png",
  "on-beige": "TLAQI-mark_mahogany.png",
  "on-mahogany": "TLAQI-mark_beige.png",
  "on-green-sheen": "TLAQI-mark_temptress.png",
};
/** للفحص الآلي: نسخةُ الشعار وعلامتُه لكل لون كما اعتمدها المؤسس (نوفمبر 2026) — `scripts/check-brand-identity.ts` */
export function approvedLogoFor(colorHex: string): { logo: LogoFile; mark: string } {
  const logo = palette(colorHex).logo;
  return { logo, mark: MARK_FOR[logo] };
}


/** شكلُ النمط بأيّ لون: البلاطةُ الرسمية نفسُها (Beige) بتعبئةٍ أخرى — لا رسمَ جديداً */
function motifShape(kind: "talent" | "innovation", fill: string): string {
  return patternTile(kind, "beige").replace(/fill="#EEF6DF"/gi, `fill="${fill}"`);
}
/** الشكلُ متمركزاً على (cx, cy) بنصف قطرٍ تقريبيّ r — البلاطةُ ٧٢ والشكلُ يمتدّ نحو ٢١ من مركزها */
function motifAt(kind: "talent" | "innovation", fill: string, cx: number, cy: number, r: number, opacity = 1): string {
  const s = r / 21;
  return `<g opacity="${opacity}" transform="translate(${cx} ${cy}) scale(${s.toFixed(3)}) translate(-36 -36)">${motifShape(kind, fill)}</g>`;
}
/** «ربط»: قوسٌ واحدٌ من بلاطته الرسمية (طرفاه نقطتان) متمركزاً على (cx, cy) بنصف عرضٍ r — القوسُ يمتدّ نحو ١٢ */
function linkAt(fill: string, cx: number, cy: number, r: number, opacity = 1): string {
  const arc = (patternTile("link", "beige").match(/<path[^>]*transform="translate\(18 18\)"[^>]*\/>/) ?? [""])[0];
  const s = r / 12;
  return `<g opacity="${opacity}" transform="translate(${cx} ${cy}) scale(${s.toFixed(3)}) translate(-18 -18)">${arc.replace(/fill="#EEF6DF"/gi, `fill="${fill}"`)}</g>`;
}
type Motif = "talent" | "innovation" | "link";
function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** يكسر النصَّ أسطراً لا يتجاوز كلٌّ منها العرضَ — بالقياس لا بعدّ الحروف */
async function wrapText(text: string, size: number, maxW: number, weight = 700): Promise<string[]> {
  const lines: string[] = [];
  let line = "";
  for (const w of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (line && (await textWidth(next, size, weight)) > maxW) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  // سطران: يُوازَن بينهما فلا تبقى كلمةٌ وحيدةٌ في الثاني
  if (lines.length === 2) {
    const ws = text.trim().split(/\s+/);
    let best = lines;
    let bestW = Infinity;
    for (let i = 1; i < ws.length; i++) {
      const pair = [ws.slice(0, i).join(" "), ws.slice(i).join(" ")];
      const w = Math.max(await textWidth(pair[0], size, weight), await textWidth(pair[1], size, weight));
      if (w <= maxW && w < bestW) [best, bestW] = [pair, w];
    }
    return best;
  }
  return lines;
}

/** **بطاقةُ الانضمام (العضوية)** — التصميمُ الذي اعتمده المؤسس (نوفمبر 2026)، على فكرة الملف الرسمي لا غلافِه:
 *  - **يساراً:** أعمدةُ الأنماط الثلاثة بلون القسم بمقاس M — «موهبة» ثم «ربط» (مزاحٌ نصفَ خطوة) ثم «ابتكار».
 *  - **يميناً:** الشعار و«تحوّل رقمي، برؤية طموحة.»، ثم «بطاقة انضمام» و«أهلاً بك في العائلة»، ثم **الاسمُ بطلاً**
 *    وتحته خطٌّ قصيرٌ بلون القسم والمسمّى، ثم **جملةُ القسم** في لوحةٍ ناعمة، ثم كبسولاتُ القسم والصفة والتاريخ، ثم
 *    **رحلةُ TLAQI** (مبدأُ الهوية الرسميّ: حرفٌ ومعناه بالإنجليزية والعربية)، ثم توقيع «فريق TLAQI».
 *  - **بلا خطوطٍ فاصلة** (قرار المؤسس): لا تبدو غلافَ كتابٍ أو ملف.
 *  - **الألوان:** صفحةٌ Beige وأنماطٌ بلون القسم؛ والإدارةُ العليا بنفسجيةٌ كاملة؛ والموارد البشرية (Beige) أنماطُها بنفسجية.
 *
 *  تصل مع رسالة الاعتماد وحدها: هي الإعلان أنّ صاحبها صار منّا. */
export async function renderWelcomeCard(d: WelcomeCardData): Promise<Buffer> {
  ensureFonts();
  const accent = palette(d.colorHex).bg;
  // ألوانُ الصفحة (قرار المؤسس): الإدارةُ العليا بنفسجيةٌ كاملة وأنماطُها Beige؛ والموارد البشرية (لونُها Beige) صفحتُها
  // Beige وأنماطُها وحدها بنفسجية؛ وسائرُ الأقسام صفحةٌ Beige وأنماطٌ بلونها
  const frame = contrast(accent, BRAND.temptress) < 1.25;
  const faded = !frame && contrast(accent, BRAND.beige) < 1.5;
  const page = frame ? BRAND.temptress : BRAND.beige;
  const ink = frame ? BRAND.beige : BRAND.temptress;
  const pat = frame ? BRAND.beige : faded ? BRAND.temptress : accent;
  const onPat = themeFromColor(pat).text === BRAND.ink ? BRAND.temptress : BRAND.beige;
  const logo: LogoFile = frame ? "on-temptress" : "on-beige";
  const dept = d.departmentName?.trim() || "TLAQI";
  const motto = departmentBrand(d.departmentName).copy.motto;
  const RX = CARD_W - 90; // حافةُ الكلام يميناً
  const LX = 450; // حدُّه يساراً
  const TW = RX - LX;

  // ── الأنماط: ثلاثةُ أعمدة، خطوتُها ١٣٠، والأوسطُ مزاحٌ نصفَ خطوة — نسيجٌ لا شبكةٌ صمّاء
  const STEP = 130;
  const cols: [kind: Motif, x: number, offset: number][] = [
    ["talent", 72, 0],
    ["link", 202, STEP / 2],
    ["innovation", 332, 0],
  ];
  let patterns = "";
  for (const [kind, x, offset] of cols) {
    for (let y = 25 + offset - STEP; y < CARD_H + 60; y += STEP) {
      patterns += kind === "link" ? linkAt(pat, x, y + 4, 36) : motifAt(kind, pat, x, y, 36);
    }
  }

  // ── الاسمُ بطلُ البطاقة: سطرٌ واحدٌ كبير، أو سطران متوازنان إن طال
  const words = d.fullName.trim().split(/\s+/);
  let nameLines = [d.fullName.trim()];
  let nameSize = await fit(nameLines[0], 88, TW, 30, HERO);
  if (nameSize < 62 && words.length > 1) {
    let best: [string, string] = [words.slice(0, 1).join(" "), words.slice(1).join(" ")];
    let bestDiff = Infinity;
    // لا ينتهي السطرُ الأولُ بكلمةٍ تتعلّق بما بعدها («بن»، «عبد»، «أبو»، «آل»)
    const binds = new Set(["بن", "بنت", "ابن", "عبد", "أبو", "ابو", "آل"]);
    for (let i = 1; i < words.length; i++) {
      if (binds.has(words[i - 1])) continue;
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      const diff = Math.abs(a.length - b.length);
      if (diff < bestDiff) [best, bestDiff] = [[a, b], diff];
    }
    nameLines = best;
    nameSize = Math.min(await fit(best[0], 70, TW, 40, HERO), await fit(best[1], 70, TW, 40, HERO));
  }
  const lineH = Math.round(nameSize * 1.2);
  const tight = nameLines.length > 1 ? 0.6 : 1; // الاسمُ في سطرين يطوي الفراغاتِ لا المحتوى

  const welcome = `${d.greeting} في العائلة`;
  const welcomeSize = await fit(welcome, 36, TW, 24);
  const jobSize = await fit(d.title, 27, TW, 18);

  // ── المواضع من الأعلى، بفراغاتٍ متناسبة
  let y = 300;
  const eyebrowY = y;
  y += 70;
  const welcomeY = y;
  y += Math.round(nameSize * 1.25);
  const nameY = y;
  y += (nameLines.length - 1) * lineH;
  const nameEnd = y;
  const barY = nameEnd + 30;
  const jobY = nameEnd + 86;

  // ── جملةُ القسم: لوحةٌ ناعمةٌ بلون القسم، فيها شكلُ «موهبة» صغيراً والجملةُ بخطٍّ عريض
  const mottoSize = 27;
  const mottoLines = await wrapText(motto, mottoSize, TW - 110);
  const mottoTop = jobY + Math.round(46 * tight) + 14;
  const mottoH = 52 + mottoLines.length * 44;
  const mottoSvg =
    `<rect x="${LX}" y="${mottoTop}" width="${TW}" height="${mottoH}" rx="22" fill="${pat}" fill-opacity="${frame ? 0.1 : 0.13}"/>` +
    motifAt("talent", pat, RX - 36, mottoTop + 40, 15) +
    mottoLines.map((l, i) => t(l, RX - 72, mottoTop + 52 + i * 44, mottoSize, ink, { weight: 700 })).join("");

  // ── بياناتُ العضوية كبسولات: القسمُ ممتلئٌ بلونه، والصفةُ والتاريخ بإطارٍ رفيع
  const pills: [text: string, filled: boolean][] = [
    [dept, true],
    [d.roleTitle, false],
    [`${d.joinedLabel} ${cardDate(d.joinedAt)}`, false],
  ];
  const pillTop = mottoTop + mottoH + Math.round(34 * tight);
  const PH = 50;
  let px = RX;
  let py = pillTop;
  let pillSvg = "";
  for (const [text, filled] of pills) {
    const size = await fit(text, 21, TW - 40, 14);
    const w = Math.round((await textWidth(text, size)) + 44);
    if (px - w < LX - 1 && px !== RX) {
      px = RX;
      py += PH + 12;
    }
    pillSvg += filled
      ? `<rect x="${px - w}" y="${py}" width="${w}" height="${PH}" rx="${PH / 2}" fill="${pat}"/>` +
        t(text, px - 22, py + 33, size, onPat, { weight: 700 })
      : `<rect x="${px - w}" y="${py}" width="${w}" height="${PH}" rx="${PH / 2}" fill="none" stroke="${ink}" stroke-opacity="0.35" stroke-width="1.6"/>` +
        t(text, px - 22, py + 33, size, ink, { weight: 700 });
    px -= w + 12;
  }
  const pillsEnd = py + PH;

  // ── الرحلة: مبدؤنا الرسميّ من دليل الهوية — TLAQI يُقرأ كما يُكتب (T يساراً)، وتحت كلِّ حرفٍ معناه بالإنجليزية
  // والعربية، وأولُ المحطّات «موهبة» ممتلئة: من هنا تبدأ الرحلة
  const J = pillsEnd + Math.round(66 * tight);
  const steps: [letter: string, en: string, ar: string][] = [
    ["T", "TALENT", "موهبة"],
    ["L", "LINK", "ربط"],
    ["A", "ADVANCING", "تقدّم"],
    ["Q", "QUALITY", "جودة"],
    ["I", "INNOVATION", "ابتكار"],
  ];
  const span = TW - 64;
  const xs = steps.map((_, i) => LX + 32 + (i * span) / (steps.length - 1));
  let journey = t("رحلتك معنا", RX, J, 19, ink, { opacity: 0.66 });
  for (let i = 0; i < steps.length - 1; i++) {
    journey += `<line x1="${xs[i] + 14}" y1="${J + 78}" x2="${xs[i + 1] - 14}" y2="${J + 78}" stroke="${pat}" stroke-opacity="0.55" stroke-width="2.5" stroke-dasharray="2 8" stroke-linecap="round"/>`;
  }
  steps.forEach(([letter, en, ar], i) => {
    journey += t(letter, xs[i], J + 56, 40, pat, { weight: HERO, anchor: "middle", ltr: true });
    journey +=
      i === 0
        ? `<circle cx="${xs[i]}" cy="${J + 78}" r="8" fill="${pat}"/>`
        : `<circle cx="${xs[i]}" cy="${J + 78}" r="7" fill="${page}" stroke="${pat}" stroke-width="2.5"/>`;
    journey += t(en, xs[i], J + 112, 13, ink, { anchor: "middle", ltr: true, weight: 700, opacity: 0.7, font: LATIN });
    journey += t(ar, xs[i], J + 142, 21, ink, { anchor: "middle", weight: i === 0 ? 700 : 400 });
  });

  // ── الختام: توقيعٌ لا سطرُ غلاف — «مع خالص الترحيب، فريق TLAQI»
  const teamW = await textWidth("فريق", 26, HERO);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <rect width="100%" height="100%" fill="${page}"/>
  ${patterns}

  <image href="${logoUri(logo)}" x="${RX - 280}" y="92" width="280" height="${Math.round((280 * 706) / 2400)}"/>
  ${t("تحوّل رقمي، برؤية طموحة.", RX, 214, 21, ink, { opacity: 0.8 })}

  ${t("بطاقة انضمام", RX, eyebrowY, 21, ink, { weight: 700, opacity: 0.75 })}
  ${t(welcome, RX, welcomeY, welcomeSize, ink, { weight: 700, opacity: 0.88 })}
  ${nameLines.map((l, i) => t(l, RX, nameY + i * lineH, nameSize, ink, { weight: HERO })).join("")}
  <rect x="${RX - 76}" y="${barY}" width="76" height="7" rx="3.5" fill="${pat}"/>
  ${t(d.title, RX, jobY, jobSize, ink, { opacity: 0.85 })}

  ${mottoSvg}
  ${pillSvg}
  ${journey}

  ${t("مع خالص الترحيب،", RX, 1236, 20, ink, { opacity: 0.72 })}
  ${t("فريق", RX, 1276, 26, ink, { weight: HERO })}
  ${t("TLAQI", RX - teamW - 10, 1275, 25, ink, { weight: 700, ltr: true, anchor: "right", font: LATIN })}
  ${t("@tlaqisa", LX, 1274, 21, ink, { anchor: "left", ltr: true, font: LATIN, opacity: 0.75 })}
</svg>`;
  return toPng(svg);
}
