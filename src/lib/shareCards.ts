import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { BRAND, themeFromColor } from "@/lib/brand";
import { contrastRatio } from "@/lib/colors";
import { ensureFonts } from "@/lib/welcomeBanner";

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

let assetCache: { lockDark: string; lockLight: string; markAlpha: Buffer; markW: number; markH: number } | null =
  null;

function assets() {
  if (assetCache) return assetCache;
  const b64 = (f: string) => `data:image/png;base64,${readFileSync(join(BRAND_DIR, f)).toString("base64")}`;
  assetCache = {
    lockDark: b64("lockup-on-dark.png"),
    lockLight: b64("lockup-on-light.png"),
    markAlpha: readFileSync(join(BRAND_DIR, "symbol-mark.png")),
    markW: 512,
    markH: 725,
  };
  return assetCache;
}

/** الرمز الرسمي بلونٍ واحد — هندستُه من الأصل نفسه، ولونُه من القسم.
 *
 *  الأصل أبيضُ على شفافية؛ فيُؤخذ قناعُه (قناة الشفافية) ويُملأ باللون.
 *  فلا يُعاد رسمُ الرمز ولا يُقارَب بشكلٍ يشبهه. */
const tintCache = new Map<string, string>();
async function tintedMark(color: string, width: number): Promise<string> {
  const key = `${color}@${width}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const a = assets();
  // يُكبَّر القناع بمرشّحٍ ناعم قبل التلوين: تكبيرُه داخل SVG يُرسم
  // بحوافّ مسنّنة في الأحجام الكبيرة
  const height = Math.round((width * a.markH) / a.markW);
  const alpha = await sharp(a.markAlpha)
    .resize(width, height, { kernel: "lanczos3" })
    .extractChannel("alpha")
    // الأصل ٥١٢ بكسلاً: ما كُبِّر فوقه تَظهر درجاتُ حوافّه، فتُنعَّم قليلاً
    .blur(width > a.markW ? 1.6 : 0.3)
    .toBuffer();
  const h = color.replace("#", "");
  const png = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) },
    },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  const uri = `data:image/png;base64,${png.toString("base64")}`;
  tintCache.set(key, uri);
  return uri;
}

/** عرضُ النصّ كما يرسمه pango فعلاً — لا تقديراً بعدد الحروف.
 *
 *  الاسم أكبرُ ما في البطاقة، والتقديرُ يُخطئ في العربية (الحروف
 *  المتّصلة أعرض من المنفصلة بكثير). فيُرسم مرّةً وحده ويُقاس. */
async function textWidth(text: string, size: number, weight = 700): Promise<number> {
  const w = Math.ceil(text.length * size * 0.9) + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.ceil(size * 2)}"><text x="${w - 10}" y="${Math.ceil(size * 1.4)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="#000" direction="rtl" text-anchor="start">${escapeXml(text)}</text></svg>`;
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
  opts: { weight?: number; opacity?: number; anchor?: "right" | "left" | "middle"; ltr?: boolean } = {}
): string {
  const dir = opts.ltr ? "ltr" : "rtl";
  // في RTL: «start» هو اليمين. وفي LTR: «start» هو اليسار.
  const anchor =
    opts.anchor === "middle"
      ? "middle"
      : opts.ltr
        ? opts.anchor === "right" ? "end" : "start"
        : opts.anchor === "left" ? "end" : "start";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${fill}"${opts.opacity !== undefined ? ` fill-opacity="${opts.opacity}"` : ""} direction="${dir}" text-anchor="${anchor}" xml:space="preserve">${escapeXml(text)}</text>`;
}

/** ألوانُ البطاقة من لون القسم — والحبرُ بالتباين لا بقائمة استثناءات.
 *
 *  **نظامٌ واحد للبطاقتين (ملاحظة المؤسس: «كل لجنة بلونها الكامل»):** الخلفيةُ لونُ القسم كاملاً — واللجنةُ
 *  بلون قسمها — والشعارُ **دائماً** في لوحة Beige بالحجم والموضع نفسيهما. فالشعارُ لا يُرسم مباشرةً على لونٍ لم
 *  تُعتمد له نسخةٌ منه (دليل الهوية)، ورمزُه بلون Mahogany يذوب على خلفية Mahogany. وحين يكون القسمُ نفسُه
 *  بلونٍ قريبٍ من Beige تُحدَّد اللوحةُ بإطارٍ رفيع فلا تختفي. */
function palette(colorHex: string | null | undefined) {
  const bg = colorHex?.trim() || BRAND.temptress;
  const onLight = themeFromColor(bg).text === BRAND.ink;
  const ink = onLight ? BRAND.temptress : BRAND.beige;
  return {
    bg,
    onLight,
    ink,
    panelStroke: contrastRatio(BRAND.beige, bg) < 1.4 ? ink : null,
  };
}

/** وزنُ الاسم البطل: ملفُّ ExtraBold من خطّ الهوية */
const HERO = 900;

/** الشعارُ في لوحة Beige — موضعٌ واحدٌ وحجمٌ واحد في البطاقتين */
const LOGO = { w: 300, h: 88, top: 86, pad: 22 };
function lockupSvg(p: ReturnType<typeof palette>, right: number): string {
  const a = assets();
  const x = right - LOGO.w;
  return `<rect x="${x - LOGO.pad}" y="${LOGO.top - LOGO.pad}" width="${LOGO.w + LOGO.pad * 2}" height="${LOGO.h + LOGO.pad * 2}" rx="22" fill="${BRAND.beige}"${p.panelStroke ? ` stroke="${p.panelStroke}" stroke-opacity="0.22" stroke-width="2"` : ""}/><image href="${a.lockLight}" x="${x}" y="${LOGO.top}" width="${LOGO.w}" height="${LOGO.h}"/>`;
}

/** شارةُ القسم أعلى اليسار — مشتركةٌ بين البطاقتين */
async function deptChip(p: ReturnType<typeof palette>, dept: string, left: number): Promise<string> {
  const w = Math.min(420, (await textWidth(dept, 26)) + 56);
  return `<rect x="${left}" y="100" width="${w}" height="58" rx="29" fill="none" stroke="${p.ink}" stroke-opacity="0.45" stroke-width="2"/>${t(dept, left + w / 2, 138, 26, p.ink, { weight: 700, anchor: "middle" })}`;
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
  const a = assets();
  const mark = await tintedMark(p.ink, 900);
  const first = d.fullName.trim().split(/\s+/)[0] || d.fullName;
  const R = CARD_W - 90;
  // الاسمُ بطلُ البطاقة: بالوزن الأعرض من خطّ الهوية (ExtraBold = 900 في pango) — وBold فيه خفيفٌ بطبعه
  const firstSize = await fit(first, 210, 880, 120, HERO);
  const fullSize = await fit(d.fullName, 34, 430, 24);
  const byName = d.invitedByName?.trim() || "إدارة تلاق";
  const bySize = await fit(byName, 34, 400, 24);
  const dept = d.departmentName?.trim() || "تلاق";
  const chip = await deptChip(p, dept, 90);
  const role = d.jobTitle?.trim() ? `${d.position} · ${d.jobTitle.trim()}` : d.position;
  const roleSize = await fit(role, 38, 900, 26);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  <image href="${mark}" x="-230" y="300" width="900" height="${Math.round((900 * a.markH) / a.markW)}" opacity="${p.onLight ? 0.1 : 0.14}"/>
  ${lockupSvg(p, R)}
  ${chip}
  ${t("دعوة خاصّة", R, 560, 40, p.ink, { weight: 700, opacity: 0.85 })}
  ${t(first, R, 560 + firstSize * 1.05, firstSize, p.ink, { weight: HERO })}
  ${t("للانضمام إلى فريق تلاق", R, 560 + firstSize * 1.05 + 86, 44, p.ink, { weight: 400, opacity: 0.92 })}
  ${t(role, R, 560 + firstSize * 1.05 + 150, roleSize, p.ink, { weight: 700, opacity: 0.9 })}
  <line x1="90" y1="1140" x2="${R}" y2="1140" stroke="${p.ink}" stroke-opacity="0.25" stroke-width="2"/>
  ${t("الاسم", R, 1196, 24, p.ink, { opacity: 0.6 })}
  ${t(d.fullName, R, 1246, fullSize, p.ink, { weight: 700 })}
  ${t("بدعوةٍ من", 90, 1196, 24, p.ink, { opacity: 0.6, anchor: "left" })}
  ${t(byName, 90, 1246, bySize, p.ink, { weight: 700, anchor: "left" })}
  ${t(cardDate(d.issuedAt), 90, 1290, 22, p.ink, { opacity: 0.55, anchor: "left" })}
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

/** بطاقةُ العضوية — بلون القسم كاملاً، بنظام ملصق الدعوة نفسه (الشعار في لوحته، وشارةُ القسم، والرمز خلفيةً).
 *
 *  تصل مع رسالة الاعتماد وحدها: هي الإعلان أنّ صاحبها صار منّا. */
export async function renderWelcomeCard(d: WelcomeCardData): Promise<Buffer> {
  ensureFonts();
  const a = assets();
  const p = palette(d.colorHex);
  const mark = await tintedMark(p.ink, 900);
  const R = CARD_W - 90;
  const L = 90;
  const nameSize = await fit(d.fullName, 104, R - L, 60, HERO);
  const titleSize = await fit(d.title, 42, R - L, 28);
  const roleSize = await fit(d.roleTitle, 34, 440, 22);
  const dept = d.departmentName?.trim() || "تلاق";
  const chip = await deptChip(p, dept, L);
  const nameY = 560 + 70 + nameSize;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  <image href="${mark}" x="-230" y="300" width="900" height="${Math.round((900 * a.markH) / a.markW)}" opacity="${p.onLight ? 0.1 : 0.14}"/>
  ${lockupSvg(p, R)}
  ${chip}
  ${t("بطاقة انضمام", R, 560, 40, p.ink, { weight: 700, opacity: 0.85 })}
  ${t(`${d.greeting} في العائلة`, R, 630, 44, p.ink, { opacity: 0.92 })}
  ${t(d.fullName, R, nameY, nameSize, p.ink, { weight: HERO })}
  ${t(d.title, R, nameY + 74, titleSize, p.ink, { opacity: 0.9 })}
  <line x1="${L}" y1="1080" x2="${R}" y2="1080" stroke="${p.ink}" stroke-opacity="0.25" stroke-width="2"/>
  ${t(d.joinedLabel, R, 1136, 24, p.ink, { opacity: 0.6 })}
  ${t(cardDate(d.joinedAt), R, 1186, 34, p.ink, { weight: 700 })}
  ${t("الصفة", L, 1136, 24, p.ink, { opacity: 0.6, anchor: "left" })}
  ${t(d.roleTitle, L, 1186, roleSize, p.ink, { weight: 700, anchor: "left" })}
  ${t("تحوّل رقمي، برؤية طموحة.", R, 1276, 26, p.ink, { opacity: 0.7 })}
  ${t("@tlaqisa", L, 1276, 26, p.ink, { opacity: 0.7, ltr: true })}
</svg>`;
  return toPng(svg);
}
