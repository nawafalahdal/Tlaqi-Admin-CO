import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { BRAND, themeFromColor } from "@/lib/brand";
import { ensureFonts } from "@/lib/welcomeBanner";
import { firstName } from "@/lib/personName";

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

/** **بطاقةُ الانضمام (العضوية)** — التصميمُ الذي اعتمده المؤسس (نوفمبر 2026)، **مجموعاً واضحاً** (قراره بعد المعاينة):
 *  الرسالةُ تحمل التفاصيل، فالبطاقةُ لا تُعيدها. وكلُّ ما فيها **كتلةٌ واحدةٌ متمركزة** لا قطعٌ متفرّقة:
 *  - **يساراً:** أعمدةُ الأنماط الثلاثة بلون القسم بمقاس M — «موهبة» ثم «ربط» (مزاحٌ نصفَ خطوة) ثم «ابتكار».
 *  - **يميناً:** الشعارُ الرسميّ، وتحته لوحةُ العضوية مدمجةً بهواءٍ حولها: «بطاقة انضمام»، **الاسمُ بطلاً** والمسمّى، القسمُ والصفة
 *    وتاريخُ الانضمام سطرين، ثم **شريطُ TLAQI** (مبدأُ الهوية: الحرفُ ومعناه بالإنجليزية والعربية) — هويةٌ واضحة.
 *  - **الألوان:** صفحةٌ Beige وأنماطٌ بلون القسم؛ والإدارةُ العليا بنفسجيةٌ كاملة؛ والموارد البشرية (Beige) أنماطُها بنفسجية.
 *
 *  تصل مع رسالة الاعتماد وحدها: هي الإعلان أنّ صاحبها صار منّا. */
export async function renderWelcomeCard(d: WelcomeCardData): Promise<Buffer> {
  ensureFonts();
  const accent = palette(d.colorHex).bg;
  const frame = contrast(accent, BRAND.temptress) < 1.25;
  const faded = !frame && contrast(accent, BRAND.beige) < 1.5;
  const page = frame ? BRAND.temptress : BRAND.beige;
  const ink = frame ? BRAND.beige : BRAND.temptress;
  const pat = frame ? BRAND.beige : faded ? BRAND.temptress : accent;
  const onPat = themeFromColor(pat).text === BRAND.ink ? BRAND.temptress : BRAND.beige;
  const logo: LogoFile = frame ? "on-temptress" : "on-beige";
  const dept = d.departmentName?.trim() || "TLAQI";

  // ── الأنماط: ثلاثةُ أعمدة، خطوتُها ١٣٠، والأوسطُ مزاحٌ نصفَ خطوة — تقطعها الحافتان قليلاً
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

  // ── اللوحة: عمودُ الكلام كلُّه داخلها، بحاشيةٍ واحدةٍ وحافةٍ يمنى واحدة
  // لوحةٌ مدمجة (قرار المؤسس: «حتى لو تصغر»): أضيقُ وأقصر، وحولها هواء — في منتصف ما يمين الأنماط
  const PX0 = 492, PX1 = CARD_W - 76; // حدّا اللوحة
  const PAD = 40;
  const RX = PX1 - PAD; // الحافةُ اليمنى للكلام
  const LX = PX0 + PAD;
  const TW = RX - LX;

  // ── الاسمُ بطلُ البطاقة: سطرٌ واحدٌ كبير، أو سطران متوازنان إن طال
  const words = d.fullName.trim().split(/\s+/);
  let nameLines = [d.fullName.trim()];
  let nameSize = await fit(nameLines[0], 72, TW, 30, HERO);
  if (nameSize < 52 && words.length > 1) {
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
    nameSize = Math.min(await fit(best[0], 58, TW, 34, HERO), await fit(best[1], 58, TW, 34, HERO));
  }
  const lineH = Math.round(nameSize * 1.2);
  const extra = (nameLines.length - 1) * lineH;
  const jobSize = await fit(d.title, 24, TW, 16);

  // ── القسمُ والصفة سطرٌ عريضٌ بينهما نقطةٌ بلون القسم، والتاريخُ سطرٌ هادئٌ تحته
  const roleSize0 = await fit(`${dept}  ${d.roleTitle}`, 26, TW - 30, 15, HERO);
  const deptW = await textWidth(dept, roleSize0, HERO);
  const joined = `${d.joinedLabel} ${cardDate(d.joinedAt)}`;
  const joinedSize = await fit(joined, 21, TW, 15);

  // ── المواضع: الشعارُ واللوحةُ كتلةٌ واحدةٌ متمركزةٌ عمودياً في الصفحة
  const LOGO_W = 320;
  const LOGO_H = Math.round((LOGO_W * 706) / 2400);
  const GAP = 50; // بين الشعار واللوحة
  const tagH = 42;
  const BAND = 176; // ارتفاعُ شريط TLAQI
  const inner = PAD + tagH + 28 + nameSize + extra + 50 + 66 + 38 + 40 + BAND + PAD - 6; // ارتفاعُ اللوحة
  const groupH = LOGO_H + GAP + inner;
  const top = Math.round((CARD_H - groupH) / 2);
  const PY0 = top + LOGO_H + GAP;
  const PY1 = PY0 + inner;
  const tagY = PY0 + PAD;
  const nameY = tagY + tagH + 28 + nameSize;
  const nameEnd = nameY + extra;
  const jobY = nameEnd + 50;
  const roleY = jobY + 66;
  const joinedY = roleY + 38;
  const B0 = joinedY + 40; // شريطُ TLAQI
  const B1 = B0 + BAND;

  const tag = "بطاقة انضمام";
  const tagW = Math.round((await textWidth(tag, 19)) + 40);

  // ── شريطُ TLAQI: مبدؤنا الرسميّ — الحروفُ تُقرأ كما تُكتب (T يساراً)، وتحت كلٍّ معناه بالإنجليزية والعربية
  const steps: [letter: string, en: string, ar: string][] = [
    ["T", "TALENT", "موهبة"],
    ["L", "LINK", "ربط"],
    ["A", "ADVANCING", "تقدّم"],
    ["Q", "QUALITY", "جودة"],
    ["I", "INNOVATION", "ابتكار"],
  ];
  const BX0 = LX, BX1 = RX;
  const span = BX1 - BX0 - 92;
  const xs = steps.map((_, i) => BX0 + 46 + (i * span) / (steps.length - 1));
  let band = `<rect x="${BX0}" y="${B0}" width="${BX1 - BX0}" height="${B1 - B0}" rx="20" fill="${pat}" fill-opacity="${frame ? 0.12 : 0.14}"/>`;
  band += t("رحلتك معنا", BX1 - 24, B0 + 38, 18, ink, { weight: 700, opacity: 0.75 });
  steps.forEach(([letter, en, ar], i) => {
    band += t(letter, xs[i], B0 + 98, 48, pat, { weight: HERO, anchor: "middle", ltr: true });
    band += t(en, xs[i], B0 + 126, 11.5, ink, { anchor: "middle", ltr: true, weight: 700, opacity: 0.7, font: LATIN });
    band += t(ar, xs[i], B0 + 156, 19, ink, { anchor: "middle", weight: 700 });
  });

  const panelFill = frame ? `fill="#FFFFFF" fill-opacity="0.07"` : `fill="#FFFFFF" fill-opacity="0.62"`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <defs>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur in="SourceAlpha" stdDeviation="18"/><feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope="${frame ? 0.35 : 0.12}"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" fill="${page}"/>
  ${patterns}

  <image href="${logoUri(logo)}" x="${PX1 - LOGO_W}" y="${top}" width="${LOGO_W}" height="${LOGO_H}"/>

  <g filter="url(#soft)"><rect x="${PX0}" y="${PY0}" width="${PX1 - PX0}" height="${PY1 - PY0}" rx="30" ${panelFill}/></g>
  <rect x="${RX - tagW}" y="${tagY}" width="${tagW}" height="${tagH}" rx="${tagH / 2}" fill="${pat}"/>
  ${t(tag, RX - 20, tagY + 28, 19, onPat, { weight: 700 })}
  ${nameLines.map((l, i) => t(l, RX, nameY + i * lineH, nameSize, ink, { weight: HERO })).join("")}
  ${t(d.title, RX, jobY, jobSize, ink, { opacity: 0.82 })}
  ${t(dept, RX, roleY, roleSize0, ink, { weight: HERO })}
  <circle cx="${RX - deptW - 15}" cy="${roleY - roleSize0 * 0.3}" r="5" fill="${pat}"/>
  ${t(d.roleTitle, RX - deptW - 30, roleY, roleSize0, ink, { weight: HERO })}
  ${t(joined, RX, joinedY, joinedSize, ink, { opacity: 0.75 })}
  ${band}
</svg>`;
  return toPng(svg);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
/** **بطاقةُ العمل (Business Card)** — مقترحٌ للمعاينة، لم يُربط بصفحةٍ بعد (بانتظار اعتماد المؤسس).
 *
 *  **رسميةٌ على طريقة بطاقات الجهات** (مرجعُ المؤسس، نوفمبر 2026)، بمقاس البطاقة الرسمي **CR80 طولياً (٥٤×٨٥٫٦ مم)**
 *  وبدقّة الطباعة (٦٠٠ نقطة/بوصة):
 *  - **الوجه:** الشعارُ الكامل (العلامةُ واسمُنا TLAQI) أعلى اليمين، وصورةٌ شخصيةٌ مستطيلة (صورةُ هوية) بإطارٍ رفيعٍ بلون
 *    القسم، وشريطٌ عموديٌّ يساراً بلون القسم يحمل اسمَه، وكتلةٌ سفلى بلون الهوية (Temptress) فيها الاسمُ والمنصبُ والمهمّة.
 *  - **الظهر:** Temptress كاملاً والشعارُ الكاملُ في منتصفه.
 *  - **النمطُ بطريقته:** بلاطةُ «موهبة» الرسمية مكرّرةً بمقاس L نسيجاً خافتاً في الكتلة السفلى وعلى الظهر — بقرار المؤسس.
 *    (يخالف هذا قواعدَ في الدليل: «لا نمط خلف نص»، و«لا شفافية»، و«الشعارُ الكامل لا يقلّ عن ٧٠ مم» — والبطاقةُ عرضُها ٥٤.
 *    والقرارُ للمؤسس، ومذكورٌ في سجلّ الهوية.)
 *  - **الألوان:** الشريطُ بلون القسم؛ والموارد البشرية (Beige) شريطُها Beige بحدٍّ بنفسجيّ كي يُرى؛ والإدارة العليا بنفسجيّ. */
export const BIZ_MM = { w: 54, h: 85.6 } as const;
const BIZ_PX_PER_MM = 600 / 25.4;
const mm = (v: number) => Math.round(v * BIZ_PX_PER_MM);

export type BusinessCardData = {
  fullName: string;
  /** المنصب كما تقوله المنصة: «قائدة قسم التسويق»، «الرئيس التنفيذي»، «عضو» */
  position: string;
  /** المهمّة: المسمّى الوظيفي كما سجّله صاحبه — يُترك سطرُه إن غاب */
  task: string | null;
  departmentName: string | null;
  colorHex: string | null;
  /** صورتُه الشخصية كما رفعها — وبدونها الحرفُ الأول من اسمه */
  photo: Buffer | null;
};

/** نسيجُ «موهبة» الرسمي: بلاطةُ الدليل نفسُها (١٢٫٧ مم لـM) مكبّرةً إلى L (٢٥٫٤ مم) ومكرّرةً — خافتاً بشفافية `opacity`.
 *  تبدأ الشبكةُ من `x0, y0` فيتمركز النقشُ في المساحة لا يُقطع اعتباطاً */
function bizTexture(id: string, x0: number, y0: number, w: number, h: number, opacity: number): string {
  const L = mm(25.4);
  return `<defs><pattern id="${id}" x="${x0}" y="${y0}" width="${L}" height="${L}" patternUnits="userSpaceOnUse"><g transform="scale(${(L / TILE).toFixed(4)})">${patternTile("talent", "beige")}</g></pattern></defs>
  <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#${id})" opacity="${opacity}"/>`;
}
const LOGO_RATIO = 706 / 2400;

/** **الوجه:** الهويةُ الرسمية للشخص */
export async function renderBusinessCard(d: BusinessCardData): Promise<Buffer> {
  ensureFonts();
  const W = mm(BIZ_MM.w);
  const H = mm(BIZ_MM.h);
  const page = BRAND.beige;
  const block = BRAND.temptress;
  const accent = palette(d.colorHex).bg;
  const hr = contrast(accent, BRAND.beige) < 1.5; // Beige على Beige لا يُرى
  const strip = accent;
  const stripEdge = hr ? BRAND.temptress : contrast(accent, block) < 1.25 ? BRAND.beige : null;
  const onStrip = themeFromColor(strip).text === BRAND.ink ? BRAND.temptress : BRAND.beige;
  const frame = hr ? BRAND.temptress : accent;

  // ── الأبعاد
  const M = mm(5);
  const blockTop = mm(56);
  const stripX = mm(4);
  const stripW = mm(6.5);
  const stripBottom = blockTop + mm(5); // يدخل الكتلةَ قليلاً كما في بطاقات الجهات
  // الشعارُ الكامل: يمتدّ من حافة الإطار اليمنى، ولا يبلغ الشريط
  const logoW = mm(33);
  const logoH = Math.round(logoW * LOGO_RATIO);
  const PW = mm(24);
  const PH = mm(30);
  const PX = W - M - mm(1) - PW;
  const PY = mm(19);

  // ── النمطُ بطريقته: بلاطةُ «موهبة» مكرّرةً نسيجاً خافتاً في الكتلة وحدها كما في بطاقات الجهات — والصفحةُ فوقها نظيفة
  const L = mm(25.4);
  const faint = bizTexture("tex", Math.round(W / 2 - L * 1.5), blockTop, Math.round(L * 3), H - blockTop, 0.09);

  // ── الصورة: مستطيلةٌ بإطارٍ رفيعٍ وهامشٍ أبيضَ كصورة الهوية
  let portrait: string;
  if (d.photo) {
    const png = await sharp(d.photo).resize(PW, PH, { fit: "cover", position: "top" }).png().toBuffer();
    portrait = `<image href="data:image/png;base64,${png.toString("base64")}" x="${PX}" y="${PY}" width="${PW}" height="${PH}"/>`;
  } else {
    const initial = firstName(d.fullName).trim().charAt(0) || "T";
    portrait =
      `<rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" fill="${hr ? BRAND.temptress : accent}"/>` +
      t(initial, PX + PW / 2, PY + PH / 2 + mm(4), mm(12), hr ? BRAND.beige : onStrip, { anchor: "middle", weight: HERO });
  }
  const pad = mm(1);

  // ── الشريط: اسمُ القسم عمودياً يُقرأ من أعلى
  const dept = d.departmentName?.trim() || "TLAQI";
  const deptSize = await fit(dept, mm(3.3), blockTop - mm(12), mm(2.2), 700);
  const sx = stripX + stripW / 2;
  const sy = blockTop / 2;
  const stripLabel = `<g transform="translate(${sx} ${sy}) rotate(90)">${t(dept, 0, Math.round(deptSize * 0.35), deptSize, onStrip, { anchor: "middle", weight: 700 })}</g>`;

  // ── الكتلة: الاسمُ والمنصبُ والمهمّة، يميناً
  const RX = W - M;
  const TW = RX - M;
  const name = d.fullName.trim();
  let nameLines = [name];
  let nameSize = await fit(name, mm(4.4), TW, mm(3.2), HERO);
  const words = name.split(/\s+/);
  if (nameSize < mm(3.6) && words.length > 1) {
    const binds = new Set(["بن", "بنت", "ابن", "عبد", "أبو", "ابو", "آل"]);
    let best: [string, string] = [words[0], words.slice(1).join(" ")];
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      if (binds.has(words[i - 1])) continue;
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      const diff = Math.abs(a.length - b.length);
      if (diff < bestDiff) [best, bestDiff] = [[a, b], diff];
    }
    nameLines = best;
    nameSize = Math.min(await fit(best[0], mm(3.6), TW, mm(2.8), HERO), await fit(best[1], mm(3.6), TW, mm(2.8), HERO));
  }
  const posSize = await fit(d.position, mm(2.8), TW, mm(2.1), 700);
  const task = d.task?.trim() || null;
  const taskSize = task ? await fit(task, mm(2.5), TW, mm(2), 400) : 0;
  const nameStep = Math.round(nameSize * 1.2);
  const blockH =
    nameSize + (nameLines.length - 1) * nameStep + mm(2.2) + posSize + (task ? mm(1.4) + taskSize : 0);
  const zoneTop = stripBottom;
  let y = Math.round(zoneTop + (H - zoneTop - blockH) / 2 + nameSize * 0.85);
  let text = "";
  for (const line of nameLines) {
    text += t(line, RX, y, nameSize, BRAND.beige, { weight: HERO });
    y += nameStep;
  }
  y += -nameStep + mm(2.2) + posSize;
  text += t(d.position, RX, y, posSize, BRAND.beige, { weight: 700 });
  if (task) {
    y += mm(1.4) + taskSize;
    text += t(task, RX, y, taskSize, BRAND.beige);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
  <defs><clipPath id="blk"><rect x="0" y="${blockTop}" width="${W}" height="${H - blockTop}"/></clipPath></defs>
  <rect width="${W}" height="${H}" fill="${page}"/>
  <rect y="${blockTop}" width="${W}" height="${H - blockTop}" fill="${block}"/>
  ${faint}
  <rect x="${stripX}" y="0" width="${stripW}" height="${stripBottom}" fill="${strip}"${stripEdge ? ` stroke="${stripEdge}" stroke-width="${mm(0.3)}"` : ""}/>
  ${stripLabel}
  <image href="${logoUri("on-beige")}" x="${W - M - logoW}" y="${mm(6)}" width="${logoW}" height="${logoH}"/>
  <rect x="${PX - pad}" y="${PY - pad}" width="${PW + 2 * pad}" height="${PH + 2 * pad}" fill="${page}" stroke="${frame}" stroke-width="${mm(0.25)}"/>
  ${portrait}
  ${text}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** **الظهر:** Temptress كاملاً بنسيج «موهبة» الخافت، والشعارُ الكاملُ في منتصفه */
export async function renderBusinessCardReverse(): Promise<Buffer> {
  ensureFonts();
  const W = mm(BIZ_MM.w);
  const H = mm(BIZ_MM.h);
  const L = mm(25.4);
  const logoW = mm(42);
  const logoH = Math.round(logoW * LOGO_RATIO);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${BRAND.temptress}"/>
  ${bizTexture("tex", Math.round(W / 2 - L * 1.5), Math.round(H / 2 - L * 2), Math.round(L * 3), Math.round(L * 4), 0.08)}
  <image href="${logoUri("on-temptress")}" x="${Math.round((W - logoW) / 2)}" y="${Math.round(H / 2 - logoH / 2)}" width="${logoW}" height="${logoH}"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
