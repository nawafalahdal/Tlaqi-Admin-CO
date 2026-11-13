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


/** **بطاقةُ الاعتماد (العضوية)** — التصميمُ الذي اعتمده المؤسس (نوفمبر 2026):
 *  - **أعلى الصفحة:** «بطاقة انضمام» في إطارٍ دائريٍّ رفيع ثم «أهلاً بكِ في العائلة» مكبَّرة — الجملتان وحدهما (قرار المؤسس).
 *  - **البطاقة:** الشعارُ الرسميُّ يساراً واسمُ القسم أو اللجنة يميناً فوق الاسم، ثم الاسمُ بالخطّ العريض والمسمّى، ثم تاريخُ
 *    الانضمام والصفة. الخلفيةُ والبطاقةُ بلون القسم الصافي (واللجنةُ بلون قسمها)، والبطاقةُ تُفرَد بإطارٍ وظلّ.
 *  - **الشعارُ بنسخته الرسمية لذلك اللون** (لا تلوين): البنفسجي علامةٌ برتقالية وكلمةٌ Beige؛ الـBeige علامةٌ برتقالية؛
 *    البرتقالي أبيضُ (Beige) كاملاً؛ الأخضر بنفسجيٌّ كاملاً — والنصُّ بحبر تلك النسخة.
 *  - **الأنماطُ الثلاثة خافتةً في الخلفية**، ولا نمطَ خلف نص.
 *
 *  تصل مع رسالة الاعتماد وحدها: هي الإعلان أنّ صاحبها صار منّا. */
export async function renderWelcomeCard(d: WelcomeCardData): Promise<Buffer> {
  ensureFonts();
  const card = palette(d.colorHex);
  const page = card.bg;
  const pageInk = card.ink;
  const pageLogo: LogoFile = card.logo;
  const cardInk = card.ink;
  const cardStroke = ` stroke="${card.ink}" stroke-width="2.5"`;
  const C = CARD_W / 2;
  const X = 180;
  const W = CARD_W - 2 * X;
  const R = X + W - 56;
  const IL = X + 56;
  // الترحيبُ مكبَّرٌ (قرار المؤسس) وعرضُه محدودٌ (٤٠٠) فلا يبلغ شكلَ «موهبة» في الزاوية العليا: لا نمطَ خلف نص
  const welcome = `${d.greeting} في العائلة`;
  const welcomeSize = await fit(welcome, 72, 410, 44);
  // **رأسٌ متوازن (قرار المؤسس):** «بطاقة انضمام» داخل إطارٍ دائريٍّ رفيع يملأ أعلى الصفحة، ثم الترحيب، ثم البطاقة —
  // موزَّعةً بهوامشَ متساوية أعلى الصفحة وأسفلها (نحو ١١٨) فلا يبقى فراغٌ فوق الجملتين
  const tag = "بطاقة انضمام";
  const tagW = Math.round(await textWidth(tag, 26, 400)) + 64;
  const CY = 377; // أعلى البطاقة
  const nameSize = await fit(d.fullName, 92, W - 112, 34, HERO); // الحدُّ الأدنى يسع اسماً رباعياً طويلاً داخل البطاقة
  const titleSize = await fit(d.title, 40, W - 112, 26);
  const roleSize = await fit(d.roleTitle, 32, 300, 22);
  const dept = d.departmentName?.trim() || "تلاق";
  // القسمُ يميناً والشعارُ يساراً (قرار المؤسس): لا يتجاوز ما بينهما (اسمُ لجنةٍ طويل يصغُر ولا يبلغ الشعار)
  const deptSize = await fit(dept, 28, W - 112 - 280 - 40, 18);
  const nameY = CY + 240 + nameSize;
  // **نمطان كبيران خافتان في الخلفية (قرار المؤسس):** شكلُ «موهبة» في الزاوية العليا وشكلُ «ابتكار» في الزاوية السفلى
  // المقابلة، كلٌّ منهما شكلٌ واحدٌ مكبَّرٌ بنسبته (لا تمديد ولا تدوير) يخرج عن الحافة، بحبر الخلفية وبشفافيةٍ خفيفة —
  // فيُرى أثراً هادئاً لا زحمة. ويقعان خلف البطاقة والهوامش وحدها، فلا نمطَ خلف نص.
  const inkName: PatternColor = card.ink === BRAND.temptress ? "temptress" : "beige";
  const faint = card.onLight ? 0.07 : 0.1;
  const motif = (kind: "talent" | "innovation", cx: number, cy: number, scale: number) =>
    `<g opacity="${faint}" transform="translate(${cx} ${cy}) scale(${scale}) translate(-36 -36)">${patternTile(kind, inkName)}</g>`;
  // مقاسٌ يُقرأ به الشكلُ كاملاً (نحو ٣٦٠ بكسلاً)، وتقطعه الحافةُ قليلاً فيبدو ممتدّاً خارج البطاقة لا ملصقاً عليها
  // والثالثُ «ربط» — قوسٌ يصل نقطتين (معناه في الدليل: الصلةُ بين الموهبة والجهة): قوسٌ واحدٌ كبيرٌ كالجسر، طرفاه على الحافة
  // السفلى في الزاوية الحرّة — فتتوزّع الثلاثةُ على البطاقة بلا تكرار: «موهبة» أعلى، و«ابتكار» و«ربط» أسفلُ على الجانبين
  const arc = (patternTile("link", inkName).match(/<path[^>]*transform="translate\(18 18\)"[^>]*\/>/) ?? [""])[0];
  const link = arc ? `<g opacity="${faint}" transform="translate(${CARD_W - 185} ${CARD_H - 150}) scale(15) translate(-18 -18)">${arc}</g>` : "";
  const motifs = motif("talent", CARD_W - 150, 175, 9) + motif("innovation", 150, CARD_H - 170, 9) + link;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="26"/><feOffset dy="30"/><feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" fill="${page}"/>
  ${motifs}
  <rect x="${C - tagW / 2}" y="118" width="${tagW}" height="52" rx="26" fill="none" stroke="${pageInk}" stroke-width="2"/>
  ${t(tag, C, 153, 26, pageInk, { anchor: "middle" })}
  ${t(welcome, C, 282, welcomeSize, pageInk, { weight: 700, anchor: "middle" })}
  <g filter="url(#shadow)"><rect x="${X}" y="${CY}" width="${W}" height="680" rx="48" fill="${card.bg}"${cardStroke}/></g>
  <image href="${logoUri(pageLogo)}" x="${IL}" y="${CY + 50}" width="280" height="${Math.round((280 * 706) / 2400)}"/>
  ${t(dept, R, CY + 102, deptSize, cardInk, { weight: 700 })}
  ${t(d.fullName, R, nameY, nameSize, cardInk, { weight: HERO })}
  ${t(d.title, R, nameY + 70, titleSize, cardInk)}
  <line x1="${IL}" y1="${CY + 490}" x2="${R}" y2="${CY + 490}" stroke="${cardInk}" stroke-width="2"/>
  ${t(d.joinedLabel, R, CY + 552, 24, cardInk)}
  ${t(cardDate(d.joinedAt), R, CY + 604, 34, cardInk, { weight: 700 })}
  ${t("الصفة", IL, CY + 552, 24, cardInk, { anchor: "left" })}
  ${t(d.roleTitle, IL, CY + 604, roleSize, cardInk, { weight: 700, anchor: "left" })}
  ${t("تحوّل رقمي، برؤية طموحة.", C, 1182, 30, pageInk, { anchor: "middle" })}
  ${t("@tlaqisa", C, 1230, 26, pageInk, { anchor: "middle", ltr: true })}
</svg>`;
  return toPng(svg);
}

/* ───────────────────────── بطاقةُ العضوية «المحادثة» — مقترحٌ بانتظار اعتماد المؤسس ─────────────────────────
 *  فكرةُ المؤسس (نوفمبر 2026): الترحيبُ يُعرض كما يحدث في مساحة عمل الفريق — نافذةُ تطبيقٍ فيها قناةُ «# الترحيب»،
 *  ورسالةٌ من تلاق تعلن الانضمام، وبطاقةُ العضو بلون قسمه داخل الرسالة، وتفاعلاتٌ بأنماط الهوية.
 *  الثابتُ: الإطارُ البنفسجي ونسخةُ الشعار المعتمدة له (علامةٌ برتقالية وكلمةٌ Beige). والمتغيّرُ: لونُ القسم وحده —
 *  البطاقةُ والقناةُ النشطة والوهجُ والأنماطُ الكبيرة. */

const markCache = new Map<string, string>();
function markUri(file: string): string {
  const hit = markCache.get(file);
  if (hit) return hit;
  const uri = `data:image/png;base64,${readFileSync(join(BRAND_DIR, "2026", "logos", file)).toString("base64")}`;
  markCache.set(file, uri);
  return uri;
}
/** علامةُ الشعار (١٢٠٠×١٣٠٠) متمركزةً على نقطة بارتفاعٍ معلوم */
function markAt(file: string, cx: number, cy: number, h: number): string {
  const w = Math.round((h * 1200) / 1300);
  return `<image href="${markUri(file)}" x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}"/>`;
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
const motifIcon = (kind: Motif, fill: string, cx: number, cy: number, r: number) =>
  kind === "link" ? linkAt(fill, cx, cy + r * 0.1, r * 1.05) : motifAt(kind, fill, cx, cy, r);

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
/** مزجُ لونين بنسبة — للتدرّج الخفيف في البطاقة وللونٍ يُقرأ على الإطار البنفسجي */
function mix(a: string, b: string, t: number): string {
  const [p, q] = [rgbOf(a), rgbOf(b)];
  return `#${p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export async function renderWelcomeCardV2(d: WelcomeCardData): Promise<Buffer> {
  ensureFonts();
  const card = palette(d.colorHex);
  const accent = card.bg;
  const frame = BRAND.temptress;
  const beige = BRAND.beige;
  const cream = mix(beige, "#FFFFFF", 0.45);
  const ink = BRAND.temptress;
  // لونُ القسم على الإطار البنفسجي: كما هو، إلا إن ذاب فيه (الإدارة العليا) فدرجةٌ أفتح منه نفسه
  const glow = contrast(accent, frame) >= 1.6 ? accent : mix(accent, "#C9A2BC", 0.55);
  const glowInk = themeFromColor(glow).text === BRAND.ink ? ink : beige;
  // لونُ القسم على الخلفية الفاتحة: كما هو، إلا إن ذاب فيها (Beige) فالبنفسجي
  const onCream = contrast(accent, cream) >= 1.5 ? accent : ink;
  // اللونُ الثاني (الشكلُ أسفل اليمين والتفاعلُ الثالث): الأخضر، أو البرتقالي إن كان القسمُ أخضر
  const dist = (a: string, b: string) => rgbOf(a).reduce((s, v, i) => s + (v - rgbOf(b)[i]) ** 2, 0);
  const second = dist(accent, BRAND.greenSheen) < dist(accent, BRAND.mahogany) ? BRAND.mahogany : BRAND.greenSheen;
  const cardInk = card.ink;
  const cardMark = MARK_FOR[card.logo];

  const dept = d.departmentName?.trim() || "TLAQI";
  const verb = d.joinedLabel.replace(/\s*في\s*$/, "").trim() || "انضمّ";
  // اسمُ المنصة بالإنجليزية وحدها في هذه البطاقة (قرار المؤسس): لا «تلاق» ولا «تلاقي» بالعربية
  const brand = "TLAQI";

  // ── النافذة
  const WX = 72, WY = 312, WW = 936, WH = 872, WR = 34;
  const BAR = 70;
  const SIDE = 248;
  const MAINR = WX + WW - SIDE; // حدُّ المنطقة الفاتحة يميناً
  const top = WY + BAR;
  // ── داخل المنطقة الفاتحة
  const PR = MAINR - 37; // هامشُ النص يميناً
  const PL = WX + 35;
  // ── البطاقة
  const CX0 = PL, CX1 = PR, CY0 = top + 232, CY1 = top + 638;
  const CR = CX1 - 34, CL = CX0 + 34;

  const sideFit = (s: string, size: number, min: number) => fit(s, size, SIDE - 70, min);
  const deptCh = `# ${dept}`;
  const fourth = dept === "الإبداع" ? "# المشاريع" : "# الإبداع";
  const deptChSize = await sideFit(deptCh, 22, 13);
  const memberSize = await fit(d.fullName, 20, SIDE - 80, 12);
  const message = `${verb} ${d.fullName} إلى العائلة`;
  const messageSize = await fit(message, 24, PR - PL - 90, 15);
  const nameSize = await fit(d.fullName, 60, CR - CL - 20, 30, HERO);
  const titleSize = await fit(d.title, 29, CR - CL - 20, 18);
  const roleSize = await fit(d.roleTitle, 30, 220, 18);
  const chipSize = await fit(dept, 24, CR - CL - 120, 15);
  const chipW = Math.round((await textWidth(dept, chipSize)) + 44);
  const authorW = await textWidth(brand, 23, 700, LATIN);
  const searchAr = "ابحث في";
  const searchArW = await textWidth(searchAr, 19, 400);
  const searchLW = await textWidth(brand, 18, 700, LATIN);
  const searchX = CARD_W / 2 + (searchArW + 7 + searchLW) / 2; // يمينُ عبارة البحث متمركزةً
  const colW = Math.max(await textWidth("الصفة", 20, 400), await textWidth(d.roleTitle, roleSize));
  const colR = CL + colW;

  // ── التفاعلات: شكلٌ ورقمٌ في كبسولة، من اليمين
  // الأنماطُ الثلاثة كلُّها: «موهبة» و«ابتكار» بلون القسم، و«ربط» باللون الثاني
  const reactions: [kind: Motif, color: string, n: string][] = [
    ["talent", onCream, "٢٤"],
    ["innovation", onCream, "١٨"],
    ["link", second, "١٢"],
  ];
  let rx = PR;
  const RY = CY1 + 26, RH = 48;
  let reactionSvg = "";
  for (const [kind, color, n] of reactions) {
    const w = Math.round((await textWidth(n, 22)) + 78);
    const x = rx - w;
    reactionSvg += `<rect x="${x}" y="${RY}" width="${w}" height="${RH}" rx="${RH / 2}" fill="${onCream}" fill-opacity="0.1" stroke="${onCream}" stroke-opacity="0.35" stroke-width="1.5"/>`;
    reactionSvg += motifIcon(kind, color, rx - 30, RY + RH / 2, 15);
    reactionSvg += t(n, rx - 52, RY + 32, 22, ink, { weight: 700 });
    rx = x - 12;
  }
  const IY = RY + RH + 22, IH = 54;


  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(frame, "#000000", 0.18)}"/><stop offset="1" stop-color="${frame}"/></linearGradient>
    <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${glow}" stop-opacity="0.4"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="cardFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(accent, "#FFFFFF", 0.07)}"/><stop offset="1" stop-color="${mix(accent, "#000000", 0.08)}"/></linearGradient>
    <clipPath id="win"><rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="${WR}"/></clipPath>
    <filter id="winShadow" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur in="SourceAlpha" stdDeviation="22"/><feOffset dy="22"/><feComponentTransfer><feFuncA type="linear" slope="0.45"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="cardShadow" x="-15%" y="-15%" width="130%" height="145%"><feGaussianBlur in="SourceAlpha" stdDeviation="16"/><feOffset dy="14"/><feComponentTransfer><feFuncA type="linear" slope="0.22"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="1000" cy="360" r="480" fill="url(#glowA)"/>
  ${/* هادئة (قرار المؤسس): لا نمطَ مكرَّراً في الخلفية ولا وهجَ ثانياً — والأنماطُ الثلاثة شكلٌ واحدٌ لكلٍّ منها */ ""}
  ${motifAt("talent", glow, 1078, 300, 230, 0.9)}
  ${linkAt(glow, 96, 1270, 190, 0.9)}
  ${motifAt("innovation", second, 978, 1282, 70)}

  <image href="${logoUri("on-temptress")}" x="${CARD_W / 2 - 135}" y="52" width="270" height="${Math.round((270 * 706) / 2400)}"/>
  ${t("بطاقة انضمام", CARD_W / 2, 188, 26, beige, { anchor: "middle", opacity: 0.88 })}
  ${t(`${d.greeting} في العائلة`, CARD_W / 2, 268, 68, beige, { weight: HERO, anchor: "middle" })}

  <g filter="url(#winShadow)"><rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="${WR}" fill="${frame}" fill-opacity="0.55"/></g>
  <g clip-path="url(#win)">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" fill="#FFFFFF" fill-opacity="0.07"/>
    <line x1="${WX}" y1="${top}" x2="${WX + WW}" y2="${top}" stroke="#FFFFFF" stroke-opacity="0.1" stroke-width="1.5"/>
    <rect x="${WX}" y="${top}" width="${MAINR - WX}" height="${WH - BAR}" fill="${cream}"/>
  </g>
  <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="${WR}" fill="none" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="1.5"/>

  <rect x="${CARD_W / 2 - 180}" y="${WY + 16}" width="360" height="39" rx="19.5" fill="#FFFFFF" fill-opacity="0.1"/>
  ${t(searchAr, searchX, WY + 43, 19, beige, { opacity: 0.75 })}
  ${t(brand, searchX - searchArW - 7, WY + 42, 18, beige, { opacity: 0.75, ltr: true, anchor: "right", weight: 700, font: LATIN })}
  <circle cx="${WX + WW - 38}" cy="${WY + 35}" r="9" fill="${BRAND.mahogany}"/>
  <circle cx="${WX + WW - 67}" cy="${WY + 35}" r="9" fill="${BRAND.greenSheen}"/>
  <circle cx="${WX + WW - 96}" cy="${WY + 35}" r="9" fill="${beige}"/>

  <image href="${logoUri("on-temptress")}" x="${WX + WW - 24 - 170}" y="${top + 22}" width="170" height="${Math.round((170 * 706) / 2400)}"/>
  ${t("القنوات", WX + WW - 23, top + 119, 17, beige, { opacity: 0.6 })}
  <rect x="${MAINR + 21}" y="${top + 138}" width="${SIDE - 44}" height="52" rx="11" fill="${glow}"/>
  ${t("# الترحيب", WX + WW - 38, top + 172, 22, glowInk, { weight: 700 })}
  ${t("# عام", WX + WW - 38, top + 229, 22, beige, { opacity: 0.85 })}
  ${t(deptCh, WX + WW - 38, top + 286, deptChSize, beige, { opacity: 0.85 })}
  ${t(fourth, WX + WW - 38, top + 343, 22, beige, { opacity: 0.85 })}
  ${t("الأعضاء", WX + WW - 23, top + 403, 17, beige, { opacity: 0.6 })}
  <circle cx="${WX + WW - 40}" cy="${top + 447}" r="5.5" fill="${BRAND.greenSheen}"/>
  ${t(d.fullName, WX + WW - 56, top + 454, memberSize, beige, { opacity: 0.9 })}

  ${t("# الترحيب", PR, top + 49, 30, ink, { weight: HERO })}
  ${t("نرحّب بأعضاء العائلة الجدد", PR, top + 79, 19, ink, { opacity: 0.68 })}
  <line x1="${WX}" y1="${top + 94}" x2="${MAINR}" y2="${top + 94}" stroke="${ink}" stroke-opacity="0.1" stroke-width="1.5"/>

  ${markAt(MARK_FOR["on-beige"], PR - 29, top + 154, 60)}
  ${t(brand, PR - 82, top + 151, 22, ink, { weight: 700, ltr: true, anchor: "right", font: LATIN })}
  ${t("الآن", PR - 82 - authorW - 12, top + 151, 17, ink, { opacity: 0.55 })}
  ${t(message, PR - 82, top + 189, messageSize, ink)}

  <g filter="url(#cardShadow)"><rect x="${CX0}" y="${CY0}" width="${CX1 - CX0}" height="${CY1 - CY0}" rx="26" fill="url(#cardFill)"${contrast(accent, cream) < 1.5 ? ` stroke="${ink}" stroke-opacity="0.18" stroke-width="1.5"` : ""}/></g>
  ${markAt(cardMark, CL + 18, CY0 + 42, 42)}
  ${t("بطاقة انضمام", CR, CY0 + 50, 20, cardInk, { opacity: 0.85 })}
  <rect x="${CR - chipW}" y="${CY0 + 68}" width="${chipW}" height="46" rx="23" fill="${cardInk}" fill-opacity="0.14"/>
  ${t(dept, CR - 22, CY0 + 100, chipSize, cardInk, { weight: 700 })}
  ${t(d.fullName, CR, CY0 + 186, nameSize, cardInk, { weight: HERO })}
  ${t(d.title, CR, CY0 + 244, titleSize, cardInk, { opacity: 0.92 })}
  <line x1="${CL}" y1="${CY0 + 276}" x2="${CR}" y2="${CY0 + 276}" stroke="${cardInk}" stroke-opacity="0.35" stroke-width="1.5"/>
  ${t(d.joinedLabel, CR, CY0 + 318, 20, cardInk, { opacity: 0.85 })}
  ${t(cardDate(d.joinedAt), CR, CY0 + 366, 30, cardInk, { weight: HERO })}
  ${t("الصفة", colR, CY0 + 318, 20, cardInk, { opacity: 0.85 })}
  ${t(d.roleTitle, colR, CY0 + 366, roleSize, cardInk, { weight: HERO })}

  ${reactionSvg}
  <rect x="${PL}" y="${IY}" width="${PR - PL}" height="${IH}" rx="14" fill="#FFFFFF" fill-opacity="0.55" stroke="${ink}" stroke-opacity="0.16" stroke-width="1.5"/>
  ${t("اكتب رسالة في # الترحيب", PR - 26, IY + 35, 20, ink, { opacity: 0.5 })}

  ${t("تحوّل رقمي، برؤية طموحة.", CARD_W / 2, 1268, 44, beige, { weight: HERO, anchor: "middle" })}
  ${t("@tlaqisa", CARD_W / 2, 1316, 23, beige, { anchor: "middle", ltr: true, opacity: 0.75, font: LATIN })}
</svg>`;
  return toPng(svg);
}
