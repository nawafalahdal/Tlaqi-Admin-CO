import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { BRAND, themeFromColor } from "@/lib/brand";
import { ensureFonts } from "@/lib/welcomeBanner";

/** صورتا المشاركة: ملصقُ الدعوة، وبطاقةُ العضوية.
 *
 *  **لماذا صورةٌ لا HTML؟** المطلوب أن يُصوِّر صاحبُها الشاشة فينشرها
 *  كما هي. والبريد لا يحمل خطَّ الهوية (Gmail يُسقط `@font-face`)،
 *  ويقلب الألوان في الوضع الداكن، ويرسم كلُّ عميلٍ الجداول بطريقته — فلا
 *  يصل التصميم مرّتين بالشكل نفسه. أما الصورة فتُرسَم هنا مرّةً بخطّ
 *  Cairo نفسه، فتصل في كلّ صندوقٍ كما صُمِّمت، ولا ينقلبها الوضع الداكن.
 *
 *  **والمقاس ١٠٨٠×١٣٥٠ (٤:٥)** — مقاسُ منشور إنستغرام العمودي، فتُنشر بلا
 *  قصّ. والرسمُ بالأدوات نفسها التي ترسم اللوحة الترحيبية (sharp +
 *  librsvg + خطّ `assets/fonts`) ويحرسها فحصُ البناء نفسه.
 *
 *  ولا يُكتب في الصورتين إلا ما في السجلّ: الاسم والقسم والمسمّى
 *  والتاريخ والداعي. لا إنجازٌ مُخترَع ولا رقمٌ مُقدَّر. */

export const CARD_W = 1080;
export const CARD_H = 1350;

const FONT = "Cairo, 'Noto Sans Arabic', 'DejaVu Sans', sans-serif";
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
async function textWidth(text: string, size: number): Promise<number> {
  const w = Math.ceil(text.length * size * 0.9) + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.ceil(size * 2)}"><text x="${w - 10}" y="${Math.ceil(size * 1.4)}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="#000" direction="rtl" text-anchor="start">${escapeXml(text)}</text></svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
    return info.width;
  } catch {
    return text.length * size * 0.55;
  }
}

/** أكبرُ حجمٍ يتّسع به النصّ — ثم لا يصغُر دون حدٍّ يُقرأ */
async function fit(text: string, size: number, maxWidth: number, min: number): Promise<number> {
  const w = await textWidth(text, size);
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

/** ألوانُ البطاقة من لون القسم — والحبرُ بالتباين لا بقائمة استثناءات */
function palette(colorHex: string | null | undefined) {
  const bg = colorHex?.trim() || BRAND.temptress;
  const onLight = themeFromColor(bg).text === BRAND.ink;
  return {
    bg,
    onLight,
    ink: onLight ? BRAND.temptress : BRAND.beige,
    lockup: onLight ? "lockLight" : ("lockDark" as "lockLight" | "lockDark"),
  };
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
  const firstSize = await fit(first, 210, 880, 120);
  const fullSize = await fit(d.fullName, 34, 430, 24);
  const byName = d.invitedByName?.trim() || "إدارة تَـــلاقِ";
  const bySize = await fit(byName, 34, 400, 24);
  const dept = d.departmentName?.trim() || "تَـــلاقِ";
  const deptW = Math.min(420, (await textWidth(dept, 26)) + 56);
  const role = d.jobTitle?.trim() ? `${d.position} · ${d.jobTitle.trim()}` : d.position;
  const roleSize = await fit(role, 38, 900, 26);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  <image href="${mark}" x="-230" y="300" width="900" height="${Math.round((900 * a.markH) / a.markW)}" opacity="${p.onLight ? 0.1 : 0.14}"/>
  <image href="${a[p.lockup]}" x="${R - 300}" y="86" width="300" height="88"/>
  <rect x="90" y="100" width="${deptW}" height="58" rx="29" fill="none" stroke="${p.ink}" stroke-opacity="0.45" stroke-width="2"/>
  ${t(dept, 90 + deptW / 2, 138, 26, p.ink, { weight: 700, anchor: "middle" })}
  ${t("دعوة خاصّة", R, 560, 40, p.ink, { weight: 700, opacity: 0.85 })}
  ${t(first, R, 560 + firstSize * 1.05, firstSize, p.ink, { weight: 700 })}
  ${t("للانضمام إلى فريق تَـــلاقِ", R, 560 + firstSize * 1.05 + 86, 44, p.ink, { weight: 400, opacity: 0.92 })}
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

/** بطاقةُ العضوية — المفهوم «أ»: بطاقةٌ بلون القسم على خلفية الهوية.
 *
 *  تصل مع رسالة الاعتماد وحدها: هي الإعلان أنّ صاحبها صار منّا. */
export async function renderWelcomeCard(d: WelcomeCardData): Promise<Buffer> {
  ensureFonts();
  const a = assets();
  const deptColor = d.colorHex?.trim() || BRAND.mahogany;
  const p = palette(deptColor);
  // بطاقةُ الإدارة العليا بلون الخلفية نفسها — فيُرسم لها حدٌّ يُفرِدها
  const sameAsBg = deptColor.toLowerCase() === BRAND.temptress.toLowerCase();
  const cardFill = sameAsBg ? "#3E2535" : deptColor;
  const bgMark = await tintedMark(sameAsBg ? "#5A3A4D" : deptColor, 620);
  const cardMark = await tintedMark(p.ink, 76);

  const L = 70;
  const W = CARD_W - 2 * L;
  const R = L + W - 64;
  const IL = L + 64;
  const nameSize = await fit(d.fullName, 104, W - 128, 60);
  const titleSize = await fit(d.title, 42, W - 128, 28);
  const roleSize = await fit(d.roleTitle, 32, 420, 22);
  const dept = d.departmentName?.trim() || "تَـــلاقِ";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <defs>
    <pattern id="dots" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="17" cy="17" r="2.2" fill="${BRAND.beige}" fill-opacity="0.08"/></pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="28"/><feOffset dy="34"/><feComponentTransfer><feFuncA type="linear" slope="0.42"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" fill="${BRAND.temptress}"/>
  <rect width="100%" height="100%" fill="url(#dots)"/>
  <image href="${bgMark}" x="-200" y="760" width="620" height="${Math.round((620 * a.markH) / a.markW)}" opacity="${sameAsBg ? 0.9 : 0.24}"/>
  <image href="${a.lockDark}" x="${CARD_W - L - 280}" y="78" width="280" height="82"/>
  ${t("بطاقة انضمام", L, 132, 26, BRAND.beige, { opacity: 0.7, anchor: "left" })}
  ${t(`${d.greeting} في العائلة`, CARD_W - L, 300, 50, BRAND.beige, { weight: 700, opacity: 0.95 })}
  <g filter="url(#shadow)">
    <rect x="${L}" y="370" width="${W}" height="660" rx="56" fill="${cardFill}"${sameAsBg ? ` stroke="${BRAND.beige}" stroke-opacity="0.16" stroke-width="2"` : ""}/>
  </g>
  ${t(dept, R, 470, 30, p.ink, { weight: 700, opacity: 0.85 })}
  <image href="${cardMark}" x="${IL}" y="420" width="76" height="${Math.round((76 * a.markH) / a.markW)}"/>
  ${t(d.fullName, R, 720, nameSize, p.ink, { weight: 700 })}
  ${t(d.title, R, 800, titleSize, p.ink, { opacity: 0.9 })}
  <line x1="${IL}" y1="870" x2="${R}" y2="870" stroke="${p.ink}" stroke-opacity="0.22" stroke-width="2"/>
  ${t(d.joinedLabel, R, 928, 24, p.ink, { opacity: 0.65 })}
  ${t(cardDate(d.joinedAt), R, 978, 34, p.ink, { weight: 700 })}
  ${t("الصفة", IL, 928, 24, p.ink, { opacity: 0.65, anchor: "left" })}
  ${t(d.roleTitle, IL, 978, roleSize, p.ink, { weight: 700, anchor: "left" })}
  ${t("نلتقي · نفكّر · نصنع", CARD_W - L, 1190, 34, BRAND.beige, { opacity: 0.78 })}
  ${t("@tlaqisa", L, 1190, 32, BRAND.beige, { opacity: 0.78, ltr: true })}
</svg>`;
  return toPng(svg);
}
